/* Shared helpers for both views. Plain ES2020 — no build, Safari friendly. */
(function (w) {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function activeGame(snap) {
    for (var i = 0; i < snap.games.length; i++) if (snap.games[i].id === snap.activeGameId) return snap.games[i];
    return snap.games[0] || null;
  }

  /** Big readable status line for a game. */
  function statusText(g) {
    if (!g) return '';
    if (g.tbd) return 'Date TBD';
    if (g.error) return 'Score unavailable';
    if (g.syncing) return 'SYNCING';
    if (g.state === 'pre') return g.statusDetail || ((g.dow || '') + ' ' + (g.start || ''));
    if (g.state === 'post') return g.period > 4 ? 'FINAL / OT' : 'FINAL';
    var q = g.period === 1 ? '1st' : g.period === 2 ? '2nd' : g.period === 3 ? '3rd' : g.period === 4 ? '4th' : g.period > 4 ? 'OT' : '';
    if (/halftime/i.test(g.statusDetail || '')) return 'HALFTIME';
    return (q ? q + ' ' : '') + (g.clock || '');
  }
  function stateClass(g) {
    if (!g || g.error) return 'warn';
    if (g.state === 'in') return 'live';
    if (g.state === 'post') return 'post';
    return 'pre';
  }

  /**
   * Render the 10x10 board for one game.
   * Rows are the away (visitor) digits, columns the home digits.
   */
  function renderGrid(root, snap, game, opts) {
    opts = opts || {};
    root.innerHTML = '';
    var grid = el('div', 'grid');
    var overlay = snap.overlay || {};
    var digits = snap.digits;
    var cur = game && game.current;
    var half = game && game.halftime;
    var fin = game && game.final;
    var mine = snap.mySquare;

    // corner + home digits across the top
    var corner = el('div', 'cell corner');
    corner.innerHTML = '<div>' + esc((game && game.home) || 'HOME') + ' &rarr;<br>&darr; ' + esc((game && game.visitor) || 'AWAY') + '</div>';
    grid.appendChild(corner);
    for (var c = 0; c < 10; c++) grid.appendChild(el('div', 'cell axis', String(digits.home[c])));

    for (var r = 0; r < 10; r++) {
      grid.appendChild(el('div', 'cell axis', String(digits.away[r])));
      for (var cc = 0; cc < 10; cc++) {
        var owner = snap.owners[r][cc];
        // Let shared squares wrap at the slash ("brooke/mike/larry") instead of
        // mid-word ("brooke/mike/l arry") by offering a zero-width break there.
        var cell = el('div', 'cell', owner.replace(/\//g, '/\u200B'));
        var cls = [];
        var t = overlay[r + ',' + cc];
        if (t) { cls.push('tracked'); cell.style.setProperty('--tc', t.color); }
        if (mine && mine.row === r && mine.col === cc) cls.push('mine');
        if (half && half.row === r && half.col === cc) { cls.push('half'); cell.appendChild(el('span', 'badge', 'H')); }
        if (fin && fin.row === r && fin.col === cc) { cls.push('final'); cell.appendChild(el('span', 'badge f', 'F')); }
        if (cur && cur.row === r && cur.col === cc) cls.push('current');
        if (cls.length) cell.className += ' ' + cls.join(' ');
        cell.setAttribute('data-sq', r + ',' + cc);
        cell.title = owner + '  (' + digits.away[r] + '-' + digits.home[cc] + ')';
        if (opts.onTap) cell.addEventListener('click', (function (o, rr, ccc) {
          return function () { opts.onTap(o, rr, ccc); };
        })(owner, r, cc));
        grid.appendChild(cell);
      }
    }
    root.appendChild(grid);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function money(n) { return '$' + (n || 0).toLocaleString('en-US'); }

  function clockTime(ms) {
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * The one line that tells the room something is wrong (or that the board is
   * deliberately holding back). Returns {cls, text} or null.
   */
  function noticeFor(snap) {
    var games = snap.games || [];
    var i, g;
    for (i = 0; i < games.length; i++) {
      g = games[i];
      if (g.id === snap.activeGameId && g.syncing) {
        return { cls: 'sync', text: 'Syncing with your TV — showing the score in ' + g.syncSeconds + 's' };
      }
    }
    var espn = snap.espn || {};
    var staleGame = null;
    for (i = 0; i < games.length; i++) if (games[i].stale) staleGame = games[i];
    if (staleGame || (espn.failing && espn.staleMs > 60000)) {
      var since = espn.lastPoll ? clockTime(espn.lastPoll) : 'a while ago';
      return { cls: 'warn', text: 'Scores stale since ' + since + ' — ESPN is not answering. The board is frozen, the pool is fine.' };
    }
    return null;
  }

  w.SQ = {
    el: el, getJSON: getJSON, postJSON: postJSON, renderGrid: renderGrid,
    activeGame: activeGame, statusText: statusText, stateClass: stateClass,
    esc: esc, money: money, noticeFor: noticeFor, clockTime: clockTime,
  };
})(window);
