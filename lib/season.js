'use strict';
/**
 * Season-to-date winners for every completed pool game, plus the standings.
 * ESPN scoreboards for past dates are cached on disk and, once every pool game
 * on that date is final, never re-fetched.
 */
const fs = require('fs');
const path = require('path');
const pooling = require('./pool');
const espn = require('./espn');

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
/** Read lazily so tests can redirect the cache. */
function cacheDir() { return process.env.SQUARES_CACHE_DIR || DEFAULT_CACHE_DIR; }
const SOFT_TTL_MS = 10 * 60 * 1000;

function cachePath(isoDate) { return path.join(cacheDir(), `scoreboard-${pooling.espnDateParam(isoDate)}.json`); }

function readCache(isoDate) {
  try { return JSON.parse(fs.readFileSync(cachePath(isoDate), 'utf8')); } catch { return null; }
}
function writeCache(isoDate, payload) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cachePath(isoDate), JSON.stringify({ fetchedAt: Date.now(), isoDate, payload }));
  } catch (e) { /* cache is best-effort */ }
}

/** All pool games grouped by the calendar date they are played on. */
function gamesByDate(pool) {
  const map = new Map();
  for (const n of pool.weekNumbers) {
    for (const g of pool.weeks[String(n)].games) {
      if (!g.isoDate) continue;
      if (!map.has(g.isoDate)) map.set(g.isoDate, []);
      map.get(g.isoDate).push(g);
    }
  }
  return map;
}

/** True when every pool game on that date is final in the payload — cache is then permanent. */
function allFinal(pool, payload, games) {
  return games.every((g) => {
    const ev = espn.findEvent(payload, g.visitor, g.home);
    const s = ev && espn.buildScore(ev, g.visitor, g.home);
    return !!s && espn.isFinal(s);
  });
}

/**
 * Resolve one date's scoreboard, preferring a permanent cache.
 * `force` skips the cache entirely (used for today's live date).
 */
async function scoreboardFor(pool, isoDate, games, { force = false, fetchImpl, now = Date.now() } = {}) {
  if (!force) {
    const c = readCache(isoDate);
    if (c && c.payload) {
      if (allFinal(pool, c.payload, games)) return { payload: c.payload, cached: true };
      if (now - c.fetchedAt < SOFT_TTL_MS) return { payload: c.payload, cached: true };
    }
  }
  const payload = await espn.fetchScoreboard(isoDate, fetchImpl ? { fetchImpl } : {});
  writeCache(isoDate, payload);
  return { payload, cached: false };
}

/**
 * Compute winners for every pool game whose date has already passed.
 * Returns { results: {gameId: {...}}, winnings: {owner: $}, errors: [] }.
 */
async function computeSeason(pool, { today = pooling.todayET(), fetchImpl, includeToday = false } = {}) {
  const byDate = gamesByDate(pool);
  const results = {};
  const winnings = {};
  const errors = [];
  const dates = [...byDate.keys()].sort();

  for (const isoDate of dates) {
    if (isoDate > today) continue;
    if (isoDate === today && !includeToday) continue;
    const games = byDate.get(isoDate);
    let payload;
    try {
      ({ payload } = await scoreboardFor(pool, isoDate, games, { fetchImpl, force: isoDate === today }));
    } catch (e) {
      errors.push({ isoDate, error: String(e.message || e) });
      continue;
    }
    for (const g of games) {
      const week = pool.weeks[String(g.week)];
      const ev = espn.findEvent(payload, g.visitor, g.home);
      if (!ev) { errors.push({ gameId: g.id, error: 'no ESPN event matched' }); continue; }
      const s = espn.buildScore(ev, g.visitor, g.home);
      if (!s) { errors.push({ gameId: g.id, error: 'team match failed' }); continue; }
      const ht = espn.halftimeScore(s);
      const fin = espn.finalScore(s);
      const rec = {
        gameId: g.id, week: g.week, isoDate, matchup: `${g.visitor} @ ${g.home}`,
        state: s.state, eventId: s.eventId,
        halftime: ht ? { ...ht, ...pooling.winnerForScore(pool, week, ht.home, ht.away) } : null,
        final: fin ? { ...fin, ...pooling.winnerForScore(pool, week, fin.home, fin.away) } : null,
      };
      results[g.id] = rec;
      if (rec.halftime && rec.halftime.owner) winnings[rec.halftime.owner] = (winnings[rec.halftime.owner] || 0) + pooling.PAYOUT_HALFTIME;
      if (rec.final && rec.final.owner) winnings[rec.final.owner] = (winnings[rec.final.owner] || 0) + pooling.PAYOUT_FINAL;
    }
  }
  return { results, winnings, errors, computedAt: Date.now() };
}

/** Winnings map -> sorted standings, every owner included. */
function standings(pool, winnings) {
  return pooling.allOwners(pool)
    .map((owner) => ({ owner, winnings: winnings[owner] || 0 }))
    .sort((a, b) => b.winnings - a.winnings || a.owner.localeCompare(b.owner));
}

module.exports = { computeSeason, standings, gamesByDate, scoreboardFor, cachePath, cacheDir, DEFAULT_CACHE_DIR, allFinal };
