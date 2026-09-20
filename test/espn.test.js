'use strict';
const test = require('node:test');
const assert = require('node:assert');
const e = require('../lib/espn');
const { fixture, scoreboard } = require('./helpers');

test('teamMatches resolves pool nicknames to ESPN teams', () => {
  const c = { team: { name: 'Chiefs', location: 'Kansas City', abbreviation: 'KC', displayName: 'Kansas City Chiefs', shortDisplayName: 'Chiefs' } };
  assert.ok(e.teamMatches('Chiefs', c));
  assert.ok(e.teamMatches('chiefs', c));
  assert.ok(e.teamMatches('KC', c));
  assert.ok(!e.teamMatches('Colts', c));
  assert.ok(!e.teamMatches('', c));
});

test('teamMatches handles the numeric nickname', () => {
  const sf = { team: { name: '49ers', abbreviation: 'SF', displayName: 'San Francisco 49ers', shortDisplayName: '49ers' } };
  assert.ok(e.teamMatches('49ers', sf));
});

test('every pool nickname matches exactly one team in a full Sunday slate', () => {
  const sb = fixture('scoreboard-20260920-pregame.json');
  const comps = sb.events.flatMap((ev) => ev.competitions[0].competitors);
  for (const nick of ['Chiefs', 'Colts', 'Giants', 'Rams', 'Falcons', 'Packers', 'Jets', 'Bears', 'Bills']) {
    const hits = comps.filter((c) => e.teamMatches(nick, c));
    assert.ok(hits.length <= 1, `${nick} matched ${hits.length} teams — ambiguous`);
  }
});

test('findEvent locates a pool game in a 14-game slate', () => {
  const sb = fixture('scoreboard-20260920-pregame.json');
  const ev = e.findEvent(sb, 'Colts', 'Chiefs');
  assert.ok(ev);
  assert.strictEqual(ev.shortName, 'IND @ KC');
  assert.strictEqual(e.findEvent(sb, 'Colts', 'Jets'), null);
});

test('cumulativeQuarters turns per-quarter points into running totals', () => {
  const q = e.cumulativeQuarters(
    [{ value: 14 }, { value: 10 }, { value: 3 }, { value: 6 }],
    [{ value: 3 }, { value: 7 }, { value: 10 }, { value: 7 }],
  );
  assert.deepStrictEqual(q, [
    { quarter: 1, home: 14, away: 3 },
    { quarter: 2, home: 24, away: 10 },
    { quarter: 3, home: 27, away: 20 },
    { quarter: 4, home: 33, away: 27 },
  ]);
});

test('cumulativeQuarters stops at the shorter linescore array', () => {
  assert.strictEqual(e.cumulativeQuarters([{ value: 7 }, { value: 7 }], [{ value: 3 }]).length, 1);
  assert.deepStrictEqual(e.cumulativeQuarters([], []), []);
});

test('buildScore orients home/away by NAME, not ESPN homeAway flags', () => {
  // This fixture deliberately flips ESPN's homeAway flags: it claims the Colts
  // are home. The pool sheet says Chiefs are home, and the board must follow
  // the pool sheet. Chiefs scored 31, Colts 20.
  const sb = fixture('synthetic-homeaway-swapped.json');
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  assert.strictEqual(s.homeTeam, 'Kansas City Chiefs');
  assert.strictEqual(s.awayTeam, 'Indianapolis Colts');
  assert.strictEqual(s.homeTotal, 31);
  assert.strictEqual(s.awayTotal, 20);
  assert.strictEqual(s.espnHomeIsPoolHome, false, 'fixture should disagree with ESPN');
});

test('buildScore refuses an event where the visitor does not match', () => {
  const sb = fixture('scoreboard-20260920-pregame.json');
  const ev = e.findEvent(sb, 'Colts', 'Chiefs');
  assert.strictEqual(e.buildScore(ev, 'Jets', 'Chiefs'), null);
});

