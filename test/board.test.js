'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../lib/pool');
const e = require('../lib/espn');
const board = require('../lib/board');
const { fixture, scoreboard } = require('./helpers');

const pool = p.loadPool();
const week3 = pool.weeks['3'];
const game = week3.games[0]; // Colts @ Chiefs
const scoreFrom = (fx) => e.buildScore(e.findEvent(fixture(fx), 'Colts', 'Chiefs'), 'Colts', 'Chiefs');

test('a TBD game renders with no score and no squares', () => {
  const tbd = pool.weeks['18'].games[2];
  const v = board.describeGame(pool, pool.weeks['18'], tbd, {});
  assert.strictEqual(v.tbd, true);
  assert.strictEqual(v.state, 'none');
  assert.strictEqual(v.score, null);
  assert.strictEqual(v.current, null);
  assert.strictEqual(v.statusDetail, 'Date TBD');
});

test('pregame shows the matchup but highlights no square', () => {
  const v = board.describeGame(pool, week3, game, { delayedScore: scoreFrom('scoreboard-20260920-pregame.json') });
  assert.strictEqual(v.state, 'pre');
  assert.strictEqual(v.current, null, 'no square is winning before kickoff');
  assert.strictEqual(v.halftime, null);
  assert.strictEqual(v.final, null);
  assert.strictEqual(v.matchup, 'Colts @ Chiefs');
});

test('halftime locks the halftime winner and leaves the final open', () => {
  const v = board.describeGame(pool, week3, game, { delayedScore: scoreFrom('synthetic-halftime.json') });
  // Chiefs 17 (home digit 7 -> col 0), Colts 14 (away digit 4 -> row 2)
  assert.deepStrictEqual(v.halftime, { home: 17, away: 14, row: 2, col: 0, owner: 'bernie 2' });
  assert.strictEqual(v.final, null);
  assert.deepStrictEqual(v.current, { row: 2, col: 0, owner: 'bernie 2' });
});

test('the highlighted square follows the DELAYED score while the clock stays live', () => {
  const delayed = scoreFrom('synthetic-halftime.json'); // 14-17 at the half
  const live = scoreFrom('synthetic-q3.json');          // 14-24, Q3 8:32
  const v = board.describeGame(pool, week3, game, { delayedScore: delayed, liveScore: live });
  assert.deepStrictEqual(v.score, { home: 17, away: 14 }, 'score is the delayed one');
  assert.strictEqual(v.period, 3, 'quarter is live');
  assert.strictEqual(v.clock, '8:32', 'clock is live');
  assert.deepStrictEqual(v.current, { row: 2, col: 0, owner: 'bernie 2' }, 'square follows the delayed score');
  // and with no delay the square moves to the live score
  const v2 = board.describeGame(pool, week3, game, { delayedScore: live, liveScore: live });
  assert.deepStrictEqual(v2.current, { row: 2, col: 4, owner: 'dave b' });
});

test('a final game reports both winners', () => {
  const v = board.describeGame(pool, week3, game, { delayedScore: scoreFrom('synthetic-homeaway-swapped.json') });
  assert.strictEqual(v.state, 'post');
  assert.ok(v.final);
  assert.strictEqual(v.final.home, 31);
  assert.strictEqual(v.final.away, 20);
  assert.ok(v.halftime, 'halftime is known once the game is over');
  assert.deepStrictEqual({ h: v.halftime.home, a: v.halftime.away }, { h: 14, a: 10 });
});

test('a fetch error is carried through to the view', () => {
  const v = board.describeGame(pool, week3, game, { error: 'ESPN 503' });
  assert.strictEqual(v.error, 'ESPN 503');
  assert.strictEqual(v.hasData, false);
});

test('ownerSquares reports the digit pair each square needs this week', () => {
  const sq = board.ownerSquares(pool, week3, 'brad mc');
  assert.deepStrictEqual(sq, [{ row: 7, col: 4, away: 8, home: 4 }]);
});

