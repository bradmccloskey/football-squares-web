'use strict';
/**
 * ESPN public scoreboard adapter.
 *
 * Two hard-won lessons ported from the iOS app (apps/FootballSquares):
 *  1. Match a game by TEAM NAME, never by ESPN's homeAway flags — they sometimes
 *     disagree with the pool sheet's visitor/home orientation.
 *  2. linescores are PER-QUARTER points; cumulative running totals must be
 *     summed. quarterScores[1] is the halftime score.
 */

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does an ESPN competitor represent this pool-sheet team nickname? */
function teamMatches(nickname, competitor) {
  const t = (competitor && competitor.team) || {};
  const n = norm(nickname);
  if (!n) return false;
  // ESPN's team.name is exactly the nickname the pool sheet uses ("Chiefs", "49ers").
  if (norm(t.name) === n) return true;
  if (norm(t.abbreviation) === n) return true;
  if (norm(t.shortDisplayName) === n) return true;
  const dn = norm(t.displayName);
  if (dn && dn.endsWith(n)) return true;
  // Last resort, as in the iOS app.
  return !!(dn && n.length >= 3 && (dn.includes(n) || n.includes(dn)));
}

function competitorsOf(event) {
  const comp = event && event.competitions && event.competitions[0];
  if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) return null;
  return comp;
}

/** Find the event for a pool game (visitor + home nicknames) in a scoreboard payload. */
function findEvent(payload, visitor, home) {
  const events = (payload && payload.events) || [];
  for (const ev of events) {
    const comp = competitorsOf(ev);
    if (!comp) continue;
    const hasHome = comp.competitors.some((c) => teamMatches(home, c));
    const hasVisitor = comp.competitors.some((c) => teamMatches(visitor, c));
    if (hasHome && hasVisitor) return ev;
  }
  return null;
}

const STATE = { pre: 'pre', in: 'in', post: 'post' };

/**
 * Build a normalized score for a pool game from an ESPN event.
 * "home"/"away" here always mean the POOL SHEET's orientation (column/row axes),
 * resolved by name — not ESPN's homeAway flag.
 */
function buildScore(event, visitor, home) {
  const comp = competitorsOf(event);
  if (!comp) return null;
  const [c0, c1] = comp.competitors;
  const poolHome = teamMatches(home, c0) ? c0 : c1;
  const poolAway = poolHome === c0 ? c1 : c0;
  // Guard: if the visitor nickname does not match the other competitor, the
  // event was a bad match and we refuse rather than show a wrong board.
  if (!teamMatches(visitor, poolAway)) return null;

  const status = comp.status || {};
  const type = status.type || {};
  const state = STATE[type.state] || 'pre';
  const quarterScores = cumulativeQuarters(lines(poolHome), lines(poolAway));

  return {
    eventId: event.id,
    homeTeam: poolHome.team.displayName,
    awayTeam: poolAway.team.displayName,
    homeAbbr: poolHome.team.abbreviation,
    awayAbbr: poolAway.team.abbreviation,
    homeTotal: toInt(poolHome.score),
    awayTotal: toInt(poolAway.score),
    period: status.period || 0,
    clock: status.displayClock || '',
    state,
    statusName: type.name || '',
    statusDetail: type.shortDetail || type.description || '',
    completed: !!type.completed,
    startDate: event.date || null,
    quarterScores,
    espnHomeIsPoolHome: poolHome.homeAway === 'home',
  };
}

function lines(c) { return (c && c.linescores) || []; }
function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }

/** Per-quarter points -> running cumulative totals. */
function cumulativeQuarters(homeLines, awayLines) {
  const out = [];
  let h = 0, a = 0;
  const n = Math.min(homeLines.length, awayLines.length);
  for (let i = 0; i < n; i++) {
    h += Number(homeLines[i].value) || 0;
    a += Number(awayLines[i].value) || 0;
    out.push({ quarter: i + 1, home: h, away: a });
  }
  return out;
}

const END_STATUSES = new Set(['STATUS_END_PERIOD', 'STATUS_HALFTIME', 'STATUS_END_OF_PERIOD']);
/** Current period has ended but the next has not started. */
function isEndOfPeriod(score) {
  if (!score) return false;
  if (END_STATUSES.has(score.statusName)) return true;
  const c = String(score.clock || '').trim();
  return c === '0:00' || c === '0.0' || c === '0:00.0';
}
function isHalftime(score) { return !!score && score.statusName === 'STATUS_HALFTIME'; }
function isFinal(score) { return !!score && (score.state === 'post' || score.completed); }
function isLive(score) { return !!score && score.state === 'in'; }

/**
 * The halftime score, once it is locked in (Q2 over).
 * Returns null while the first half is still being played.
 */
function halftimeScore(score) {
  if (!score) return null;
  const q2 = score.quarterScores[1];
  if (!q2) return null;
  const locked = isFinal(score) || score.period > 2 || (score.period === 2 && isEndOfPeriod(score)) || isHalftime(score);
  if (!locked) return null;
  return { home: q2.home, away: q2.away };
}

/** The final score, once the game is over (includes OT). */
function finalScore(score) {
  if (!isFinal(score)) return null;
  return { home: score.homeTotal, away: score.awayTotal };
}

async function fetchScoreboard(isoDate, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const dates = isoDate.replace(/-/g, '');
  const url = `${SCOREBOARD}?dates=${dates}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { 'user-agent': 'football-squares-web/1.0' } });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${dates}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function fetchSummary(eventId, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${SUMMARY}?event=${eventId}`, { signal: ac.signal, headers: { 'user-agent': 'football-squares-web/1.0' } });
    if (!res.ok) throw new Error(`ESPN summary ${res.status} for ${eventId}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

module.exports = {
  SCOREBOARD, SUMMARY, teamMatches, findEvent, buildScore, cumulativeQuarters,
  isEndOfPeriod, isHalftime, isFinal, isLive, halftimeScore, finalScore,
  fetchScoreboard, fetchSummary, norm,
};
