'use strict';
/**
 * Score delay buffer — ported from the iOS app's applyDelayedScore().
 *
 * The TV is behind the ESPN feed by ~10-20s. We hold each score sample and
 * only reveal it once it is at least `delaySeconds` old, so the highlighted
 * square changes when the touchdown appears on screen, not before.
 *
 * Quarter/clock are NOT delayed — the caller blends live clock with the
 * delayed score (see blend()).
 *
 * Unlike the iOS version this buffer is non-destructive on read: the server
 * serves many clients and the delay can be changed at any moment, so samples
 * are kept for a window rather than consumed.
 */

const MAX_DELAY = 90;
const RETAIN_MS = (MAX_DELAY + 60) * 1000;

class DelayBuffer {
  constructor({ retainMs = RETAIN_MS } = {}) {
    this.retainMs = retainMs;
    this.samples = []; // ascending by at
  }

  push(score, at = Date.now()) {
    this.samples.push({ at, score });
    this.samples.sort((a, b) => a.at - b.at);
    this.prune(at);
    return this;
  }

  prune(now = Date.now()) {
    const cutoff = now - this.retainMs;
    // Always keep at least one sample so the board never goes blank.
    while (this.samples.length > 1 && this.samples[0].at < cutoff) this.samples.shift();
  }

  get latest() { return this.samples.length ? this.samples[this.samples.length - 1].score : null; }
  get size() { return this.samples.length; }

  /**
   * The newest sample at least `delaySeconds` old.
   * ready=false means the buffer has not filled yet and we are falling back to
   * the oldest sample we have (less delayed than asked for).
   */
  select(delaySeconds = 0, now = Date.now()) {
    if (!this.samples.length) return { score: null, ready: false, ageMs: 0 };
    const d = clampDelay(delaySeconds);
    const cutoff = now - d * 1000;
    let chosen = null;
    for (const s of this.samples) { if (s.at <= cutoff) chosen = s; else break; }
    if (chosen) return { score: chosen.score, ready: true, ageMs: now - chosen.at };
    const oldest = this.samples[0];
    return { score: oldest.score, ready: false, ageMs: now - oldest.at };
  }
}

function clampDelay(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DELAY, Math.max(0, Math.round(n)));
}

/**
 * Delayed score + live clock/quarter/state, exactly like the iOS hybrid.
 * The winning square must come from `delayed`; the clock readout from `live`.
 */
function blend(delayed, live) {
  if (!delayed) return null;
  if (!live) return { ...delayed };
  return {
    ...delayed,
    period: live.period,
    clock: live.clock,
    state: live.state,
    statusDetail: live.statusDetail,
    liveStatusName: live.statusName,
  };
}

module.exports = { DelayBuffer, clampDelay, blend, MAX_DELAY };
