'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-odds-'));

const pooling = require('../lib/pool');
const odds = require('../lib/odds');

const pool = pooling.loadPool();
const O = odds.loadOdds();

test('odds tables have 100 pairs each and sum to 100%', () => {
  for (const name of ['q1', 'half', 'q3', 'final']) {
    const t = O.tables[name];
    assert.equal(Object.keys(t).length, 100, name);
    const sum = Object.values(t).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${name} sums to ${sum}`);
  }
  assert.equal(O.games, 3295);
});

test('the well-known facts hold: 7-0 is the best final square and 8-2 never hit at halftime', () => {
  const half = O.tables.half; const fin = O.tables.final;
  const best = Object.keys(fin).sort((a, b) => fin[b] - fin[a])[0];
  assert.equal(best, '7-0');
  assert.equal(half['8-2'], 0);
  assert.equal(half['2-8'], 0);
  assert.ok(half['7-3'] + half['3-7'] > 0.08);
});

test('cellOdds maps a square through the week digits (rows = away, cols = home)', () => {
  const week = pool.weeks['1'];             // home [5,8,3,...], away [0,2,7,...]
  const c = odds.cellOdds(O, week, 2, 1);   // away digit 7, home digit 8
  assert.equal(c.away, 7); assert.equal(c.home, 8);
  assert.equal(c.half, O.tables.half['8-7']);
  assert.equal(c.final, O.tables.final['8-7']);
  assert.ok(Math.abs(c.expected - (150 * c.half + 150 * c.final)) < 1e-12);
});

test('ownerOdds sums every square the owner holds', () => {
  const week = pool.weeks['1'];
  const owner = pool.owners[0][0];
  const sq = pooling.squaresFor(pool, owner);
  const r = odds.ownerOdds(pool, O, week, owner);
  assert.equal(r.squares.length, sq.length);
  const half = sq.reduce((s, x) => s + O.tables.half[`${week.home[x.col]}-${week.away[x.row]}`], 0);
  assert.ok(Math.abs(r.half - half) < 1e-12);
});

test('leaderboard ranks every owner by expected $ per game, 1..n with no gaps', () => {
  const week = pool.weeks['3'];
  const lb = odds.leaderboard(pool, O, week);
  assert.equal(lb.length, pooling.allOwners(pool).length);
  lb.forEach((r, i) => assert.equal(r.rank, i + 1));
  for (let i = 1; i < lb.length; i++) assert.ok(lb[i - 1].expected >= lb[i].expected);
  // the whole board pays out $300 per game in expectation, split across owners
  const total = lb.reduce((s, r) => s + r.expected, 0);
  assert.ok(Math.abs(total - 300) < 1e-6, `board expectation ${total}`);
});

test('seasonExpected adds every week by its game count', () => {
  const owner = pooling.BRAD;
  const s = odds.seasonExpected(pool, O, owner);
  let sum = 0;
  for (const n of pool.weekNumbers) {
    const wk = pool.weeks[String(n)];
    sum += odds.ownerOdds(pool, O, wk, owner).expected * wk.games.length;
  }
  assert.ok(Math.abs(s.total - sum) < 1e-9);
  assert.ok(s.total > 0);
});

test('people leaderboard sums a person\'s squares and still pays out $300 per game', () => {
  const week = pool.weeks['2'];
  const dave = pooling.personFor(pool, 'dave');
  const p = odds.personOdds(pool, O, week, dave);
  const bySquares = dave.owners.reduce((s, o) => s + odds.ownerOdds(pool, O, week, o).expected, 0);
  assert.ok(Math.abs(p.expected - bySquares) < 1e-9);
  assert.equal(p.squares.length, 4);
  const lb = odds.peopleLeaderboard(pool, O, week);
  assert.equal(lb.length, 76);
  lb.forEach((r, i) => assert.equal(r.rank, i + 1));
  assert.ok(Math.abs(lb.reduce((s, r) => s + r.expected, 0) - 300) < 1e-6);
  const season = odds.seasonExpectedPerson(pool, O, dave);
  assert.ok(Math.abs(season - dave.owners.reduce((s, o) => s + odds.seasonExpected(pool, O, o).total, 0)) < 1e-9);
});

test('weekView carries a 10x10 grid whose cells name the owner at that square', () => {
  const v = odds.weekView(pool, O, pool.weeks['1'], { currentWeek: 3 });
  assert.equal(v.grid.length, 10);
  v.grid.forEach((row, r) => { assert.equal(row.length, 10); row.forEach((cell, c) => assert.equal(cell.owner, pool.owners[r][c])); });
  assert.equal(v.week.number, 1);
  assert.equal(v.currentWeek, 3);
  assert.equal(v.me, pooling.BRAD);
  assert.deepEqual(v.meOwners, [pooling.BRAD]);
  assert.equal(v.people.length, 76);
  assert.deepEqual(v.weeks, pool.weekNumbers);
});

test('GET /api/odds serves the current week by default, a chosen week, and 404 for a bad one; /odds is a page', async () => {
  const { app, store } = require('../server');
  const { fixture, fakeFetch } = require('./helpers');
  store.fetchImpl = fakeFetch({ 20260920: fixture('scoreboard-20260920-pregame.json') });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(base + '/api/odds');
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.week.number, store.state.week);
    assert.equal(j.leaderboard.length, pooling.allOwners(pool).length);
    r = await fetch(base + '/api/odds?week=7');
    j = await r.json();
    assert.equal(j.week.number, 7);
    assert.deepEqual(j.week.home, pool.weeks['7'].home);
    r = await fetch(base + '/api/odds?week=99');
    assert.equal(r.status, 404);
    r = await fetch(base + '/odds');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Squares odds'));
    r = await fetch(base + '/rankings');
    assert.equal(r.status, 200);
    assert.ok((await r.text()).includes('Squares rankings'));
  } finally { server.close(); }
});