test('pregame: state pre, no halftime, no final', () => {
  const sb = fixture('scoreboard-20260920-pregame.json');
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  assert.strictEqual(s.state, 'pre');
  assert.strictEqual(s.period, 0);
  assert.strictEqual(e.halftimeScore(s), null);
  assert.strictEqual(e.finalScore(s), null);
  assert.ok(!e.isLive(s) && !e.isFinal(s));
});

test('halftime: STATUS_HALFTIME locks the halftime score', () => {
  const sb = fixture('synthetic-halftime.json');
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  assert.ok(e.isHalftime(s));
  assert.ok(e.isEndOfPeriod(s));
  assert.deepStrictEqual(e.halftimeScore(s), { home: 17, away: 14 });
  assert.strictEqual(e.finalScore(s), null, 'final must not be decided at halftime');
});

test('Q3 in progress: halftime stays locked at the end-of-Q2 score, not the live score', () => {
  const sb = fixture('synthetic-q3.json');
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  assert.strictEqual(s.period, 3);
  assert.ok(e.isLive(s));
  assert.ok(!e.isEndOfPeriod(s));
  assert.strictEqual(s.homeTotal, 24, 'live total has moved on');
  assert.deepStrictEqual(e.halftimeScore(s), { home: 17, away: 14 }, 'halftime is still the Q2 cumulative');
  assert.strictEqual(e.finalScore(s), null);
});

test('mid-first-half: halftime is not yet decided', () => {
  const sb = fixture('synthetic-halftime.json');
  const s = e.buildScore(e.findEvent(sb, 'Colts', 'Chiefs'), 'Colts', 'Chiefs');
  // Rewind to Q2 still running.
  const midQ2 = { ...s, period: 2, clock: '4:11', statusName: 'STATUS_IN_PROGRESS' };
  assert.strictEqual(e.halftimeScore(midQ2), null);
  // Q1 — only one linescore exists at all.
  const q1 = { ...s, period: 1, clock: '9:00', statusName: 'STATUS_IN_PROGRESS', quarterScores: s.quarterScores.slice(0, 1) };
  assert.strictEqual(e.halftimeScore(q1), null);
});

test('isEndOfPeriod recognises a zeroed clock and end-of-period statuses', () => {
  const base = { statusName: 'STATUS_IN_PROGRESS', clock: '5:00' };
  assert.ok(!e.isEndOfPeriod(base));
  assert.ok(e.isEndOfPeriod({ ...base, clock: '0:00' }));
  assert.ok(e.isEndOfPeriod({ ...base, clock: '0.0' }));
  assert.ok(e.isEndOfPeriod({ statusName: 'STATUS_END_PERIOD', clock: '' }));
  assert.ok(e.isEndOfPeriod({ statusName: 'STATUS_HALFTIME', clock: '' }));
});

test('real completed game: halftime and final both resolve', () => {
  const sb = scoreboard('2026-09-13');
  const s = e.buildScore(e.findEvent(sb, 'Cowboys', 'Giants'), 'Cowboys', 'Giants');
  assert.ok(e.isFinal(s));
  assert.deepStrictEqual(e.halftimeScore(s), { home: 14, away: 7 });
  assert.deepStrictEqual(e.finalScore(s), { home: 28, away: 20 });
});

test('overtime: final uses the game total, not the 4th-quarter cumulative', () => {
  const sb = scoreboard('2026-09-13');
  const s = e.buildScore(e.findEvent(sb, 'Saints', 'Lions'), 'Saints', 'Lions');
  assert.strictEqual(s.period, 5, 'this game went to OT');
  assert.strictEqual(s.quarterScores.length, 5);
  const q4 = s.quarterScores[3];
  assert.deepStrictEqual(e.finalScore(s), { home: 31, away: 30 });
  assert.notDeepStrictEqual({ home: q4.home, away: q4.away }, e.finalScore(s), 'OT points must count');
  assert.deepStrictEqual(e.halftimeScore(s), { home: 7, away: 0 });
});
