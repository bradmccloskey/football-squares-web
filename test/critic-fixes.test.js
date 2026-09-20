'use strict';
/**
 * Regression tests for the six issues raised in CRITIC.md (2026-09-20).
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-critic-'));
process.env.SQUARES_CACHE_DIR = path.join(TMP, 'cache');
process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json');

const p = require('../lib/pool');
const e = require('../lib/espn');
const board = require('../lib/board');
const { Store, WEEK_RESTORE_MS } = require('../lib/store');
const { fixture, fakeFetch } = require('./helpers');

const pool = p.loadPool();
const week3 = pool.weeks['3'];
const W3 = { 20260920: fixture('scoreboard-20260920-pregame.json') };

function liveScore(home, away, period = 2, clock = '5:03') {
  return {
    eventId: '401872945', homeTeam: 'Kansas City Chiefs', awayTeam: 'Indianapolis Colts',
    homeAbbr: 'KC', awayAbbr: 'IND', homeTotal: home, awayTotal: away,
    period, clock, state: 'in', statusName: 'STATUS_IN_PROGRESS',
    statusDetail: clock + ' - 2nd', completed: false, startDate: '2026-09-21T00:20Z',
    quarterScores: [{ quarter: 1, home: 7, away: 3 }, { quarter: 2, home, away }],
  };
}
function newStore(map = W3) {
  const s = new Store(pool, { fetchImpl: fakeFetch(map) });
  s.persist = false;
  return s;
}

/* ---------------- 2. the delay must never be bypassed ---------------- */

test('BLOCKER 2: a restart mid-game holds the score back instead of showing it live', () => {
  // Cold start: the very first sample IS the live score. Showing it would put
  // the board ahead of the TV — the exact spoiler this app exists to prevent.
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 15 });
  const t = Date.now();
  s.bufferFor('w3g0').push(liveScore(24, 17), t);
  s.live.set('w3g0', liveScore(24, 17));
  s.lastGood.set('w3g0', t);

  const g = s.snapshot(t + 2000).games[0];
  assert.strictEqual(g.syncing, true, 'must announce it is holding back');
  assert.strictEqual(g.score, null, 'NO score while the delay has not elapsed');
  assert.strictEqual(g.current, null, 'and no highlighted square');
  assert.strictEqual(g.halftime, null);
  assert.strictEqual(g.final, null);
  assert.strictEqual(g.hasData, false);
  assert.strictEqual(g.syncSeconds, 13, 'counts down for the viewer');
  // the clock is still live so the room can see the game is running
  assert.strictEqual(g.period, 2);
  assert.strictEqual(g.clock, '5:03');
});

test('BLOCKER 2: once the delay has elapsed the score appears', () => {
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 15 });
  const t = Date.now();
  s.bufferFor('w3g0').push(liveScore(24, 17), t);
  s.live.set('w3g0', liveScore(24, 17));
  s.lastGood.set('w3g0', t + 16000);

  const g = s.snapshot(t + 16000).games[0];
  assert.strictEqual(g.syncing, false);
  assert.deepStrictEqual(g.score, { home: 24, away: 17 });
  assert.ok(g.current, 'the square is back');
});

test('BLOCKER 2: a pregame board is shown immediately — 0-0 cannot spoil anything', () => {
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 30 });
  const t = Date.now();
  const pre = { ...liveScore(0, 0, 0, ''), state: 'pre', statusName: 'STATUS_SCHEDULED', quarterScores: [] };
  s.bufferFor('w3g0').push(pre, t);
  s.live.set('w3g0', pre);
  const g = s.snapshot(t + 1000).games[0];
  assert.strictEqual(g.syncing, false, 'no need to hold a pregame board back');
  assert.deepStrictEqual(g.score, { home: 0, away: 0 });
  assert.strictEqual(g.current, null, 'but no square before kickoff');
});

test('BLOCKER 2: a game that finished long before the restart is shown immediately', () => {
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 30 });
  const t = Date.now();
  const done = { ...liveScore(31, 20, 4, '0:00'), state: 'post', statusName: 'STATUS_FINAL', completed: true };
  s.bufferFor('w3g0').push(done, t);
  s.live.set('w3g0', done);
  const g = s.snapshot(t + 1000).games[0];
  assert.strictEqual(g.syncing, false, 'history is not a spoiler');
  assert.ok(g.final, 'the final square is available for browsing past weeks');
});

test('BLOCKER 2: raising the delay beyond what the buffer holds also holds back', () => {
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 10 });
  const t = Date.now();
  s.bufferFor('w3g0').push(liveScore(24, 17), t - 20000);
  s.live.set('w3g0', liveScore(24, 17));
  assert.ok(s.snapshot(t).games[0].score, 'fine at 10s');
  s.setState({ delaySeconds: 90 });
  const g = s.snapshot(t).games[0];
  assert.strictEqual(g.syncing, true, 'we do not hold 90s of history yet');
  assert.strictEqual(g.score, null);
});

