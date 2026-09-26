/* Odds page: historical hit rate for every square under one week's digits. Read-only. */
(function () {
  'use strict';
  var S = window.SQ;
  var view = null;
  var metric = 'half';
  var picked = null;
  var weekSel = document.getElementById('week');
  var search = document.getElementById('search');

  function personKey(n) { return String(n || '').trim().replace(/\s+/g, ' ').replace(/\s\d+$/, '').toLowerCase(); }
  function pct(p) { return (p * 100).toFixed(p * 100 >= 10 ? 1 : 2) + '%'; }
  function dollars(n) { return '$' + n.toFixed(2); }
  function label(m) { return m === 'half' ? 'halftime' : m === 'final' ? 'final' : 'expected $ per game'; }

  for (var i = 1; i <= 18; i++) {
    var o = document.createElement('option');
    o.value = String(i); o.textContent = 'Pool week ' + i;
    weekSel.appendChild(o);
  }
  weekSel.addEventListener('change', function () { load(Number(weekSel.value)); });

  document.getElementById('metric').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    metric = c.getAttribute('data-m');
    Array.prototype.forEach.call(document.querySelectorAll('#metric .chip'), function (x) { x.classList.toggle('on', x === c); });
    render();
  });
  document.getElementById('mebtn').addEventListener('click', function () { if (view) pick(view.me); });
  document.getElementById('clearbtn').addEventListener('click', function () { pick(null); });
  search.addEventListener('input', renderResults);

  function owners() { return view ? view.people.map(function (r) { return r.person; }).sort() : []; }
  function pick(name) {
    picked = name ? personKey(name) : null;
    search.value = '';
    renderResults();
    render();
    try { if (name) localStorage.setItem('squares-odds-pick', name); else localStorage.removeItem('squares-odds-pick'); } catch (e) {}
  }

  function renderResults() {
    var q = search.value.trim().toLowerCase();
    var box = document.getElementById('results');
    box.innerHTML = '';
    var list = q ? owners().filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; }) : [];
    box.style.display = q ? 'block' : 'none';
    list.slice(0, 40).forEach(function (n) {
      var d = S.el('div', '', n);
      d.addEventListener('click', function () { pick(n); });
      box.appendChild(d);
    });
    if (q && !list.length) box.appendChild(S.el('div', 'has', 'No name matches "' + q + '"'));
  }

  function render() {
    if (!view) return;
    var w = view.week;
    document.getElementById('subtitle').textContent = 'pool week ' + w.number + (w.number === view.currentWeek ? ' (now)' : '') + ' · ' + w.gameCount + ' game' + (w.gameCount === 1 ? '' : 's');
    document.getElementById('gridtitle').textContent = 'Odds by square · ' + label(metric);
    document.getElementById('lbtitle').textContent = 'Best draws this week · ' + label(metric);
    renderGrid();
    renderPick();
    renderLeaderboard();
    document.getElementById('foot').textContent =
      'Hit rates from every NFL game ' + view.seasons[0] + ' to ' + view.seasons[1] + ' (' + view.games.toLocaleString('en-US') + ' games, regular season and playoffs; halftime = end of the 2nd quarter, final includes overtime). ' +
      'A random square is 1%. $ per game = ' + view.payout.halftime + ' × halftime odds + ' + view.payout.final + ' × final odds. Season $ adds up every pool game (' + view.totalGames + ') under each week\'s digits. History, not a promise.';
  }

  function cellValue(cell) { return metric === 'expected' ? cell.expected : cell[metric]; }

  function renderGrid() {
    var root = document.getElementById('board');
    root.innerHTML = '';
    var grid = S.el('div', 'grid');
    var w = view.week;
    var max = 0;
    view.grid.forEach(function (row) { row.forEach(function (cell) { max = Math.max(max, cellValue(cell)); }); });

    var corner = S.el('div', 'cell corner');
    corner.innerHTML = 'HOME &rarr;<br>&darr; AWAY';
    grid.appendChild(corner);
    for (var c = 0; c < 10; c++) grid.appendChild(S.el('div', 'cell axis', String(w.home[c])));
    view.grid.forEach(function (row, r) {
      grid.appendChild(S.el('div', 'cell axis', String(w.away[r])));
      row.forEach(function (cell, cc) {
        var v = cellValue(cell);
        var h = max ? v / max : 0;
        var d = S.el('div', 'cell heat' + (h > 0.62 ? ' hot' : ''));
        d.style.setProperty('--h', h.toFixed(3));
        d.appendChild(S.el('span', 'v', metric === 'expected' ? '$' + v.toFixed(0) : (v * 100).toFixed(1)));
        d.appendChild(S.el('span', 'o', cell.owner));
        if (picked) d.classList.add(personKey(cell.owner) === picked ? 'pick' : 'dimmed');
        d.title = cell.owner + ' · ' + cell.away + '-' + cell.home + ' · half ' + pct(cell.half) + ' · final ' + pct(cell.final) + ' · ' + dollars(cell.expected) + '/game';
        d.addEventListener('click', (function (o) { return function () { pick(picked === o ? null : o); }; })(cell.owner));
        grid.appendChild(d);
      });
    });
    root.appendChild(grid);
  }

  function renderPick() {
    var box = document.getElementById('pick');
    box.innerHTML = '';
    if (!picked) { box.appendChild(S.el('div', 'dimtext', 'Pick a name, tap Me, or tap a square.')); return; }
    var row = null;
    view.people.forEach(function (r) { if (r.person === picked) row = r; });
    if (!row) { box.appendChild(S.el('div', 'dimtext', 'No squares for ' + picked + '.')); return; }
    var who = S.el('div', 'who');
    who.appendChild(S.el('span', 'nm', row.person));
    who.appendChild(S.el('span', 'rk', '#' + row.rank + ' of ' + view.people.length + ' players this week' + (row.owners.length > 1 ? ' · ' + row.owners.length + ' squares' : '')));
    box.appendChild(who);
    var stats = S.el('div', 'stats');
    function stat(l, v, gold) { var s = S.el('div', 'stat'); s.appendChild(S.el('div', 'l', l)); s.appendChild(S.el('div', 'v mono' + (gold ? ' gold' : ''), v)); stats.appendChild(s); }
    stat('Halftime', pct(row.half));
    stat('Final', pct(row.final));
    stat('Per game', dollars(row.expected), true);
    stat('Whole season', '$' + Math.round(view.seasonPeople[row.person] || 0), true);
    box.appendChild(stats);
    var sqs = S.el('div', 'sqs');
    row.squares.forEach(function (s) {
      var sp = S.el('span', '');
      sp.innerHTML = (row.owners.length > 1 ? S.esc(s.owner) + ' ' : '') + 'needs <b>' + s.away + '-' + s.home + '</b> · half ' + pct(s.half) + ' · final ' + pct(s.final);
      sqs.appendChild(sp);
    });
    box.appendChild(sqs);
  }

  function renderLeaderboard() {
    var lb = document.getElementById('lb');
    lb.innerHTML = '';
    ['#', 'Name', 'Half', 'Final', '$/game'].forEach(function (h) { lb.appendChild(S.el('div', 'h' + (h === '$/game' ? ' money' : ''), h)); });
    var rows = view.people.slice();
    if (metric !== 'expected') rows.sort(function (a, b) { return b[metric] - a[metric] || a.person.localeCompare(b.person); });
    var top = rows.slice(0, 10);
    if (picked && !top.some(function (r) { return r.person === picked; })) {
      rows.forEach(function (r, i) { if (r.person === picked) { r._pos = i + 1; top.push(r); } });
    }
    top.forEach(function (r, i) {
      var me = r.person === picked;
      lb.appendChild(S.el('div', 'r', String(r._pos || i + 1)));
      var n = S.el('div', 'n' + (me ? ' me' : ''), r.person + (r.owners.length > 1 ? ' (' + r.owners.length + ')' : ''));
      n.addEventListener('click', function () { pick(r.person); });
      lb.appendChild(n);
      lb.appendChild(S.el('div', 'mono', pct(r.half)));
      lb.appendChild(S.el('div', 'mono', pct(r.final)));
      lb.appendChild(S.el('div', 'mono money', dollars(r.expected)));
      delete r._pos;
    });
  }

  function load(week) {
    return S.getJSON('/api/odds' + (week ? '?week=' + week : '')).then(function (v) {
      view = v;
      weekSel.value = String(v.week.number);
      render();
    }).catch(function (e) {
      document.getElementById('pick').textContent = 'Cannot load odds: ' + (e.message || e);
    });
  }

  try { picked = localStorage.getItem('squares-odds-pick') || null; } catch (e) { picked = null; }
  load(null);
})();
