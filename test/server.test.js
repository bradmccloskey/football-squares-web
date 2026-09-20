'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-http-'));

const { app, store } = require('../server');
const { fixture, fakeFetch } = require('./helpers');

// Never touch the network from the suite.
store.fetchImpl = fakeFetch({ 20260920: fixture('scoreboard-20260920-pregame.json') });

let base;
let server;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  store.setState({ week: 3 });
  await store.refresh();
});
test.after(() => server && server.close());

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};

test('GET /api/health reports the current pool week', async () => {
  const { status, body } = await get('/api/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.currentWeek, 3, 'today is in pool week 3');
});

test('GET /api/owners lists all 100 names for the picker', async () => {
  const { body } = await get('/api/owners');
  assert.strictEqual(body.owners.length, 100);
  assert.ok(body.owners.includes('brad mc'));
});

test('GET /api/live returns a full board snapshot', async () => {
  const { status, body } = await get('/api/live');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.owners.length, 10);
  assert.strictEqual(body.games.length, 3);
  assert.strictEqual(body.digits.home.length, 10);
  assert.ok(body.mySquare);
  assert.strictEqual(body.games[0].matchup, 'Colts @ Chiefs');
});

test('POST /api/state is shared: what the phone sets, the TV reads back', async () => {
  const set = await post('/api/state', { week: 5, delaySeconds: 25, tracked: ['brad mc', 'paige'] });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(set.body.week, 5);
  const { body } = await get('/api/state');
  assert.strictEqual(body.week, 5);
  assert.strictEqual(body.delaySeconds, 25);
  assert.deepStrictEqual(body.tracked, ['brad mc', 'paige']);
  // and it shows up in the snapshot both views render from
  const live = await get('/api/live');
  assert.strictEqual(live.body.state.week, 5);
  assert.strictEqual(live.body.tracked.length, 2);
  assert.ok(live.body.overlay['7,4']);
});

test('POST /api/state rejects bad input without a 500', async () => {
  const { status, body } = await post('/api/state', { week: 999, delaySeconds: 9999, tracked: ['ghost'] });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.week, 5, 'kept the last good week');
  assert.strictEqual(body.delaySeconds, 90);
  assert.deepStrictEqual(body.tracked, []);
});

test('an empty POST body is harmless', async () => {
  const { status } = await post('/api/state', {});
  assert.strictEqual(status, 200);
});

test('GET /api/season returns standings', async () => {
  const { status, body } = await get('/api/season');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.standings));
  assert.strictEqual(body.standings.length, 100);
});

test('both views are served', async () => {
  for (const p of ['/', '/tv']) {
    const r = await fetch(base + p);
    assert.strictEqual(r.status, 200, p);
    const html = await r.text();
    assert.match(html, /<html|<!doctype/i, `${p} serves HTML`);
  }
});

test('responses are not cached, so the TV never shows a stale board', async () => {
  const r = await fetch(base + '/api/live');
  assert.match(r.headers.get('cache-control') || '', /no-store/);
});
