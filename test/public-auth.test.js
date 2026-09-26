'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.SQUARES_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'squares-auth-'));
process.env.SQUARES_PASSWORD = 'hut-hut';

const { app, store, pool, ownerForUsername } = require('../server');
const pooling = require('../lib/pool');
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

test('tunnel requests need an owner name from the grid as the username', async () => {
  const owner = pool.owners[0][0];
  const auth = (u, pw) => 'Basic ' + Buffer.from(u + ':' + pw).toString('base64');
  // right password, made-up name: refused
  let r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: auth('nobody-here', 'hut-hut') } });
  assert.equal(r.status, 401);
  // no name at all: refused
  r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: basic('hut-hut') } });
  assert.equal(r.status, 401);
  // a grid name: in, and it becomes "me" everywhere
  r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(owner, 'hut-hut') } });
  assert.equal(r.status, 200);
  const live = await r.json();
  assert.equal(live.mySquare.owner, owner);
  assert.deepEqual({ row: live.mySquare.row, col: live.mySquare.col }, pooling.squaresFor(pool, owner)[0]);
  r = await fetch(base + '/api/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(owner, 'hut-hut') } });
  assert.equal((await r.json()).me, owner);
  r = await fetch(base + '/api/owners', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(owner, 'hut-hut') } });
  assert.equal((await r.json()).me, owner);
  // case and spacing do not matter; a shared square logs in with its full string
  r = await fetch(base + '/tv', { headers: { 'cf-ray': 'abc-IAD', authorization: auth('  ' + owner.toUpperCase() + ' ', 'hut-hut') } });
  assert.equal(r.status, 200);
  const shared = pooling.allOwners(pool).find((o) => o.includes('/'));
  r = await fetch(base + '/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(shared, 'hut-hut') } });
  assert.equal(r.status, 200);
  // one half of a shared square is not a login on its own
  r = await fetch(base + '/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(shared.split('/')[0], 'hut-hut') } });
  assert.equal(r.status, 401);
});

test('LAN requests stay open and "me" stays Brad', async () => {
  const r = await fetch(base + '/api/odds');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).me, pooling.BRAD);
  const live = await (await fetch(base + '/api/live')).json();
  assert.equal(live.mySquare.owner, pooling.BRAD);
});

test('ownerForUsername resolves grid names only', () => {
  assert.equal(ownerForUsername(pool.owners[3][4]), pool.owners[3][4]);
  assert.equal(ownerForUsername(' ' + pool.owners[3][4].toUpperCase()), pool.owners[3][4]);
  assert.equal(ownerForUsername('not a player'), null);
  assert.equal(ownerForUsername(''), null);
});