/* ---------------- 3. an ESPN outage must be visible ---------------- */

test('FIX 3: a failing ESPN does not advance lastPoll', async () => {
  const s = newStore();
  s.setState({ week: 3 });
  await s.refresh();
  const good = s.lastPoll;
  assert.ok(good > 0, 'a successful fetch stamps lastPoll');

  s.fetchImpl = async () => { throw new Error('ESPN 503'); };
  s.dateMeta.clear();
  await s.refresh();
  assert.strictEqual(s.lastPoll, good, 'a failed fetch must NOT look like a healthy poll');
  assert.ok(s.lastError, 'and the failure is recorded');
  assert.match(s.lastError.message, /503/);
});

test('FIX 3: the snapshot exposes the outage', async () => {
  const s = newStore();
  s.setState({ week: 3 });
  const t = Date.now();
  await s.refresh(t);
  s.fetchImpl = async () => { throw new Error('ESPN 503'); };
  s.dateMeta.clear();
  await s.refresh(t + 60 * 1000);    // a minute later, ESPN is down
  const snap = s.snapshot(t + 5 * 60 * 1000);
  assert.strictEqual(snap.espn.failing, true);
  assert.ok(snap.espn.staleMs > 60 * 1000);
  assert.ok(snap.espn.lastError);
});

test('FIX 3: a live game with no fresh score for over a minute is marked stale', () => {
  const s = newStore();
  s.setState({ week: 3 });
  const t = Date.now();
  s.bufferFor('w3g0').push(liveScore(24, 17), t - 120000);
  s.live.set('w3g0', liveScore(24, 17));
  s.lastGood.set('w3g0', t - 120000);
  const g = s.snapshot(t).games[0];
  assert.ok(g.stale, 'a frozen live game must say so');
  assert.strictEqual(g.stale.seconds, 120);
});

test('FIX 3: pregame and finished games are not flagged stale for not updating', () => {
  assert.strictEqual(board.staleFor('pre', 10 * 60 * 1000), null);
  assert.strictEqual(board.staleFor('post', 60 * 60 * 1000), null);
  assert.strictEqual(board.staleFor('in', 30 * 1000), null, 'under a minute is normal');
  assert.ok(board.staleFor('in', 90 * 1000));
});

/* ---------------- 4. shared state must survive a restart ---------------- */

