'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../lib/pool');

const pool = p.loadPool();

test('owners grid is 10x10 with 100 distinct owners', () => {
  assert.strictEqual(pool.owners.length, 10);
  for (const row of pool.owners) assert.strictEqual(row.length, 10);
  assert.strictEqual(p.allOwners(pool).length, 100);
});

test('all 18 weeks load and total 64 pool games', () => {
  assert.deepStrictEqual(pool.weekNumbers, Array.from({ length: 18 }, (_, i) => i + 1));
  const total = pool.weekNumbers.reduce((n, w) => n + pool.weeks[String(w)].games.length, 0);
  assert.strictEqual(total, 64);
});

test('each week has 10 home and 10 away digits, each 0-9 exactly once', () => {
  for (const w of pool.weekNumbers) {
    const wk = pool.weeks[String(w)];
    for (const axis of ['home', 'away']) {
      assert.strictEqual(wk[axis].length, 10, `week ${w} ${axis} length`);
      assert.deepStrictEqual([...wk[axis]].sort((a, b) => a - b), [0,1,2,3,4,5,6,7,8,9], `week ${w} ${axis} digits`);
    }
  }
});

test('mod10 handles totals, zero and OT-sized scores', () => {
  assert.strictEqual(p.mod10(0), 0);
  assert.strictEqual(p.mod10(7), 7);
  assert.strictEqual(p.mod10(10), 0);
  assert.strictEqual(p.mod10(27), 7);
  assert.strictEqual(p.mod10(59), 9);
});

test('winningSquare: row from away digit, col from home digit', () => {
  const wk = pool.weeks['3']; // home [7,1,3,8,4,2,9,6,0,5] away [5,3,4,6,1,0,2,8,7,9]
  // away 28 -> 8 -> away index 7 ; home 24 -> 4 -> home index 4
  assert.deepStrictEqual(p.winningSquare(wk, 24, 28), { row: 7, col: 4 });
  // 0-0 pregame square
  assert.deepStrictEqual(p.winningSquare(wk, 0, 0), { row: 5, col: 8 });
});

test('winningSquare is orientation-sensitive (home and away are not interchangeable)', () => {
  const wk = pool.weeks['3'];
  assert.notDeepStrictEqual(p.winningSquare(wk, 24, 28), p.winningSquare(wk, 28, 24));
});

test("brad mc owns exactly one square at row 7 col 4", () => {
  assert.deepStrictEqual(p.squaresFor(pool, 'brad mc'), [{ row: 7, col: 4 }]);
  assert.strictEqual(p.ownerAt(pool, 7, 4), 'brad mc');
});

test('digitsForSquare gives the pair a square needs', () => {
  const wk = pool.weeks['3'];
  assert.deepStrictEqual(p.digitsForSquare(wk, 7, 4), { away: 8, home: 4 });
});

test('winnerForScore names the owner', () => {
  const wk = pool.weeks['3'];
  assert.deepStrictEqual(p.winnerForScore(pool, wk, 24, 28), { row: 7, col: 4, owner: 'brad mc' });
});

test('M/D dates resolve to the right calendar year across the New Year', () => {
  assert.strictEqual(pool.weeks['1'].games[0].isoDate, '2026-09-09');
  assert.strictEqual(pool.weeks['16'].games[0].isoDate, '2026-12-20');
  assert.strictEqual(pool.weeks['17'].games[0].isoDate, '2026-12-27');
  assert.strictEqual(pool.weeks['17'].games[2].isoDate, '2026-12-31');
  assert.strictEqual(pool.weeks['18'].games[0].isoDate, '2027-01-03');
  assert.strictEqual(pool.weeks['18'].games[1].isoDate, '2027-01-04');
});

test('TBD games carry no date and are flagged', () => {
  const tbd = pool.weeks['18'].games[2];
  assert.strictEqual(tbd.tbd, true);
  assert.strictEqual(tbd.isoDate, null);
  assert.strictEqual(tbd.visitor, 'Jets');
});

test('pool week by date: a week runs from its Sunday through the next Saturday', () => {
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-20'), 3);  // tonight, Colts at Chiefs
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-21'), 3);  // Monday
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-24'), 3);  // Thursday
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-26'), 3);  // Saturday, last day
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-27'), 4);  // next Sunday flips it
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-19'), 2);  // day before
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-13'), 2);
});

test('pool week clamps before the opener and after the finale', () => {
  assert.strictEqual(p.poolWeekForDate(pool, '2026-08-01'), 1);
  assert.strictEqual(p.poolWeekForDate(pool, '2026-09-09'), 1);
  assert.strictEqual(p.poolWeekForDate(pool, '2027-01-03'), 18);
  assert.strictEqual(p.poolWeekForDate(pool, '2027-03-01'), 18);
});

test('todayET reports the Eastern calendar date, not UTC', () => {
  // 2026-09-21T02:00Z is still Sunday the 20th in New York.
  assert.strictEqual(p.todayET(new Date('2026-09-21T02:00:00Z')), '2026-09-20');
  assert.strictEqual(p.todayET(new Date('2026-09-21T12:00:00Z')), '2026-09-21');
});

test('espnDateParam formats the scoreboard query', () => {
  assert.strictEqual(p.espnDateParam('2026-09-20'), '20260920');
});
