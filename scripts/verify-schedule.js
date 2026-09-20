'use strict';
/**
 * Live check against the real ESPN API: every dated pool game in the sheet must
 * be found and parsed. Run it any time you edit data/pool-2026.json (and after
 * filling in a TBD game) to prove the matchup still resolves.
 *
 *   node scripts/verify-schedule.js
 *
 * Exits non-zero if anything fails to resolve. Needs network; ~55 requests.
 */
const pooling = require('../lib/pool');
const espn = require('../lib/espn');

(async () => {
  const pool = pooling.loadPool();
  const byDate = new Map();
  let tbd = 0;
  for (const n of pool.weekNumbers) {
    for (const g of pool.weeks[String(n)].games) {
      if (!g.isoDate) { tbd++; continue; }
      if (!byDate.has(g.isoDate)) byDate.set(g.isoDate, []);
      byDate.get(g.isoDate).push(g);
    }
  }
  const dates = [...byDate.keys()].sort();
  const dated = [...byDate.values()].reduce((a, b) => a + b.length, 0);
  console.log(`pool games: ${dated + tbd}  dated: ${dated}  TBD: ${tbd}  distinct dates: ${dates.length}`);

  const fails = [];
  let ok = 0, finals = 0;
  for (const d of dates) {
    let payload;
    try { payload = await espn.fetchScoreboard(d); }
    catch (e) { byDate.get(d).forEach((g) => fails.push(`${g.id} ${d} ${g.visitor}@${g.home}: fetch failed (${e.message})`)); continue; }
    for (const g of byDate.get(d)) {
      const ev = espn.findEvent(payload, g.visitor, g.home);
      const s = ev && espn.buildScore(ev, g.visitor, g.home);
      if (!s) { fails.push(`${g.id} ${d} ${g.visitor}@${g.home}: ${ev ? 'team match failed' : 'no ESPN event'}`); continue; }
      ok++;
      if (espn.isFinal(s)) finals++;
      if (!s.espnHomeIsPoolHome) console.log(`  note: ESPN home/away disagrees with the sheet for ${g.visitor}@${g.home} (${d}) — resolved by name`);
    }
    await new Promise((r) => setTimeout(r, 120)); // be polite
  }

  console.log(`resolved: ${ok}/${dated}   already final: ${finals}   failed: ${fails.length}`);
  fails.forEach((f) => console.log('  FAIL ' + f));
  process.exit(fails.length ? 1 : 0);
})();