test('FIX 4: week, delay and tracked players survive a restart', () => {
  const file = path.join(TMP, 'state-roundtrip.json');
  process.env.SQUARES_STATE_FILE = file;
  try {
    const a = new Store(pool, { fetchImpl: fakeFetch(W3) });
    a.setState({ week: 7, delaySeconds: 42, tracked: ['brad mc', 'paige'], gameId: 'w7g1' });
    assert.ok(fs.existsSync(file), 'state written on change');

    const b = new Store(pool, { fetchImpl: fakeFetch(W3) });
    const restored = b.load();
    assert.strictEqual(restored.week, 7);
    assert.strictEqual(restored.delaySeconds, 42);
    assert.deepStrictEqual(restored.tracked, ['brad mc', 'paige']);
    assert.strictEqual(restored.gameId, 'w7g1');
  } finally { process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json'); }
});

test('FIX 4: a stale saved week is not restored, but the delay and players are', () => {
  const file = path.join(TMP, 'state-old.json');
  process.env.SQUARES_STATE_FILE = file;
  try {
    fs.writeFileSync(file, JSON.stringify({
      savedAt: Date.now() - (WEEK_RESTORE_MS + 60000),
      state: { week: 1, delaySeconds: 35, tracked: ['brad mc'], gameId: 'w1g0' },
    }));
    const s = new Store(pool, { fetchImpl: fakeFetch(W3) });
    const r = s.load();
    assert.strictEqual(r.week, p.currentPoolWeek(pool), 'days later, open on the week it actually is');
    assert.strictEqual(r.gameId, null);
    assert.strictEqual(r.delaySeconds, 35, 'but keep his delay');
    assert.deepStrictEqual(r.tracked, ['brad mc'], 'and his people');
  } finally { process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json'); }
});

test('FIX 4: a corrupt or hostile state file cannot break the board', () => {
  const file = path.join(TMP, 'state-bad.json');
  process.env.SQUARES_STATE_FILE = file;
  try {
    for (const body of ['not json at all', '{}', 'null', '[]',
      JSON.stringify({ savedAt: Date.now(), state: { week: 999, delaySeconds: 'NaN', tracked: ['<script>'] } }),
      JSON.stringify({ savedAt: 'soon', state: { week: 4 } })]) {
      fs.writeFileSync(file, body);
      const s = new Store(pool, { fetchImpl: fakeFetch(W3) });
      const r = s.load();
      assert.ok(pool.weekNumbers.includes(r.week), `week stayed valid for ${body.slice(0, 24)}`);
      assert.ok(r.delaySeconds >= 0 && r.delaySeconds <= 90);
      assert.ok(Array.isArray(r.tracked));
      assert.ok(!r.tracked.includes('<script>'), 'no junk owners');
    }
  } finally { process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json'); }
});

test('FIX 4: a missing state file is fine — first run just uses the defaults', () => {
  process.env.SQUARES_STATE_FILE = path.join(TMP, 'does-not-exist.json');
  try {
    const s = new Store(pool, { fetchImpl: fakeFetch(W3) });
    const r = s.load();
    assert.strictEqual(r.week, p.currentPoolWeek(pool));
    assert.strictEqual(r.delaySeconds, 15);
    assert.deepStrictEqual(r.tracked, []);
  } finally { process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json'); }
});

test('FIX 4: the state file is written atomically and leaves no temp files', () => {
  const dir = path.join(TMP, 'atomic');
  const file = path.join(dir, 'state.json');
  process.env.SQUARES_STATE_FILE = file;
  try {
    const s = new Store(pool, { fetchImpl: fakeFetch(W3) });
    for (let i = 0; i < 25; i++) s.setState({ delaySeconds: i % 91 });
    assert.deepStrictEqual(fs.readdirSync(dir), ['state.json'], 'no .tmp left behind');
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).state, 'and it always parses');
  } finally { process.env.SQUARES_STATE_FILE = path.join(TMP, 'state.json'); }
});

/* ---------------- 5. linescores may carry displayValue only ---------------- */

test('FIX 5: cumulativeQuarters reads displayValue when value is absent', () => {
  // The summary endpoint ships {displayValue:"7"} with no `value`. Reading only
  // `value` scored this 0-0 and would have paid the wrong square silently.
  assert.deepStrictEqual(
    e.cumulativeQuarters([{ displayValue: '0' }, { displayValue: '0' }], [{ displayValue: '0' }, { displayValue: '7' }]),
    [{ quarter: 1, home: 0, away: 0 }, { quarter: 2, home: 0, away: 7 }],
  );
});

test('FIX 5: a real 0 is still 0, and value wins when both are present', () => {
  assert.strictEqual(e.lineValue({ value: 0 }), 0);
  assert.strictEqual(e.lineValue({ displayValue: '0' }), 0);
  assert.strictEqual(e.lineValue({ value: 7, displayValue: '99' }), 7);
  assert.strictEqual(e.lineValue({ value: 0, displayValue: '99' }), 0, '0 must not fall through to displayValue');
});

test('FIX 5: junk quarter values count as zero rather than NaN', () => {
  assert.strictEqual(e.lineValue({}), 0);
  assert.strictEqual(e.lineValue(null), 0);
  assert.strictEqual(e.lineValue({ value: 'x' }), 0);
  assert.strictEqual(e.lineValue({ displayValue: null }), 0);
  const q = e.cumulativeQuarters([{ value: 7 }, { junk: 1 }], [{ displayValue: '3' }, { value: 3 }]);
  assert.deepStrictEqual(q[1], { quarter: 2, home: 7, away: 6 });
});

test('FIX 5: a displayValue-only payload scores halftime correctly', () => {
  const sb = JSON.parse(JSON.stringify(fixture('synthetic-halftime.json')));
  const comp = sb.events[0].competitions[0];
  comp.competitors.forEach((c) => {
    c.linescores = c.linescores.map((l) => ({ displayValue: String(l.value) }));
  });
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  assert.deepStrictEqual(e.halftimeScore(s), { home: 17, away: 14 });
  assert.strictEqual(p.winnerForScore(pool, week3, 17, 14).owner, 'bernie 2');
});

/* ---------------- 6. the README's TBD example ---------------- */

test('FIX 6: the date the README tells Brad to type lands in week 18', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const m = /\["(\d{1,2}\/\d{1,2})", "(\w+)", "Jets", "Bills", "([^"]+)"\]/.exec(readme);
  assert.ok(m, 'the worked example is still in the README');
  const iso = p.toIsoDate(m[1]);
  assert.strictEqual(p.poolWeekForDate(pool, iso), 18,
    `${m[1]} must fall in pool week 18, not ${p.poolWeekForDate(pool, iso)}`);
});

test('FIX 6: filling in a TBD game makes it real and keeps the week intact', () => {
  const raw = JSON.parse(fs.readFileSync(p.DATA_PATH, 'utf8'));
  const copy = JSON.parse(JSON.stringify(raw));
  copy.weeks['18'].games[2] = ['1/9', 'Sat', 'Jets', 'Bills', '4:30 PM'];
  const edited = p.normalize(copy);
  const g = edited.weeks['18'].games[2];
  assert.strictEqual(g.tbd, false);
  assert.strictEqual(g.isoDate, '2027-01-09');
  assert.strictEqual(p.poolWeekForDate(edited, '2027-01-09'), 18);
  assert.strictEqual(edited.weeks['18'].games.filter((x) => x.tbd).length, 1, 'the other TBD is untouched');
});
