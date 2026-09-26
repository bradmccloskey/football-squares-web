'use strict';
/**
 * Historical odds for each square: how often an NFL game has ended a period on
 * a given (home digit, visitor digit) pair. The table is keyed "home-away" and
 * comes from data/odds-2014-2025.json (nflverse play-by-play, 3,295 games,
 * checked independently by Marion 2026-09-26). Everything here is pure: the
 * pool and the week's digits are passed in, nothing reads the clock or the network.
 */
const fs = require('fs');
const path = require('path');
const pooling = require('./pool');

const DATA_PATH = path.join(__dirname, '..', 'data', 'odds-2014-2025.json');

let _odds = null;
function loadOdds(file = DATA_PATH) {
  if (_odds && file === DATA_PATH) return _odds;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const name of ['half', 'final']) {
    const t = raw.tables[name];
    const keys = Object.keys(t);
    if (keys.length !== 100) throw new Error(`odds table ${name} must have 100 pairs`);
    const sum = keys.reduce((s, k) => s + t[k], 0);
    if (Math.abs(sum - 1) > 1e-6) throw new Error(`odds table ${name} sums to ${sum}, not 1`);
  }
  if (file === DATA_PATH) _odds = raw;
  return raw;
}

/** P(period ends on home digit h and visitor digit a). */
function probFor(odds, period, homeDigit, awayDigit) {
  const t = odds.tables[period];
  if (!t) throw new Error(`no odds table for ${period}`);
  return t[`${homeDigit}-${awayDigit}`] || 0;
}

/** One square's odds for a week: rows are the week's away digits, columns its home digits. */
function cellOdds(odds, week, row, col) {
  const home = week.home[col];
  const away = week.away[row];
  const half = probFor(odds, 'half', home, away);
  const fin = probFor(odds, 'final', home, away);
  return { row, col, home, away, half, final: fin, expected: expectedPerGame(half, fin) };
}

/** Expected payout for one game given the two hit probabilities. */
function expectedPerGame(half, fin) {
  return half * pooling.PAYOUT_HALFTIME + fin * pooling.PAYOUT_FINAL;
}

/** Every square an owner holds, with the odds summed across them. */
function ownerOdds(pool, odds, week, owner) {
  const squares = pooling.squaresFor(pool, owner).map((s) => cellOdds(odds, week, s.row, s.col));
  const half = squares.reduce((s, x) => s + x.half, 0);
  const fin = squares.reduce((s, x) => s + x.final, 0);
  return { owner, squares, half, final: fin, expected: expectedPerGame(half, fin) };
}

/** Every owner ranked by expected payout per game for this week's digits (ties keep name order). */
function leaderboard(pool, odds, week) {
  const rows = pooling.allOwners(pool).map((o) => ownerOdds(pool, odds, week, o));
  rows.sort((a, b) => b.expected - a.expected || a.owner.localeCompare(b.owner));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/**
 * Expected winnings over the whole pool for one owner: each week's per-game
 * expectation times the number of pool games that week. Weeks with no dated
 * games still count their games (the digits are fixed even when dates are TBD).
 */
function seasonExpected(pool, odds, owner) {
  let total = 0;
  const byWeek = {};
  for (const n of pool.weekNumbers) {
    const week = pool.weeks[String(n)];
    const per = ownerOdds(pool, odds, week, owner).expected;
    byWeek[n] = { games: week.games.length, perGame: per, total: per * week.games.length };
    total += byWeek[n].total;
  }
  return { owner, total, byWeek };
}

/** The whole view the Odds page renders for one week. */
function weekView(pool, odds, week, { currentWeek = null, me = pooling.BRAD } = {}) {
  const grid = [];
  for (let r = 0; r < 10; r++) {
    const row = [];
    for (let c = 0; c < 10; c++) row.push({ owner: pool.owners[r][c], ...cellOdds(odds, week, r, c) });
    grid.push(row);
  }
  const board = leaderboard(pool, odds, week);
  const season = {};
  for (const o of pooling.allOwners(pool)) season[o] = seasonExpected(pool, odds, o).total;
  const totalGames = pool.weekNumbers.reduce((s, n) => s + pool.weeks[String(n)].games.length, 0);
  return {
    source: odds.source, games: odds.games, seasons: odds.seasons,
    payout: { halftime: pooling.PAYOUT_HALFTIME, final: pooling.PAYOUT_FINAL },
    week: { number: week.week, home: week.home, away: week.away, gameCount: week.games.length },
    weeks: pool.weekNumbers, currentWeek, me, totalGames,
    grid, leaderboard: board, season,
  };
}

module.exports = { loadOdds, probFor, cellOdds, expectedPerGame, ownerOdds, leaderboard, seasonExpected, weekView, DATA_PATH };
