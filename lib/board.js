'use strict';
/**
 * Pure assembly of the view model the browser renders.
 * No network, no clock — everything is passed in, so it is all testable.
 */
const pooling = require('./pool');
const espn = require('./espn');
const { blend } = require('./delay');

const TRACK_COLORS = [
  '#ff5c5c', '#39d98a', '#4ea8ff', '#ffc542', '#c77dff',
  '#00d6d6', '#ff8a3d', '#7ee787', '#ff6fb5', '#9aa7ff',
];

/**
 * One game's view: delayed score drives the squares, live clock drives the readout.
 * `delayedScore` and `liveScore` are espn.buildScore() shapes (or null).
 */
function describeGame(pool, week, game, { delayedScore = null, liveScore = null, delayReady = true, error = null } = {}) {
  const base = {
    id: game.id, week: game.week, index: game.index,
    date: game.date, isoDate: game.isoDate, dow: game.dow,
    visitor: game.visitor, home: game.home, start: game.start, tbd: game.tbd,
    matchup: `${game.visitor} @ ${game.home}`,
    error,
    hasData: false, delayReady,
    state: 'none', statusDetail: game.tbd ? 'Date TBD' : `${game.dow} ${game.date} ${game.start || ''}`.trim(),
    period: 0, clock: '',
    score: null, current: null, halftime: null, final: null,
    homeTeam: game.home, awayTeam: game.visitor, homeAbbr: null, awayAbbr: null,
  };
  if (!delayedScore) return base;

  const shown = blend(delayedScore, liveScore);
  // Winners are always derived from the DELAYED sample so nothing is revealed
  // before it happens on the TV.
  const ht = espn.halftimeScore(delayedScore);
  const fin = espn.finalScore(delayedScore);
  const showSquare = delayedScore.state !== 'pre';

  return {
    ...base,
    hasData: true,
    state: shown.state,
    statusDetail: shown.statusDetail || base.statusDetail,
    period: shown.period,
    clock: shown.clock,
    homeTeam: shown.homeTeam, awayTeam: shown.awayTeam,
    homeAbbr: shown.homeAbbr, awayAbbr: shown.awayAbbr,
    score: { home: delayedScore.homeTotal, away: delayedScore.awayTotal },
    quarterScores: delayedScore.quarterScores,
    current: showSquare ? pooling.winnerForScore(pool, week, delayedScore.homeTotal, delayedScore.awayTotal) : null,
    halftime: ht ? { ...ht, ...pooling.winnerForScore(pool, week, ht.home, ht.away) } : null,
    final: fin ? { ...fin, ...pooling.winnerForScore(pool, week, fin.home, fin.away) } : null,
  };
}

/** Winning-square digits an owner needs, for this week. Same for every game in the week. */
function ownerSquares(pool, week, owner) {
  return pooling.squaresFor(pool, owner).map(({ row, col }) => ({
    row, col, ...pooling.digitsForSquare(week, row, col),
  }));
}

/**
 * Per-tracked-player detail: their squares, what they need in each game of the
 * week, and what they have already won.
 */
function buildTracked(pool, week, trackedOwners, games, seasonWinnings = {}) {
  return trackedOwners.map((owner, i) => {
    const squares = ownerSquares(pool, week, owner);
    const color = TRACK_COLORS[i % TRACK_COLORS.length];
    let weekWinnings = 0;
    const perGame = games.map((g) => {
      const wins = [];
      if (g.halftime && g.halftime.owner === owner) { wins.push('halftime'); weekWinnings += pooling.PAYOUT_HALFTIME; }
      if (g.final && g.final.owner === owner) { wins.push('final'); weekWinnings += pooling.PAYOUT_FINAL; }
      const leading = !!(g.current && g.current.owner === owner && g.state === 'in');
      let status = 'waiting';
      if (wins.length) status = 'won';
      else if (leading) status = 'leading';
      else if (g.state === 'post') status = 'done';
      else if (g.state === 'pre' || !g.hasData) status = 'pregame';
      return {
        gameId: g.id, matchup: g.matchup, status, leading, wins,
        // Same digits all week, but repeated per game so the UI stays dumb.
        needs: squares.map((s) => `${s.away}-${s.home}`),
        detail: wins.length
          ? wins.map((w) => (w === 'halftime' ? `won halftime $${pooling.PAYOUT_HALFTIME}` : `won final $${pooling.PAYOUT_FINAL}`)).join(' + ')
          : leading ? 'LEADING NOW'
          : `needs ${squares.map((s) => `${s.away}-${s.home}`).join(' or ')}`,
      };
    });
    return {
      owner, color, squares,
      seasonWinnings: seasonWinnings[owner] || 0,
      weekWinnings,
      games: perGame,
      isBrad: owner === pooling.BRAD,
    };
  });
}

/** Squares to outline on the board, owner -> color. */
function trackOverlay(tracked) {
  const map = {};
  for (const t of tracked) for (const s of t.squares) map[`${s.row},${s.col}`] = { color: t.color, owner: t.owner };
  return map;
}

module.exports = { describeGame, buildTracked, ownerSquares, trackOverlay, TRACK_COLORS };

/**
 * Which game the big board shows. Server-side so the TV and the phone always
 * agree. An explicit pick wins; otherwise: the live game, else the next one to
 * kick off, else the last one played.
 */
function pickActiveGame(games, explicitId = null) {
  const playable = games.filter((g) => !g.tbd);
  if (!playable.length) return games.length ? games[0].id : null;
  if (explicitId) {
    const hit = games.find((g) => g.id === explicitId);
    if (hit) return hit.id;
  }
  const live = playable.find((g) => g.state === 'in');
  if (live) return live.id;
  const upcoming = playable.find((g) => g.state !== 'post');
  if (upcoming) return upcoming.id;
  return playable[playable.length - 1].id;
}
module.exports.pickActiveGame = pickActiveGame;
