/* TV view: no controls, just render whatever the shared state says. */
(function () {
  'use strict';
  var S = window.SQ;
  var lastErr = null;

  function render(snap) {
    var g = S.activeGame(snap);
    renderHeader(snap, g);
    S.renderGrid(document.getElementById('board'), snap, g);
    renderWins(g);
    renderTracked(snap);
    renderGames(snap);
    renderStandings(snap);
  }

  function renderHeader(snap, g) {
    var h = document.getElementById('hdr');
    h.innerHTML = '';
    var sc = (g && g.score) || { home: '-', away: '-' };

    var box = S.el('div', 'teamscore');
    box.appendChild(S.el('div', 'tname', (g && g.visitor) || ''));
    box.appendChild(S.el('div', 'tnum mono', String(sc.away)));
    box.appendChild(S.el('div', 'at', 'at'));
    box.appendChild(S.el('div', 'tname', (g && g.home) || ''));
    box.appendChild(S.el('div', 'tnum mono', String(sc.home)));
    h.appendChild(box);

    var right = S.el('div', 'clockbox');
    right.appendChild(S.el('div', 'clock mono', S.statusText(g)));
    var bits = ['Pool week ' + snap.state.week];
    bits.push('delay ' + snap.state.delaySeconds + 's' + (g && g.hasData && !g.delayReady ? ' (syncing)' : ''));
    if (snap.mySquare) bits.push('brad mc ' + snap.mySquare.away + '-' + snap.mySquare.home + '  ' + S.money(snap.mySquare.winnings));
    right.appendChild(S.el('div', 'subline', bits.join('   •   ')));
    h.appendChild(right);
  }

  function renderWins(g) {
    var w = document.getElementById('wins');
    w.innerHTML = '';
    w.appendChild(winBox('h', 'Halftime $150', g && g.halftime));
    w.appendChild(winBox('f', 'Final $150', g && g.final));
    var cur = S.el('div', 'winbox');
    cur.appendChild(S.el('div', 'lab', 'On the board now'));
    cur.appendChild(S.el('div', 'who', g && g.current ? g.current.owner : '—'));
    cur.appendChild(S.el('div', 'sc', g && g.score && g.state !== 'pre' ? g.score.away + ' - ' + g.score.home : 'not started'));
    w.appendChild(cur);
  }
  function winBox(kind, label, win) {
    var b = S.el('div', 'winbox ' + kind);
    b.appendChild(S.el('div', 'lab', label));
    b.appendChild(S.el('div', 'who', win ? win.owner : '—'));
    b.appendChild(S.el('div', 'sc', win ? win.away + ' - ' + win.home : 'not yet'));
    return b;
  }

  function renderTracked(snap) {
    var t = document.getElementById('tlist');
    t.innerHTML = '';
    if (!snap.tracked.length) {
      t.appendChild(S.el('div', 'empty', 'Nobody picked yet — add people on the phone page.'));
      return;
    }
    var activeId = snap.activeGameId;
    snap.tracked.forEach(function (p) {
      var row = S.el('div', 'trow');
      var sw = S.el('div', 'swatch'); sw.style.background = p.color; row.appendChild(sw);
      row.appendChild(S.el('div', 'tname2', p.owner + (p.isBrad ? ' ★' : '')));
      row.appendChild(S.el('div', 'tsq', p.squares.map(function (s) { return s.away + '-' + s.home; }).join(' ')));
      var pg = null;
      for (var i = 0; i < p.games.length; i++) if (p.games[i].gameId === activeId) pg = p.games[i];
      var st = S.el('div', 'tstat' + (pg && pg.status === 'leading' ? ' leading' : pg && pg.status === 'won' ? ' won' : ''),
        pg ? pg.detail : '');
      row.appendChild(st);
      row.appendChild(S.el('div', 'tmoney', S.money(p.seasonWinnings)));
      t.appendChild(row);
    });
  }

  function renderGames(snap) {
    var l = document.getElementById('glist');
    l.innerHTML = '';
    snap.games.forEach(function (g) {
      var c = S.el('div', 'gamechip' + (g.id === snap.activeGameId ? ' active' : ''));
      c.appendChild(S.el('div', 'm', g.matchup));
      var p = S.el('span', 'pill ' + S.stateClass(g), g.tbd ? 'TBD' : (g.state === 'in' ? 'LIVE' : g.state === 'post' ? 'FINAL' : (g.dow || '')));
      c.appendChild(p);
      var txt = g.score && g.state !== 'pre' ? g.score.away + '-' + g.score.home : (g.start || '');
      c.appendChild(S.el('span', 'dimtext mono', txt));
      if (g.final) c.appendChild(S.el('span', 'dimtext', '• F: ' + g.final.owner));
      else if (g.halftime) c.appendChild(S.el('span', 'dimtext', '• H: ' + g.halftime.owner));
      l.appendChild(c);
    });
  }

  function renderStandings(snap) {
    var s = document.getElementById('stand');
    s.innerHTML = '';
    if (!snap.standings.length) { s.appendChild(S.el('span', 'dimtext', 'No games decided yet.')); return; }
    snap.standings.slice(0, 22).forEach(function (x) {
      var sp = S.el('span', '');
      sp.innerHTML = S.esc(x.owner) + ' <b>' + S.money(x.winnings) + '</b>';
      s.appendChild(sp);
    });
    document.getElementById('err').textContent = lastErr ? 'Last update failed: ' + lastErr : '';
  }

  var inFlight = false;
  function tick() {
    if (inFlight) return;   // never let slow responses pile up over a long evening
    inFlight = true;
    S.getJSON('/api/live').then(function (snap) { lastErr = null; render(snap); })
      .catch(function (e) { lastErr = String(e.message || e); var n = document.getElementById('err'); if (n) n.textContent = 'Last update failed: ' + lastErr; })
      .then(function () { inFlight = false; });
  }
  tick();
  setInterval(tick, 3000);
  // Keep the TV awake if the browser allows it.
  if ('wakeLock' in navigator) {
    var req = function () { navigator.wakeLock.request('screen').catch(function () {}); };
    req();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) req(); });
  }
})();
