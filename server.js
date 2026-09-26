'use strict';
const path = require('path');
const express = require('express');
const pooling = require('./lib/pool');
const { Store } = require('./lib/store');
const odds = require('./lib/odds');

const PORT = Number(process.env.PORT || 8097);
const HOST = process.env.HOST || '0.0.0.0';

const pool = pooling.loadPool();
const store = new Store(pool);
const ODDS = odds.loadOdds();

const app = express();
app.use(express.json({ limit: '32kb' }));
// A malformed body is a client mistake, not a server crash — answer politely
// instead of logging a stack trace to squares.error.log.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
  if (err) return res.status(400).json({ error: String(err.message || err) });
  next();
});
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Shared password for the public hostname. Only requests that arrived through
// the Cloudflare tunnel carry a cf-ray header, so the LAN, the tailnet and the
// basement iPad keep working without a prompt. The USERNAME must be one of the
// owner names exactly as written in the grid (case and surrounding spaces do not
// matter; a shared square logs in with its full "pete/todd" string). Whoever
// logs in is "me" for the board, the Odds page and the Rankings page.
const PUBLIC_PASSWORD = process.env.SQUARES_PASSWORD || '';
const OWNER_BY_KEY = new Map(pooling.allOwners(pool).map((o) => [ownerKey(o), o]));
function ownerKey(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function ownerForUsername(name) { return OWNER_BY_KEY.get(ownerKey(name)) || null; }
function publicAuth(req, res, next) {
  if (!PUBLIC_PASSWORD || !req.get('cf-ray')) return next();
  const h = req.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const user = colon < 0 ? decoded : decoded.slice(0, colon);
    const pw = colon < 0 ? '' : decoded.slice(colon + 1);
    const owner = ownerForUsername(user);
    const pwOk = pw.length === PUBLIC_PASSWORD.length && require('crypto').timingSafeEqual(Buffer.from(pw), Buffer.from(PUBLIC_PASSWORD));
    if (owner && pwOk) { req.squaresUser = owner; return next(); }
  }
  res.set('WWW-Authenticate', 'Basic realm="Football Squares: your name from the grid + the pool password", charset="UTF-8"');
  res.status(401).type('text/plain').send('Sign in with your name exactly as it appears on the squares grid, and the pool password.');
}
app.use(publicAuth);

/** Who "me" is for this request: the logged-in owner on the public host, Brad on the LAN. */
function meFor(req) { return req.squaresUser || pooling.BRAD; }

app.get('/api/live', (req, res) => res.json(store.snapshot(Date.now(), meFor(req))));

app.get('/api/state', (req, res) => res.json(store.state));

app.post('/api/state', (req, res) => {
  res.json(store.setState(req.body || {}));
});

app.get('/api/owners', (req, res) => res.json({ owners: pooling.allOwners(pool), me: meFor(req) }));

// Historical odds for every square under one week's digits, plus the owner
// leaderboard. Defaults to the week the phone page is on.
app.get('/api/odds', (req, res) => {
  const wk = req.query.week != null ? Number(req.query.week) : store.state.week;
  const week = pool.weeks[String(wk)];
  if (!week) return res.status(404).json({ error: `no pool week ${req.query.week}` });
  res.json(odds.weekView(pool, ODDS, week, { currentWeek: pooling.currentPoolWeek(pool), me: meFor(req) }));
});

app.get('/api/season', async (req, res) => {
  if (req.query.refresh === '1') await store.refreshSeason();
  res.json({
    ...store.seasonData,
    standings: require('./lib/season').standings(pool, store.seasonData.winnings),
  });
});

app.get('/api/health', (req, res) => {
  const now = Date.now();
  const staleMs = store.lastPoll ? now - store.lastPoll : null;
  const failing = !!(store.lastError && store.lastError.at > store.lastPoll);
  res.json({
    // ok goes false once ESPN has been failing for over a minute, so a health
    // check actually notices an outage instead of reporting green.
    ok: !(failing && staleMs != null && staleMs > 60 * 1000),
    port: PORT, today: pooling.todayET(),
    currentWeek: pooling.currentPoolWeek(pool), selectedWeek: store.state.week,
    lastPoll: store.lastPoll,            // timestamp of the last SUCCESSFUL fetch
    lastPollAgoSeconds: staleMs == null ? null : Math.round(staleMs / 1000),
    lastError: store.lastError,
    espnFailing: failing,
    stateFile: require('./lib/store').statePath(),
    uptime: process.uptime(),
  });
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/odds', (req, res) => res.sendFile(path.join(__dirname, 'public', 'odds.html')));
app.get('/rankings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rankings.html')));

if (require.main === module) {
  const restored = store.load();
  console.log(`[squares] restored state: week=${restored.week} delay=${restored.delaySeconds}s tracked=${restored.tracked.length}`);
  store.start();
  store.refreshSeason().catch(() => {});
  app.listen(PORT, HOST, () => {
    console.log(`[squares] listening on http://${HOST}:${PORT}  week=${store.state.week} today=${pooling.todayET()}`);
  });
}

module.exports = { app, store, pool, ownerForUsername };