test('an owner holding several squares gets them all', () => {
  const multi = p.allOwners(pool).find((o) => p.squaresFor(pool, o).length > 1);
  assert.strictEqual(multi, undefined, 'this pool has one square per owner name');
});

test('tracked players get colours, needs, and season winnings', () => {
  const games = [board.describeGame(pool, week3, game, { delayedScore: scoreFrom('synthetic-q3.json') })];
  const t = board.buildTracked(pool, week3, ['brad mc', 'dave b'], games, { 'brad mc': 150, 'dave b': 150 });
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].owner, 'brad mc');
  assert.strictEqual(t[0].isBrad, true);
  assert.notStrictEqual(t[0].color, t[1].color, 'colours must differ');
  assert.strictEqual(t[0].seasonWinnings, 150);
  assert.deepStrictEqual(t[0].games[0].needs, ['8-4']);
  assert.strictEqual(t[0].games[0].status, 'waiting');
  assert.match(t[0].games[0].detail, /needs 8-4/);
  // dave b holds the currently winning square in Q3
  assert.strictEqual(t[1].games[0].status, 'leading');
  assert.strictEqual(t[1].games[0].detail, 'LEADING NOW');
});

test('a tracked winner shows the payout and accrues week winnings', () => {
  const games = [board.describeGame(pool, week3, game, { delayedScore: scoreFrom('synthetic-homeaway-swapped.json') })];
  const winner = games[0].final.owner;
  const t = board.buildTracked(pool, week3, [winner], games, {});
  assert.strictEqual(t[0].games[0].status, 'won');
  assert.match(t[0].games[0].detail, /won final \$150/);
  assert.strictEqual(t[0].weekWinnings, 150);
});

test('one player winning both squares of a game collects $300', () => {
  const v = board.describeGame(pool, week3, game, { delayedScore: scoreFrom('synthetic-homeaway-swapped.json') });
  const forced = { ...v, halftime: { ...v.halftime, owner: 'brad mc' }, final: { ...v.final, owner: 'brad mc' } };
  const t = board.buildTracked(pool, week3, ['brad mc'], [forced], {});
  assert.strictEqual(t[0].weekWinnings, 300);
  assert.deepStrictEqual(t[0].games[0].wins, ['halftime', 'final']);
});

test('the overlay maps every tracked square to its colour', () => {
  const t = board.buildTracked(pool, week3, ['brad mc', 'paige'], [], {});
  const o = board.trackOverlay(t);
  assert.strictEqual(o['7,4'].owner, 'brad mc');
  assert.strictEqual(o['7,4'].color, t[0].color);
  assert.strictEqual(Object.keys(o).length, 2);
});

test('tracking nobody is fine', () => {
  assert.deepStrictEqual(board.buildTracked(pool, week3, [], [], {}), []);
  assert.deepStrictEqual(board.trackOverlay([]), {});
});

test('pickActiveGame prefers an explicit pick, then live, then next up', () => {
  const g = (id, state, tbd = false) => ({ id, state, tbd });
  const games = [g('a', 'post'), g('b', 'in'), g('c', 'pre'), g('d', 'none', true)];
  assert.strictEqual(board.pickActiveGame(games), 'b', 'the live game wins');
  assert.strictEqual(board.pickActiveGame(games, 'c'), 'c', 'an explicit pick wins');
  assert.strictEqual(board.pickActiveGame(games, 'nope'), 'b', 'a bogus pick falls back');
  assert.strictEqual(board.pickActiveGame([g('a', 'post'), g('c', 'pre')]), 'c', 'next up');
  assert.strictEqual(board.pickActiveGame([g('a', 'post'), g('b', 'post')]), 'b', 'last played');
  assert.strictEqual(board.pickActiveGame([g('d', 'none', true)]), 'd', 'a TBD-only week still picks something');
  assert.strictEqual(board.pickActiveGame([]), null);
});
