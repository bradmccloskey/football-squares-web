'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Isolate the on-disk cache so the suite never touches the live one.
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-test-'));

const p = require('../lib/pool');
const season = require('../lib/season');
const { scoreboard, fakeFetch } = require('./helpers');

const pool = p.loadPool();
const FIXTURE_DATES = ['2026-09-09', '2026-09-10', '2026-09-13', '2026-09-14', '2026-09-17'];
const fetchMap = Object.fromEntries(FIXTURE_DATES.map((d) => [d.replace(/-/g, ''), scoreboard(d)]));

// "today" is the Sunday of pool week 3, so weeks 1 and 2 are complete and
// tonight's game has not been played.
const opts = { today: '2026-09-20', fetchImpl: fakeFetch(fetchMap) };

test('gamesByDate buckets every dated pool game', () => {
  const m = season.gamesByDate(pool);
  const dated = pool.weekNumbers.reduce((n, w) => n + pool.weeks[String(w)].games.filter((g) => g.isoDate).length, 0);
  assert.strictEqual([...m.values()].reduce((n, a) => n + a.length, 0), dated);
  assert.deepStrictEqual(m.get('2026-09-20').map((g) => g.id), ['w3g0']);
  // Thanksgiving week stacks three games on one date.
  assert.strictEqual(m.get('2026-11-26').length, 3);
});

test('season-to-date resolves every completed pool game with no errors', async () => {
  const r = await season.computeSeason(pool, opts);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(Object.keys(r.results).length, 5, 'five pool games have been played');
});

test('computed winners match the real weeks 1-2 results', async () => {
  const { results } = await season.computeSeason(pool, opts);
  const w = (id) => ({
    ht: [results[id].halftime.away, results[id].halftime.home, results[id].halftime.owner],
    fin: [results[id].final.away, results[id].final.home, results[id].final.owner],
  });
  // Patriots 10 at Seahawks 13 (halftime 7-0)
  assert.deepStrictEqual(w('w1g0'), { ht: [7, 0, 'dave b'], fin: [10, 13, 'pete/todd'] });
  // 49ers 27 at Rams 7 (halftime 10-7)
  assert.deepStrictEqual(w('w1g1'), { ht: [10, 7, 'paige'], fin: [27, 7, 'carl/kurt/svenje 2'] });
  // Cowboys 20 at Giants 28 (halftime 7-14)
  assert.deepStrictEqual(w('w2g0'), { ht: [7, 14, 'bill 3'], fin: [20, 28, 'paul'] });
  // Broncos 10 at Chiefs 31 (halftime 7-14)
  assert.deepStrictEqual(w('w2g1'), { ht: [7, 14, 'bill 3'], fin: [10, 31, 'brian s'] });
  // Lions 31 at Bills 41 (halftime 10-27) — Brad's square
  assert.deepStrictEqual(w('w2g2'), { ht: [10, 27, 'brad mc'], fin: [31, 41, 'kelly a'] });
});

test('winnings pay $150 a square and total $300 a game', async () => {
  const r = await season.computeSeason(pool, opts);
  const total = Object.values(r.winnings).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 5 * 300, 'five games at $300 each');
  assert.strictEqual(r.winnings['bill 3'], 300, 'won both week 2 halftimes');
  assert.strictEqual(r.winnings['brad mc'], 150);
  assert.strictEqual(r.winnings['pete/todd'], 150);
});

test('standings sort by winnings then name, and list only real owners', async () => {
  const r = await season.computeSeason(pool, opts);
  const s = season.standings(pool, r.winnings);
  assert.strictEqual(s.length, 100, 'every owner appears');
  assert.strictEqual(s[0].owner, 'bill 3');
  assert.strictEqual(s[0].winnings, 300);
  const paid = s.filter((x) => x.winnings > 0);
  assert.strictEqual(paid.length, 9);
  for (let i = 1; i < paid.length; i++) assert.ok(paid[i - 1].winnings >= paid[i].winnings, 'descending');
});

test("tonight's game is excluded until it is played", async () => {
  const r = await season.computeSeason(pool, opts);
  assert.ok(!r.results.w3g0, 'Colts at Chiefs has not happened yet');
});

test('a date that fails to fetch is reported, not silently dropped', async () => {
  const keep = process.env.SQUARES_CACHE_DIR;
  process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-empty-'));
  try {
    const r = await season.computeSeason(pool, { today: '2026-09-20', fetchImpl: fakeFetch({}) });
    assert.ok(r.errors.length > 0, 'ESPN failures must surface');
    assert.strictEqual(Object.keys(r.results).length, 0);
  } finally { process.env.SQUARES_CACHE_DIR = keep; }
});

test('a finished date is cached to disk and served without re-fetching', async () => {
  const dir = process.env.SQUARES_CACHE_DIR;
  await season.computeSeason(pool, opts);
  assert.ok(fs.existsSync(path.join(dir, 'scoreboard-20260913.json')), 'cache file written');
  let calls = 0;
  const counting = async (...a) => { calls++; return fakeFetch(fetchMap)(...a); };
  const r2 = await season.computeSeason(pool, { today: '2026-09-20', fetchImpl: counting });
  assert.strictEqual(calls, 0, 'final games are never re-fetched');
  assert.strictEqual(Object.keys(r2.results).length, 5);
});

test('allFinal is false when a game on that date is still live', () => {
  const sb = JSON.parse(JSON.stringify(scoreboard('2026-09-13')));
  const games = [pool.weeks['2'].games[0]];
  assert.ok(season.allFinal(pool, sb, games));
  const comp = sb.events.find((e) => e.shortName === 'DAL @ NYG').competitions[0];
  comp.status.type = { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false };
  assert.ok(!season.allFinal(pool, sb, games));
});
