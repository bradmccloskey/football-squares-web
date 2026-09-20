'use strict';
/**
 * Demo server: the real app, but tonight's Colts-Chiefs game is replayed from a
 * recorded fixture so the live board can be exercised without waiting for
 * kickoff. Every other date still hits the real ESPN API.
 *
 *   node scripts/demo.js halftime   # Q2 over, halftime square locked
 *   node scripts/demo.js q3         # Q3 running, halftime locked, score moved on
 *   node scripts/demo.js final      # game over, both squares paid
 *
 * Listens on PORT (default 8098). Never use this for the real pool.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-demo-'));

const MODES = { halftime: 'synthetic-halftime.json', q3: 'synthetic-q3.json', final: 'synthetic-homeaway-swapped.json' };
const mode = process.argv[2] || 'q3';
if (!MODES[mode]) { console.error('modes: ' + Object.keys(MODES).join(', ')); process.exit(1); }

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', MODES[mode]), 'utf8'));
const { app, store } = require('../server');

store.fetchImpl = async function (url, opts) {
  if (/dates=20260920/.test(String(url))) return { ok: true, status: 200, json: async () => fixture };
  return fetch(url, opts);
};

const PORT = Number(process.env.PORT || 8098);
(async () => {
  // Pin the game: once it is final the board would otherwise advance to the
  // next game of the week, which is exactly what it should do in real use.
  store.setState({ week: 3, gameId: 'w3g0', tracked: ['brad mc', 'bill 3', 'paige', 'dave b', 'bernie 1', 'possum 2'] });
  await store.refresh();
  await store.refreshSeason();
  store.start();
  app.listen(PORT, '0.0.0.0', () => console.log(`[squares DEMO ${mode}] http://127.0.0.1:${PORT}/tv`));
})();
