'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DelayBuffer, clampDelay, blend, MAX_DELAY } = require('../lib/delay');

const S = (n) => ({ tag: n, homeTotal: n, awayTotal: 0, period: 1, clock: '5:00', state: 'in', statusName: 'STATUS_IN_PROGRESS' });
const T0 = 1_000_000_000_000;

test('clampDelay pins the slider to 0-90 whole seconds', () => {
  assert.strictEqual(clampDelay(15), 15);
  assert.strictEqual(clampDelay(0), 0);
  assert.strictEqual(clampDelay(-5), 0);
  assert.strictEqual(clampDelay(500), MAX_DELAY);
  assert.strictEqual(clampDelay(90), 90);
  assert.strictEqual(clampDelay(12.6), 13);
  assert.strictEqual(clampDelay('30'), 30);
  assert.strictEqual(clampDelay('abc'), 0);
  assert.strictEqual(clampDelay(null), 0);
});

test('empty buffer yields nothing', () => {
  const b = new DelayBuffer();
  assert.deepStrictEqual(b.select(15, T0), { score: null, ready: false, ageMs: 0 });
  assert.strictEqual(b.latest, null);
});

test('a 15s delay serves the score that is at least 15s old', () => {
  const b = new DelayBuffer();
  b.push(S(0), T0);
  b.push(S(7), T0 + 20_000);   // touchdown at +20s
  b.push(S(7), T0 + 40_000);
  // At +30s, the touchdown is only 10s old — the TV has not shown it yet.
  assert.strictEqual(b.select(15, T0 + 30_000).score.tag, 0);
  // At +36s it is 16s old — reveal it.
  assert.strictEqual(b.select(15, T0 + 36_000).score.tag, 7);
});

test('zero delay serves the newest sample immediately', () => {
  const b = new DelayBuffer();
  b.push(S(0), T0);
  b.push(S(7), T0 + 20_000);
  assert.strictEqual(b.select(0, T0 + 20_000).score.tag, 7);
});

test('a bigger delay reaches further back, a smaller one catches up', () => {
  const b = new DelayBuffer();
  for (let i = 0; i <= 6; i++) b.push(S(i), T0 + i * 10_000); // a sample every 10s
  const now = T0 + 60_000;
  assert.strictEqual(b.select(0, now).score.tag, 6);
  assert.strictEqual(b.select(30, now).score.tag, 3);
  assert.strictEqual(b.select(60, now).score.tag, 0);
});

test('reads are non-destructive, so the delay can be changed both ways', () => {
  const b = new DelayBuffer();
  for (let i = 0; i <= 6; i++) b.push(S(i), T0 + i * 10_000);
  const now = T0 + 60_000;
  assert.strictEqual(b.select(30, now).score.tag, 3);
  assert.strictEqual(b.select(0, now).score.tag, 6, 'sliding the delay down must still work');
  assert.strictEqual(b.select(30, now).score.tag, 3, 'and back up again');
});

test('before the buffer has filled, it falls back to the oldest sample and says so', () => {
  const b = new DelayBuffer();
  b.push(S(3), T0);
  const r = b.select(15, T0 + 2_000);
  assert.strictEqual(r.score.tag, 3);
  assert.strictEqual(r.ready, false, 'caller should show a syncing hint');
  const r2 = b.select(15, T0 + 16_000);
  assert.strictEqual(r2.ready, true);
});

test('old samples are pruned but the buffer never empties', () => {
  const b = new DelayBuffer({ retainMs: 60_000 });
  for (let i = 0; i < 200; i++) b.push(S(i), T0 + i * 20_000);
  assert.ok(b.size <= 5, `buffer grew to ${b.size}`);
  assert.ok(b.size >= 1);
  assert.strictEqual(b.latest.tag, 199);
});

test('out-of-order samples are sorted into place', () => {
  const b = new DelayBuffer();
  b.push(S(2), T0 + 20_000);
  b.push(S(1), T0 + 10_000);
  assert.strictEqual(b.select(0, T0 + 30_000).score.tag, 2);
  assert.strictEqual(b.select(15, T0 + 30_000).score.tag, 1);
});

test('blend keeps the delayed score but takes the live clock and quarter', () => {
  const delayed = { homeTotal: 17, awayTotal: 14, period: 2, clock: '0:00', state: 'in', statusName: 'STATUS_HALFTIME', statusDetail: 'Halftime' };
  const live = { homeTotal: 24, awayTotal: 14, period: 3, clock: '8:32', state: 'in', statusName: 'STATUS_IN_PROGRESS', statusDetail: '8:32 - 3rd' };
  const out = blend(delayed, live);
  assert.strictEqual(out.homeTotal, 17, 'score stays delayed');
  assert.strictEqual(out.awayTotal, 14);
  assert.strictEqual(out.period, 3, 'quarter is live');
  assert.strictEqual(out.clock, '8:32', 'clock is live');
  assert.strictEqual(out.statusName, 'STATUS_HALFTIME', 'delayed status drives winner locking');
  assert.strictEqual(out.liveStatusName, 'STATUS_IN_PROGRESS');
});

test('blend tolerates a missing live sample and a missing delayed sample', () => {
  const delayed = { homeTotal: 3, period: 1, clock: '2:00' };
  assert.deepStrictEqual(blend(delayed, null), { ...delayed });
  assert.strictEqual(blend(null, { period: 2 }), null);
});
