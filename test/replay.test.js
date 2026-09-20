'use strict';
/**
 * End-to-end proof that the delay does what it claims: a scripted game is fed
 * through the real Store at controlled times, and the board must show the score
 * from `delaySeconds` ago while the clock and quarter stay current.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-replay-'));

const p = require('../lib/pool');
const { Store } = require('../lib/store');
const replay = require('../scripts/replay-timeline');
const { fixture } = require('./helpers');

const pool = p.loadPool();
const template = fixture('synthetic-q3.json');
const T0 = Date.parse('2026-09-21T00:20:00Z'); // kickoff

/** Run the poll loop from kickoff to `seconds`, stepping 10s like the live poller. */
async function runTo(store, seconds) {
  for (let t = 0; t <= seconds; t += 10) {
    store.fetchImpl = async () => ({ ok: true, status: 200, json: async () => replay.payloadAt(t, template).payload });
    await store.refresh(T0 + t * 1000);
  }
}
function newStore() {
  const s = new Store(pool);
  s.setState({ week: 3, gameId: 'w3g0', tracked: ['brad mc'] });
  return s;
}
const gameAt = (store, seconds) => store.snapshot(T0 + seconds * 1000).games[0];

test('the scripted game itself is coherent', () => {
  const at = (s) => replay.payloadAt(s, template);
  assert.deepStrictEqual([at(0).away, at(0).home], [0, 0]);
  assert.deepStrictEqual([at(20).away, at(20).home], [0, 7], 'Chiefs score first');
  assert.deepStrictEqual([at(100).away, at(100).home], [10, 17], 'halftime 10-17');
  assert.deepStrictEqual([at(220).away, at(220).home], [23, 27], 'final 23-27');
  assert.strictEqual(at(220).step.state, 'post');
});

test('with a 15s delay the board shows the score from 15s ago', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 15 });
  await runTo(s, 40);
  // Live at t=40 is 7-7. Fifteen seconds ago it was 0-7 (the Colts had not
  // answered yet), and before that 0-0.
  const g = gameAt(s, 40);
  assert.deepStrictEqual(g.score, { home: 7, away: 0 }, 'score is held back');
  assert.strictEqual(g.period, 1, 'quarter is live');
  assert.strictEqual(g.clock, '3:09', 'clock is live, not delayed');
});

test('with no delay the board tracks the live score exactly', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 0 });
  await runTo(s, 40);
  assert.deepStrictEqual(gameAt(s, 40).score, { home: 7, away: 7 });
});

test('the delay can be slid up and down over the same buffer', async () => {
  const s = newStore();
  await runTo(s, 60);
  const at = (d) => { s.setState({ delaySeconds: d }); return gameAt(s, 60).score; };
  assert.deepStrictEqual(at(0),  { home: 14, away: 7 }, 'live: Chiefs 14 Colts 7');
  assert.deepStrictEqual(at(30), { home: 7,  away: 0 }, '30s back: before the Colts answered');
  assert.deepStrictEqual(at(60), { home: 0,  away: 0 }, 'a minute back: kickoff');
  assert.deepStrictEqual(at(0),  { home: 14, away: 7 }, 'and forward again');
});

test('the winning square follows the delayed score, not the live one', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 30 });
  await runTo(s, 60);
  const g = gameAt(s, 60);
  // Thirty seconds before t=60 the score was Chiefs 7, Colts 0.
  assert.deepStrictEqual(g.score, { home: 7, away: 0 });
  assert.deepStrictEqual(g.current, p.winnerForScore(pool, pool.weeks['3'], 7, 0));
  // The live score (14-7) would light up a different square entirely.
  assert.notDeepStrictEqual(g.current, p.winnerForScore(pool, pool.weeks['3'], 14, 7));
  assert.strictEqual(g.period, 2, 'but the quarter is the live one');
});

test('the halftime winner is not revealed until the delay has passed', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 15 });
  await runTo(s, 100);
  // ESPN already says halftime at t=100, but the delayed sample is still the
  // middle of the second quarter, so nothing is locked in yet.
  const during = gameAt(s, 100);
  assert.strictEqual(during.halftime, null, 'not revealed early');
  assert.strictEqual(during.period, 2);

  await runTo(s, 140);
  const after = gameAt(s, 120);
  assert.ok(after.halftime, 'revealed once the delay has passed');
  assert.deepStrictEqual({ home: after.halftime.home, away: after.halftime.away }, { home: 17, away: 10 });
  assert.strictEqual(after.halftime.owner, p.winnerForScore(pool, pool.weeks['3'], 17, 10).owner);
});

test('the halftime square stays locked while the third quarter moves on', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 0 });
  await runTo(s, 160);
  const g = gameAt(s, 160);
  assert.deepStrictEqual(g.score, { home: 24, away: 17 }, 'live score has moved');
  assert.deepStrictEqual({ home: g.halftime.home, away: g.halftime.away }, { home: 17, away: 10 }, 'halftime unchanged');
  assert.strictEqual(g.final, null, 'no final yet');
});

test('a full replay pays both squares to the right owners', async () => {
  const s = newStore();
  s.setState({ delaySeconds: 0 });
  await runTo(s, 220);
  const g = gameAt(s, 220);
  assert.strictEqual(g.state, 'post');
  assert.deepStrictEqual({ home: g.final.home, away: g.final.away }, { home: 27, away: 23 });
  const week = pool.weeks['3'];
  assert.strictEqual(g.halftime.owner, p.winnerForScore(pool, week, 17, 10).owner);
  assert.strictEqual(g.final.owner, p.winnerForScore(pool, week, 27, 23).owner);
  assert.notStrictEqual(g.halftime.owner, g.final.owner, 'two different people won');
  // and both show up in the standings at $150 each
  const stand = s.snapshot(T0 + 220000).standings;
  assert.strictEqual(stand.find((x) => x.owner === g.halftime.owner).winnings, 150);
  assert.strictEqual(stand.find((x) => x.owner === g.final.owner).winnings, 150);
});
