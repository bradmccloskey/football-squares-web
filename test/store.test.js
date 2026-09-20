'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-store-'));

const p = require('../lib/pool');
const { Store, LIVE_MS, IDLE_MS } = require('../lib/store');
const { scoreboard, fixture, fakeFetch } = require('./helpers');

const pool = p.loadPool();
const W3 = { 20260920: fixture('scoreboard-20260920-pregame.json') };
const newStore = (map = W3) => new Store(pool, { fetchImpl: fakeFetch(map) });

test('the store defaults to the current pool week', () => {
  const s = newStore();
  assert.strictEqual(s.state.week, p.currentPoolWeek(pool));
  assert.strictEqual(s.state.delaySeconds, 15, 'default delay is 15s');
  assert.deepStrictEqual(s.state.tracked, []);
});

test('setState validates the week and ignores nonsense', () => {
  const s = newStore();
  assert.strictEqual(s.setState({ week: 7 }).week, 7);
  assert.strictEqual(s.setState({ week: 99 }).week, 7, 'out-of-range week ignored');
  assert.strictEqual(s.setState({ week: 'abc' }).week, 7);
  assert.strictEqual(s.setState({ week: 18 }).week, 18);
});

test('setState clamps the delay slider', () => {
  const s = newStore();
  assert.strictEqual(s.setState({ delaySeconds: 45 }).delaySeconds, 45);
  assert.strictEqual(s.setState({ delaySeconds: 1000 }).delaySeconds, 90);
  assert.strictEqual(s.setState({ delaySeconds: -1 }).delaySeconds, 0);
});

test('setState accepts only real owner names and de-duplicates', () => {
  const s = newStore();
  const out = s.setState({ tracked: ['brad mc', 'brad mc', 'nobody at all', 'paige'] });
  assert.deepStrictEqual(out.tracked, ['brad mc', 'paige']);
  assert.deepStrictEqual(s.setState({ tracked: [] }).tracked, []);
  assert.deepStrictEqual(s.setState({ tracked: 'brad mc' }).tracked, [], 'non-array ignored');
});

test('changing the week clears the delay buffers from the old week', async () => {
  const s = newStore();
  await s.refresh();
  assert.ok(s.buffers.size > 0);
  s.setState({ week: 9 });
  assert.strictEqual(s.live.size, 0, 'stale scores must not leak into the new week');
});

test('refresh populates a score and a delay buffer for each game it finds', async () => {
  const s = newStore();
  s.setState({ week: 3 });
  await s.refresh();
  assert.ok(s.live.has('w3g0'), 'tonight');
  assert.ok(!s.gameErrors.has('w3g0'), 'no error for the game we have data for');
  assert.strictEqual(s.buffers.get('w3g0').size, 1);
  // The Monday and Thursday games have no fixture here, so they surface errors
  // rather than pretending to have data.
  assert.ok(s.gameErrors.has('w3g1'));
});

test('a date that 404s marks its games with an error instead of crashing', async () => {
  const s = newStore({});
  s.setState({ week: 3 });
  await s.refresh();
  assert.ok(s.gameErrors.get('w3g0'), 'error recorded');
  const snap = s.snapshot();
  assert.ok(snap.games[0].error);
  assert.strictEqual(snap.games[0].hasData, false);
});

test('poll cadence: never fetched -> now, live -> 20s, all final -> hourly', () => {
  const s = newStore();
  const games = pool.weeks['2'].games;
  const now = Date.parse('2026-09-13T20:00:00Z');
  assert.strictEqual(s.intervalForDate('2026-09-13', games, now), 0, 'unknown date polls immediately');
  s.live.set(games[0].id, { state: 'in', statusName: 'STATUS_IN_PROGRESS', startDate: '2026-09-14T00:20Z' });
  assert.strictEqual(s.intervalForDate('2026-09-13', [games[0]], now), LIVE_MS);
  s.live.set(games[0].id, { state: 'post', completed: true, startDate: '2026-09-14T00:20Z' });
  assert.ok(s.intervalForDate('2026-09-13', [games[0]], now) > IDLE_MS, 'final games stop being polled');
});

test('poll cadence tightens near kickoff and relaxes long before it', () => {
  const s = newStore();
  const g = pool.weeks['3'].games[0];
  const kick = '2026-09-21T00:20Z'; // 8:20pm ET
  s.live.set(g.id, { state: 'pre', startDate: kick });
  const kickMs = Date.parse(kick);
  assert.strictEqual(s.intervalForDate(g.isoDate, [g], kickMs - 10 * 60 * 1000), LIVE_MS, '10 min out');
  assert.strictEqual(s.intervalForDate(g.isoDate, [g], kickMs - 3 * 60 * 60 * 1000), IDLE_MS, '3 hours out');
});

test('snapshot exposes everything the browser needs', async () => {
  const s = newStore();
  s.setState({ week: 3, tracked: ['brad mc'], delaySeconds: 20 });
  await s.refresh();
  const snap = s.snapshot();
  assert.strictEqual(snap.state.week, 3);
  assert.strictEqual(snap.state.delaySeconds, 20);
  assert.strictEqual(snap.owners.length, 10);
  assert.strictEqual(snap.games.length, 3);
  assert.deepStrictEqual(snap.digits.home, pool.weeks['3'].home);
  assert.deepStrictEqual(snap.digits.away, pool.weeks['3'].away);
  assert.strictEqual(snap.tracked.length, 1);
  assert.deepStrictEqual(snap.mySquare, { owner: 'brad mc', row: 7, col: 4, away: 8, home: 4, winnings: 0 });
  assert.deepStrictEqual(snap.weeks, pool.weekNumbers);
  assert.deepStrictEqual(snap.overlay['7,4'].owner, 'brad mc');
});

test('snapshot honours the delay: a fresh sample is not revealed yet', async () => {
  const s = newStore();
  s.setState({ week: 3, delaySeconds: 30 });
  await s.refresh();
  const snap = s.snapshot();
  assert.strictEqual(snap.games[0].delayReady, false, 'buffer has not filled');
  assert.ok(snap.games[0].hasData, 'but we still show the oldest sample rather than a blank board');
});

test('this week\'s decided games are folded into the standings immediately', async () => {
  const s = newStore({ 20260920: fixture('synthetic-homeaway-swapped.json') });
  s.setState({ week: 3 });
  await s.refresh();
  const snap = s.snapshot();
  const g = snap.games[0];
  assert.strictEqual(g.state, 'post');
  const names = snap.standings.map((x) => x.owner);
  assert.ok(names.includes(g.final.owner), 'final winner is in the standings without a season refresh');
  assert.ok(names.includes(g.halftime.owner));
});
