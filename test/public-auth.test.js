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

test('tunnel requests need a grid name (number optional) as the username; the person becomes "me"', async () => {
  const auth = (u, pw) => 'Basic ' + Buffer.from(u + ':' + pw).toString('base64');
  const dave = pooling.personFor(pool, 'dave 1');
  assert.ok(dave && dave.owners.length >= 2, 'fixture: dave holds several squares');
  // right password, made-up name: refused; no name: refused
  let r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: auth('nobody-here', 'hut-hut') } });
  assert.equal(r.status, 401);
  r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: basic('hut-hut') } });
  assert.equal(r.status, 401);
  // "dave 1", "DAVE 3" and plain "dave" all sign in as the person dave, with every dave square
  for (const u of ['dave 1', '  DAVE 3 ', 'dave']) {
    r = await fetch(base + '/api/live', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(u, 'hut-hut') } });
    assert.equal(r.status, 200, u);
    const live = await r.json();
    assert.equal(live.me, 'dave', u);
    assert.equal(live.mySquares.length, pooling.squaresForPerson(pool, dave).length, u);
    assert.deepEqual(live.mySquares.map((q) => q.owner).sort(), pooling.squaresForPerson(pool, dave).map((q) => q.owner).sort());
  }
  r = await fetch(base + '/api/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth('dave 2', 'hut-hut') } });
  const v = await r.json();
  assert.equal(v.me, 'dave');
  assert.deepEqual(v.meOwners, dave.owners);
  // a shared square is its own player, and half of it is not a login
  const shared = pooling.allOwners(pool).find((o) => o.includes('/'));
  r = await fetch(base + '/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(shared, 'hut-hut') } });
  assert.equal(r.status, 200);
  r = await fetch(base + '/odds', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(shared.split('/')[0], 'hut-hut') } });
  assert.equal(r.status, 401);
  // a single-square owner without a number is still just themselves
  const single = pooling.people(pool).find((p) => p.owners.length === 1 && !/\d$/.test(p.owners[0]) && !p.owners[0].includes('/'));
  r = await fetch(base + '/api/owners', { headers: { 'cf-ray': 'abc-IAD', authorization: auth(single.name.toUpperCase(), 'hut-hut') } });
  assert.equal((await r.json()).me, single.name);
});

test('LAN requests stay open and "me" stays Brad', async () => {
  const r = await fetch(base + '/api/odds');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).me, pooling.personFor(pool, pooling.BRAD).name);
  const live = await (await fetch(base + '/api/live')).json();
  assert.equal(live.mySquare.owner, pooling.BRAD);
});

test('ownerForUsername resolves grid names (number optional) to the person', () => {
  assert.equal(ownerForUsername('dave 4'), 'dave');
  assert.equal(ownerForUsername(' Dave '), 'dave');
  assert.equal(ownerForUsername('dave b'), 'dave b');
  assert.equal(ownerForUsername('not a player'), null);
  assert.equal(ownerForUsername(''), null);
});
