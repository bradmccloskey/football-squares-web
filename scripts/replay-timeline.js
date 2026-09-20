'use strict';
/**
 * A scripted Colts-at-Chiefs game, used by `scripts/demo.js replay` to prove the
 * delay works: the score changes every 20 seconds, so with the slider at 15s the
 * board visibly lags the "live" clock, and at 0s it tracks it exactly.
 *
 * Each step: seconds since start, period, clock, ESPN status, and the
 * per-quarter points so far for each side (home = Chiefs, away = Colts).
 */
const STEPS = [
  { at:   0, period: 1, clock: '15:00', status: 'STATUS_IN_PROGRESS', state: 'in', home: [0],           away: [0] },
  { at:  20, period: 1, clock: '10:22', status: 'STATUS_IN_PROGRESS', state: 'in', home: [7],           away: [0] },
  { at:  40, period: 1, clock: '3:09',  status: 'STATUS_IN_PROGRESS', state: 'in', home: [7],           away: [7] },
  { at:  60, period: 2, clock: '12:41', status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 7],        away: [7, 0] },
  { at:  80, period: 2, clock: '5:03',  status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 7],        away: [7, 3] },
  { at: 100, period: 2, clock: '0:00',  status: 'STATUS_HALFTIME',    state: 'in', home: [7, 10],       away: [7, 3] },
  // halftime holds: 17-10, halftime square locks here
  { at: 140, period: 3, clock: '11:18', status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 10, 0],    away: [7, 3, 7] },
  { at: 160, period: 3, clock: '4:55',  status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 10, 7],    away: [7, 3, 7] },
  { at: 180, period: 4, clock: '9:30',  status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 10, 7, 0], away: [7, 3, 7, 3] },
  { at: 200, period: 4, clock: '1:12',  status: 'STATUS_IN_PROGRESS', state: 'in', home: [7, 10, 7, 3], away: [7, 3, 7, 3] },
  { at: 220, period: 4, clock: '0:00',  status: 'STATUS_FINAL',       state: 'post', home: [7, 10, 7, 3], away: [7, 3, 7, 6] },
];

function stepAt(seconds) {
  let cur = STEPS[0];
  for (const s of STEPS) if (seconds >= s.at) cur = s;
  return cur;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Build an ESPN-shaped scoreboard payload for this point in the scripted game. */
function payloadAt(seconds, template) {
  const step = stepAt(seconds);
  const p = JSON.parse(JSON.stringify(template));
  const comp = p.events[0].competitions[0];
  const kc = comp.competitors.find((c) => c.team.abbreviation === 'KC');
  const ind = comp.competitors.find((c) => c.team.abbreviation === 'IND');
  kc.score = String(sum(step.home));
  ind.score = String(sum(step.away));
  kc.linescores = step.home.map((v) => ({ value: v }));
  ind.linescores = step.away.map((v) => ({ value: v }));
  comp.status = {
    clock: 0, displayClock: step.clock, period: step.period,
    type: {
      id: step.state === 'post' ? '3' : '2', name: step.status, state: step.state,
      completed: step.state === 'post',
      description: step.status, detail: step.clock, shortDetail: step.clock,
    },
  };
  return { payload: p, step, home: sum(step.home), away: sum(step.away) };
}

module.exports = { STEPS, stepAt, payloadAt, sum };
