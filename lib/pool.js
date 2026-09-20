'use strict';
/**
 * Pool data: owners grid, per-week digits, games, winning-square math,
 * pool-week-by-date. Pure functions — no network, no clock except what's passed in.
 */
const fs = require('fs');
const path = require('path');

const SEASON_START_YEAR = 2026;
const TZ = 'America/New_York';
const PAYOUT_HALFTIME = 150;
const PAYOUT_FINAL = 150;
const BRAD = 'brad mc';

const DATA_PATH = path.join(__dirname, '..', 'data', 'pool-2026.json');

let _pool = null;
function loadPool(file = DATA_PATH) {
  if (_pool && file === DATA_PATH) return _pool;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = normalize(raw);
  if (file === DATA_PATH) _pool = pool;
  return pool;
}
function clearCache() { _pool = null; }

function normalize(raw) {
  const owners = raw.owners_rows_away_top_to_bottom_cols_home_left_to_right;
  if (!Array.isArray(owners) || owners.length !== 10) throw new Error('owners grid must be 10 rows');
  owners.forEach((r, i) => { if (r.length !== 10) throw new Error(`owners row ${i} must be 10 cols`); });

  const weeks = {};
  for (const wk of Object.keys(raw.weeks)) {
    const w = raw.weeks[wk];
    weeks[wk] = {
      week: Number(wk),
      home: w.home,
      away: w.away,
      games: w.games.map((g, i) => {
        const [date, dow, visitor, home, start] = g;
        const tbd = !date || date === 'TBD';
        return {
          week: Number(wk),
          index: i,
          id: `w${wk}g${i}`,
          date: tbd ? null : date,
          isoDate: tbd ? null : toIsoDate(date, Number(wk)),
          dow: tbd ? 'TBD' : dow,
          visitor, home,
          start: !start || start === 'TBD' ? null : start,
          tbd,
        };
      }),
    };
  }
  return { source: raw.source, rules: raw.rules, owners, weeks, weekNumbers: Object.keys(weeks).map(Number).sort((a, b) => a - b) };
}

/** "M/D" -> "YYYY-MM-DD". NFL season spans two calendar years: Aug-Dec = start year, Jan-Feb = +1. */
function toIsoDate(md, week) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(md).trim());
  if (!m) throw new Error(`bad date ${md}`);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = month >= 6 ? SEASON_START_YEAR : SEASON_START_YEAR + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ESPN scoreboard ?dates= param form. */
function espnDateParam(isoDate) { return isoDate.replace(/-/g, ''); }

/** Today's date in ET as YYYY-MM-DD. */
function todayET(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/**
 * Pool weeks start Sunday night and run through the following Saturday.
 * Week N is current from the calendar date of its first game until the
 * calendar date of week N+1's first game.
 */
function poolWeekForDate(pool, isoDate) {
  const starts = pool.weekNumbers.map((n) => {
    const g = pool.weeks[String(n)].games.find((x) => x.isoDate);
    return { week: n, start: g ? g.isoDate : null };
  }).filter((x) => x.start);
  let current = starts[0].week;
  for (const s of starts) if (isoDate >= s.start) current = s.week;
  return current;
}
function currentPoolWeek(pool, now = new Date()) { return poolWeekForDate(pool, todayET(now)); }

/**
 * The winning square for a score.
 * row = index of (away score % 10) in the week's away digits
 * col = index of (home score % 10) in the week's home digits
 */
function winningSquare(week, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  const row = week.away.indexOf(mod10(awayScore));
  const col = week.home.indexOf(mod10(homeScore));
  if (row < 0 || col < 0) return null;
  return { row, col };
}
function mod10(n) { return ((Math.trunc(n) % 10) + 10) % 10; }

function ownerAt(pool, row, col) {
  if (row == null || col == null || row < 0 || col < 0) return null;
  return pool.owners[row][col];
}
function winnerForScore(pool, week, homeScore, awayScore) {
  const sq = winningSquare(week, homeScore, awayScore);
  if (!sq) return null;
  return { ...sq, owner: ownerAt(pool, sq.row, sq.col) };
}

/** Every distinct owner name, sorted. */
function allOwners(pool) {
  const s = new Set();
  for (const r of pool.owners) for (const o of r) s.add(o);
  return [...s].sort((a, b) => a.localeCompare(b));
}
/** All [row,col] squares held by an owner. */
function squaresFor(pool, owner) {
  const out = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (pool.owners[r][c] === owner) out.push({ row: r, col: c });
  return out;
}
/** The digit pair an owner's square needs, for a given week. */
function digitsForSquare(week, row, col) { return { away: week.away[row], home: week.home[col] }; }

module.exports = {
  loadPool, clearCache, normalize, toIsoDate, espnDateParam, todayET,
  poolWeekForDate, currentPoolWeek, winningSquare, mod10, ownerAt, winnerForScore,
  allOwners, squaresFor, digitsForSquare,
  SEASON_START_YEAR, TZ, PAYOUT_HALFTIME, PAYOUT_FINAL, BRAD, DATA_PATH,
};
