/* Phone / iPad control page. Everything it changes is shared server state. */
(function () {
  'use strict';
  var S = window.SQ;
  var snap = null;
  var owners = [];
  var pendingUntil = 0;   // don't clobber a control the user is touching
  var dragging = false;

  function hold(ms) { pendingUntil = Date.now() + (ms || 1500); }
  function held() { return Date.now() < pendingUntil; }

  function push(patch) {
    hold(1500);
    return S.postJSON('/api/state', patch).then(function () { return tick(); });
  }

  /* ---------- controls ---------- */
  var weekSel = document.getElementById('week');
  var gameSel = document.getElementById('game');
  var delay = document.getElementById('delay');
  var delayval = document.getElementById('delayval');
  var search = document.getElementById('search');

  for (var i = 1; i <= 18; i++) {
    var o = document.createElement('option');
    o.value = String(i); o.textContent = 'Pool week ' + i;
    weekSel.appendChild(o);
  }
  weekSel.addEventListener('change', function () { push({ week: Number(weekSel.value), gameId: null }); });
  gameSel.addEventListener('change', function () { push({ gameId: gameSel.value || null }); });
  document.getElementById('nowbtn').addEventListener('click', function () {
    push({ week: snap ? snap.currentWeek : undefined, gameId: null });
  });

  function onDelay(commit) {
    delayval.textContent = delay.value + 's';
    hold(1200);
    if (commit) push({ delaySeconds: Number(delay.value) });
  }
  delay.addEventListener('input', function () { dragging = true; onDelay(false); });
  ['change', 'pointerup', 'touchend'].forEach(function (ev) {
    delay.addEventListener(ev, function () { dragging = false; onDelay(true); });
  });

  search.addEventListener('input', renderResults);
  search.addEventListener('focus', function () { hold(4000); });

  /* ---------- rendering ---------- */
  function render() {
    if (!snap) return;
    document.getElementById('subtitle').textContent =
      'pool week ' + snap.state.week + (snap.state.week === snap.currentWeek ? ' (now)' : '') +
      ' · ' + (snap.mySquare ? 'your square ' + snap.mySquare.away + '-' + snap.mySquare.home + ' · ' + S.money(snap.mySquare.winnings) : '');

    if (!held()) {
      weekSel.value = String(snap.state.week);
      if (!dragging) { delay.value = String(snap.state.delaySeconds); delayval.textContent = snap.state.delaySeconds + 's'; }
    }
    renderGameSel();
    renderTags();
    renderResults();

    var g = S.activeGame(snap);
    renderScoreHead(g);
    S.renderGrid(document.getElementById('board'), snap, g, {
      onTap: function (owner, r, c) {
        document.getElementById('tapinfo').textContent =
          owner + ' — needs ' + snap.digits.away[r] + '-' + snap.digits.home[c] +
          ' (' + (snap.games.length ? snap.games[0].visitor : 'away') + ' ends ' + snap.digits.away[r] +
          ', ' + (snap.games.length ? snap.games[0].home : 'home') + ' ends ' + snap.digits.home[c] + ')';
      },
    });
    renderTracked();
    renderGames();
    renderStandings();
  }

  function renderGameSel() {
    if (held() && document.activeElement === gameSel) return;
    gameSel.innerHTML = '';
    snap.games.forEach(function (g) {
      var o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.matchup + (g.tbd ? ' (TBD)' : ' · ' + (g.dow || '') + ' ' + (g.date || '')) +
        (g.state === 'in' ? ' · LIVE' : g.state === 'post' ? ' · final' : '');
      gameSel.appendChild(o);
    });
    gameSel.value = snap.activeGameId || '';
  }

  function renderScoreHead(g) {
    var h = document.getElementById('scorehead');
    h.innerHTML = '';
    if (!g) return;
    var sc = g.score || { home: '-', away: '-' };
    h.appendChild(S.el('span', 't', g.visitor));
    h.appendChild(S.el('span', 'n mono', String(sc.away)));
    h.appendChild(S.el('span', 'dimtext', 'at'));
    h.appendChild(S.el('span', 't', g.home));
    h.appendChild(S.el('span', 'n mono', String(sc.home)));
    var st = S.el('span', 'st mono', S.statusText(g));
    h.appendChild(st);
    if (g.syncing) h.appendChild(S.el('span', 'pill pre', 'syncing ' + g.syncSeconds + 's'));
    if (g.stale) h.appendChild(S.el('span', 'pill warn', 'stale'));
    if (g.error) h.appendChild(S.el('span', 'pill warn', 'no feed'));
  }

  function renderTags() {
    var t = document.getElementById('tags');
    t.innerHTML = '';
    snap.tracked.forEach(function (p) {
      var tag = S.el('span', 'tag');
      tag.style.background = p.color;
      tag.appendChild(document.createTextNode(p.owner));
      var b = S.el('button', '', '×');
      b.addEventListener('click', function () { untrack(p.owner); });
      tag.appendChild(b);
      t.appendChild(tag);
    });
    if (!snap.tracked.length) t.appendChild(S.el('span', 'dimtext', 'Nobody tracked yet.'));
  }

  function tracked() { return snap.tracked.map(function (p) { return p.owner; }); }
  function track(name) { var a = tracked(); if (a.indexOf(name) < 0) { a.push(name); push({ tracked: a }); } }
  function untrack(name) { push({ tracked: tracked().filter(function (n) { return n !== name; }) }); }

  function renderResults() {
    var q = search.value.trim().toLowerCase();
    var box = document.getElementById('results');
    box.innerHTML = '';
    var have = tracked();
    var list = owners.filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; });
    if (!q) list = list.slice(0, 0); // only show results once they type
    list.slice(0, 40).forEach(function (n) {
      var on = have.indexOf(n) >= 0;
      var d = S.el('div', on ? 'has' : '', n + (on ? '  ✓' : ''));
      d.addEventListener('click', function () { on ? untrack(n) : track(n); search.value = ''; renderResults(); });
      box.appendChild(d);
    });
    if (q && !list.length) box.appendChild(S.el('div', 'has', 'No name matches "' + q + '"'));
  }

  function renderTracked() {
    var l = document.getElementById('tplist');
    l.innerHTML = '';
    if (!snap.tracked.length) { l.appendChild(S.el('div', 'dimtext', 'Add people above and they show up on the TV.')); return; }
    snap.tracked.forEach(function (p) {
      var row = S.el('div', 'tp');
      var sw = S.el('div', 'sw'); sw.style.background = p.color; row.appendChild(sw);
      row.appendChild(S.el('div', 'nm', p.owner));
      row.appendChild(S.el('div', 'sq', p.squares.map(function (s) { return s.away + '-' + s.home; }).join(' ')));
      var pg = null;
      for (var i = 0; i < p.games.length; i++) if (p.games[i].gameId === snap.activeGameId) pg = p.games[i];
      row.appendChild(S.el('div', 'de' + (pg && pg.status === 'leading' ? ' leading' : pg && pg.status === 'won' ? ' won' : ''), pg ? pg.detail : ''));
      row.appendChild(S.el('div', 'mn', S.money(p.seasonWinnings)));
      l.appendChild(row);
    });
  }

  function renderGames() {
    var l = document.getElementById('glist');
    l.innerHTML = '';
    snap.games.forEach(function (g) {
      var d = S.el('div', 'gl');
      d.appendChild(S.el('span', 'm', g.matchup));
      d.appendChild(S.el('span', 'pill ' + S.stateClass(g), g.tbd ? 'TBD' : g.state === 'in' ? 'LIVE' : g.state === 'post' ? 'FINAL' : (g.dow || 'sched')));
      if (g.score && g.state !== 'pre') d.appendChild(S.el('span', 'mono dimtext', g.score.away + '-' + g.score.home));
      if (g.halftime) d.appendChild(S.el('span', 'dimtext', 'H: ' + g.halftime.owner));
      if (g.final) d.appendChild(S.el('span', 'dimtext', 'F: ' + g.final.owner));
      l.appendChild(d);
    });
  }

  function renderStandings() {
    var s = document.getElementById('stand');
    s.innerHTML = '';
    if (!snap.standings.length) { s.appendChild(S.el('span', 'dimtext', 'No games decided yet.')); return; }
    snap.standings.forEach(function (x) {
      var sp = S.el('span', '');
      sp.innerHTML = S.esc(x.owner) + ' <b style="color:var(--gold)">' + S.money(x.winnings) + '</b>';
      s.appendChild(sp);
    });
  }

  /* ---------- loop ---------- */
  function banner(msg) {
    var b = document.getElementById('banner');
    b.style.display = msg ? 'block' : 'none';
    b.textContent = msg || '';
  }
  var inFlight = false, again = false;
  function tick() {
    // Never pile up requests, but never drop one either: a tick asked for while
    // another is in flight (e.g. right after changing the week) runs straight
    // after, so a control change is always reflected.
    if (inFlight) { again = true; return Promise.resolve(); }
    inFlight = true;
    return S.getJSON('/api/live').then(function (s) {
      snap = s;
      var n = S.noticeFor(s);
      banner(n ? n.text : '');
      render();
    })
      .catch(function (e) { banner('Cannot reach the squares server: ' + (e.message || e)); })
      .then(function () { inFlight = false; if (again) { again = false; tick(); } });
  }

  S.getJSON('/api/owners').then(function (r) { owners = r.owners; }).then(tick);
  setInterval(function () { if (!dragging) tick(); }, 4000);
})();
