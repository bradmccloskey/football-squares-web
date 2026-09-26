'use strict';
/**
 * Shared server-side state (the phone drives what the TV shows) plus the ESPN
 * poll loop and per-game delay buffers.
 */
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const pooling = require('./pool');
const espn = require('./espn');
const board = require('./board');
const season = require('./season');
const { DelayBuffer, clampDelay } = require('./delay');

// While a game is live we poll faster than the 20s the brief asked for, because
// the revealed score lags the real play by the delay setting PLUS however long
// it took us to notice the change. A 10s poll keeps that jitter under 10s so
// the delay slider means something.
const LIVE_MS = 10 * 1000;
const IDLE_MS = 5 * 60 * 1000;
const FAR_MS = 30 * 60 * 1000;
const NEAR_KICKOFF_MS = 20 * 60 * 1000;
const FAR_KICKOFF_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 5 * 1000;
const SEASON_REFRESH_MS = 15 * 60 * 1000;
// A saved week is only restored if it was chosen recently — after a reboot days
// later the app should open on the week it actually is, not a stale one. The
// delay and the tracked players are always restored.
const WEEK_RESTORE_MS = 12 * 60 * 60 * 1000;

function statePath() {
  return process.env.SQUARES_STATE_FILE || path.join(__dirname, '..', 'data', 'state.json');
}

class Store extends EventEmitter {
  constructor(pool, { fetchImpl } = {}) {
    super();
    this.pool = pool;
    this.fetchImpl = fetchImpl;
    this.state = {
      week: pooling.currentPoolWeek(pool),
      delaySeconds: 15,
      tracked: [],
      gameId: null, // null = auto-pick the live/next game
    };
    this.buffers = new Map();   // gameId -> DelayBuffer
    this.live = new Map();      // gameId -> latest score
    this.gameErrors = new Map();// gameId -> string
    this.dateMeta = new Map();  // isoDate -> {lastFetch, lastError}
    this.lastGood = new Map();  // gameId -> ms of the last successful score
    this.lastError = null;      // {at, isoDate, message} of the last ESPN failure
    this.refreshing = false;
    this.seasonData = { results: {}, winnings: {}, errors: [], computedAt: 0 };
    this.seasonBusy = false;
    this.timer = null;
    this.lastPoll = 0;
    this.persist = true;
  }

  setState(patch = {}) {
    const next = { ...this.state };
    if (patch.week != null) {
      const w = Number(patch.week);
      if (this.pool.weekNumbers.includes(w)) next.week = w;
    }
    if (patch.delaySeconds != null) {
      // A garbage value must KEEP the current delay, never silently drop it to
      // zero — that would quietly un-sync the TV.
      const d = Number(patch.delaySeconds);
      if (Number.isFinite(d)) next.delaySeconds = clampDelay(d);
    }
    if ('gameId' in patch) {
      const id = patch.gameId;
      next.gameId = (id && this.pool.weeks[String(next.week)].games.some((g) => g.id === id)) ? id : null;
    }
    if (Array.isArray(patch.tracked)) {
      const valid = new Set(pooling.allOwners(this.pool));
      next.tracked = [...new Set(patch.tracked.filter((o) => valid.has(o)))].slice(0, 12);
    }
    const weekChanged = next.week !== this.state.week;
    if (weekChanged && patch.gameId == null) next.gameId = null;
    this.state = next;
    // NOTE: buffers are deliberately NOT cleared here. They are keyed by game
    // id, which is unique across the season, so switching weeks and coming back
    // keeps the delay intact. Clearing them let one tap on the week picker
    // reveal a score before it reached the TV — the one thing this app exists
    // to prevent.
    if (weekChanged) this.refresh().catch(() => {});
    this.emit('state', this.state);
    this.save();
    return this.state;
  }

