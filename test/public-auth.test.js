'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-auth-'));
process.env.SQUARES_PASSWORD = 'hut-hut';

const { app, store } = require('../server');
const { fixture, fakeFetch } = require('./helpers');
store.fetchImpl = fakeFetch({ 20260920: fixture('scoreboard-20260920-pregame.json') });

let base, server;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

const basic = (pw) => 'Basic ' + Buffer.from('anyone:' + pw).toString('base64');

test('LAN and tailnet requests (no cf-ray) need no password', async () => {
  const r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
});

test('tunnel requests (cf-ray present) get 401 with a Basic challenge', async () => {
  for (const p of ['/', '/tv', '/api/live', '/api/state']) {
    const r = await fetch(base + p, { headers: { 'cf-ray': 'abc-IAD' } });
    assert.equal(r.status, 401, p);
    assert.match(r.headers.get('www-authenticate') || '', /^Basic realm=/);
  }
});

test('tunnel requests with the wrong password stay locked', async () => {
  const r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: basic('hut-hu') } });
  assert.equal(r.status, 401);
  const r2 = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: basic('HUT-HUT') } });
  assert.equal(r2.status, 401);
});

test('tunnel requests with the right password pass, any username', async () => {
  const r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: basic('hut-hut') } });
  assert.equal(r.status, 200);
  const r2 = await fetch(base + '/tv', { headers: { 'cf-ray': 'abc-IAD', authorization: 'Basic ' + Buffer.from('dave:hut-hut').toString('base64') } });
  assert.equal(r2.status, 200);
});
