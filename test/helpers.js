'use strict';
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')); }
function scoreboard(iso) { return fixture(`scoreboard-${iso.replace(/-/g, '')}.json`); }
/** A fetch stub that serves scoreboards out of test/fixtures. */
function fakeFetch(map) {
  return async (url) => {
    const m = /dates=(\d{8})/.exec(String(url));
    const key = m && m[1];
    if (!key || !map[key]) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}
module.exports = { fixture, scoreboard, fakeFetch, FIX };
