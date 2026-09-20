'use strict';
const path = require('path');
const express = require('express');
const pooling = require('./lib/pool');
const { Store } = require('./lib/store');

const PORT = Number(process.env.PORT || 8097);
const HOST = process.env.HOST || '0.0.0.0';

const pool = pooling.loadPool();
const store = new Store(pool);

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

app.get('/api/live', (req, res) => res.json(store.snapshot()));

app.get('/api/state', (req, res) => res.json(store.state));

app.post('/api/state', (req, res) => {
  res.json(store.setState(req.body || {}));
});

app.get('/api/owners', (req, res) => res.json({ owners: pooling.allOwners(pool) }));

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

if (require.main === module) {
  const restored = store.load();
  console.log(`[squares] restored state: week=${restored.week} delay=${restored.delaySeconds}s tracked=${restored.tracked.length}`);
  store.start();
  store.refreshSeason().catch(() => {});
  app.listen(PORT, HOST, () => {
    console.log(`[squares] listening on http://${HOST}:${PORT}  week=${store.state.week} today=${pooling.todayET()}`);
  });
}

module.exports = { app, store, pool };