  /** Write the shared state atomically: temp file, then rename. */
  save(now = Date.now()) {
    if (!this.persist) return;
    const file = statePath();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: now, state: this.state }, null, 2));
      fs.renameSync(tmp, file);   // atomic on the same filesystem
    } catch (e) { /* a board that cannot save is still a working board */ }
  }

  /**
   * Restore what Brad last chose. Everything goes back through setState, so a
   * hand-edited or corrupted file cannot put the store in a bad state.
   */
  load(now = Date.now()) {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')); }
    catch (e) { return this.state; }
    const st = saved && saved.state;
    if (!st || typeof st !== 'object') return this.state;

    const fresh = Number.isFinite(saved.savedAt) && (now - saved.savedAt) < WEEK_RESTORE_MS;
    const patch = { delaySeconds: st.delaySeconds, tracked: st.tracked };
    if (fresh) { patch.week = st.week; patch.gameId = st.gameId; }
    this.persist = false;         // do not rewrite the file while reading it
    try { this.setState(patch); } finally { this.persist = true; }
    return this.state;
  }

  weekData() { return this.pool.weeks[String(this.state.week)]; }
  weekGames() { return this.weekData().games.filter((g) => !g.tbd); }

  bufferFor(id) {
    if (!this.buffers.has(id)) this.buffers.set(id, new DelayBuffer());
    return this.buffers.get(id);
  }

  /** ms until we should next hit ESPN for this date. */
  intervalForDate(isoDate, games, now = Date.now()) {
    const scores = games.map((g) => this.live.get(g.id)).filter(Boolean);
    if (!scores.length) return 0; // never fetched — do it now
    if (scores.some((s) => espn.isLive(s))) return LIVE_MS;
    if (scores.every((s) => espn.isFinal(s))) return 60 * 60 * 1000;
    const kicks = scores.map((s) => (s.startDate ? Date.parse(s.startDate) : NaN)).filter((n) => Number.isFinite(n));
    if (kicks.some((k) => k - now < NEAR_KICKOFF_MS && now - k < FAR_KICKOFF_MS)) return LIVE_MS;
    // Games days away need checking only occasionally.
    if (kicks.length && kicks.every((k) => k - now > FAR_KICKOFF_MS)) return FAR_MS;
    return IDLE_MS;
  }

  async refresh(now = Date.now()) {
    if (this.refreshing) return;   // never let slow ESPN responses stack up
    this.refreshing = true;
    try { await this._refresh(now); } finally { this.refreshing = false; }
  }

  async _refresh(now = Date.now()) {
    const games = this.weekGames();
    const byDate = new Map();
    for (const g of games) {
      if (!byDate.has(g.isoDate)) byDate.set(g.isoDate, []);
      byDate.get(g.isoDate).push(g);
    }
    for (const [isoDate, dgames] of byDate) {
      const meta = this.dateMeta.get(isoDate) || { lastFetch: 0 };
      const interval = this.intervalForDate(isoDate, dgames, now);
      if (now - meta.lastFetch < interval) continue;
      try {
        const payload = await espn.fetchScoreboard(isoDate, this.fetchImpl ? { fetchImpl: this.fetchImpl } : {});
        this.dateMeta.set(isoDate, { lastFetch: now, lastError: null });
        this.lastPoll = now;        // only a SUCCESSFUL fetch counts as a poll
        this.lastError = null;
        for (const g of dgames) {
          const ev = espn.findEvent(payload, g.visitor, g.home);
          if (!ev) { this.gameErrors.set(g.id, 'no ESPN event for this matchup yet'); continue; }
          const s = espn.buildScore(ev, g.visitor, g.home);
          if (!s) { this.gameErrors.set(g.id, 'could not match both teams'); continue; }
          this.gameErrors.delete(g.id);
          this.live.set(g.id, s);
          this.lastGood.set(g.id, now);
          this.bufferFor(g.id).push(s, now);
        }
      } catch (e) {
        const msg = String(e.message || e);
        // lastFetch still advances so we back off rather than hammering a
        // failing endpoint, but lastPoll (the health signal) does not.
        this.dateMeta.set(isoDate, { lastFetch: now, lastError: msg, errorAt: now });
        this.lastError = { at: now, isoDate, message: msg };
        for (const g of dgames) if (!this.live.has(g.id)) this.gameErrors.set(g.id, msg);
      }
    }
  }

  async refreshSeason() {
    if (this.seasonBusy) return this.seasonData;
    this.seasonBusy = true;
    try {
      this.seasonData = await season.computeSeason(this.pool, this.fetchImpl ? { fetchImpl: this.fetchImpl } : {});
    } catch (e) {
      this.seasonData = { ...this.seasonData, errors: [{ error: String(e.message || e) }] };
    } finally { this.seasonBusy = false; }
    return this.seasonData;
  }

  start() {
    if (this.timer) return;
    const tick = async () => {
      try { await this.refresh(); } catch (e) { /* keep ticking */ }
      const now = Date.now();
      if (now - (this.seasonData.computedAt || 0) > SEASON_REFRESH_MS) this.refreshSeason().catch(() => {});
    };
    tick();
    this.timer = setInterval(tick, TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** The whole view model the browser renders. */
  snapshot(now = Date.now(), me = pooling.BRAD) {
    const week = this.weekData();
    const { delaySeconds, tracked } = this.state;
    const games = week.games.map((g) => {
      if (g.tbd) return board.describeGame(this.pool, week, g, {});
      const buf = this.buffers.get(g.id);
      const sel = buf ? buf.select(delaySeconds, now) : { score: null, ready: false, waitMs: 0 };
      const good = this.lastGood.get(g.id);
      return board.describeGame(this.pool, week, g, {
        delayedScore: sel.score,
        liveScore: this.live.get(g.id) || null,
        delayReady: sel.ready,
        syncMs: sel.waitMs || 0,
        staleMs: good ? now - good : null,
        error: this.gameErrors.get(g.id) || null,
      });
    });

    // Season winnings, with this week's already-decided games folded in so the
    // sidebar is not stale between season refreshes.
    const winnings = { ...this.seasonData.winnings };
    for (const g of games) {
      const rec = this.seasonData.results[g.id];
      // Count each square once: fold in only what the season pass has not
      // already recorded (it skips today, and can hold a game that was still
      // in progress when it ran).
      if (g.halftime && g.halftime.owner && !(rec && rec.halftime)) {
        winnings[g.halftime.owner] = (winnings[g.halftime.owner] || 0) + pooling.PAYOUT_HALFTIME;
      }
      if (g.final && g.final.owner && !(rec && rec.final)) {
        winnings[g.final.owner] = (winnings[g.final.owner] || 0) + pooling.PAYOUT_FINAL;
      }
    }

    const trackedDetail = board.buildTracked(this.pool, week, tracked, games, winnings);
    const bradSquare = pooling.squaresFor(this.pool, me)[0] || null;

    return {
      now,
      today: pooling.todayET(new Date(now)),
      state: { ...this.state },
      currentWeek: pooling.currentPoolWeek(this.pool, new Date(now)),
      weeks: this.pool.weekNumbers,
      digits: { home: week.home, away: week.away },
      owners: this.pool.owners,
      games,
      activeGameId: board.pickActiveGame(games, this.state.gameId),
      tracked: trackedDetail,
      overlay: board.trackOverlay(trackedDetail),
      standings: season.standings(this.pool, winnings).filter((s) => s.winnings > 0),
      mySquare: bradSquare ? {
        owner: me, ...bradSquare,
        ...pooling.digitsForSquare(week, bradSquare.row, bradSquare.col),
        winnings: winnings[me] || 0,
      } : null,
      payouts: { halftime: pooling.PAYOUT_HALFTIME, final: pooling.PAYOUT_FINAL },
      lastPoll: this.lastPoll,
      espn: {
        lastPoll: this.lastPoll,
        lastError: this.lastError,
        // How long since ANY successful ESPN fetch. Drives the "scores stale"
        // banner together with each live game's own stale marker.
        staleMs: this.lastPoll ? now - this.lastPoll : null,
        failing: !!(this.lastError && this.lastError.at > this.lastPoll),
      },
      seasonComputedAt: this.seasonData.computedAt,
      seasonErrors: this.seasonData.errors,
    };
  }
}

module.exports = { Store, LIVE_MS, IDLE_MS, FAR_MS, TICK_MS, WEEK_RESTORE_MS, statePath };
