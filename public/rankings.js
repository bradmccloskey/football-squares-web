/* Rankings page: every owner ranked for one week's digits. Read-only. */
(function () {
  'use strict';
  var S = window.SQ;
  var view = null;
  var sortBy = 'expected';
  var weekSel = document.getElementById('week');
  var filter = document.getElementById('filter');

  function pct(p) { return (p * 100).toFixed(p * 100 >= 10 ? 1 : 2) + '%'; }
  function dollars(n) { return '$' + n.toFixed(2); }
  function label(s) { return s === 'half' ? 'halftime odds' : s === 'final' ? 'final odds' : s === 'season' ? 'expected $ over the whole pool' : 'expected $ per game this week'; }

  for (var i = 1; i <= 18; i++) {
    var o = document.createElement('option');
    o.value = String(i); o.textContent = 'Pool week ' + i;
    weekSel.appendChild(o);
  }
  weekSel.addEventListener('change', function () { load(Number(weekSel.value)); });
  document.getElementById('sort').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    setSort(c.getAttribute('data-s'));
  });
  filter.addEventListener('input', render);

  function setSort(s) {
    sortBy = s;
    Array.prototype.forEach.call(document.querySelectorAll('#sort .chip'), function (x) { x.classList.toggle('on', x.getAttribute('data-s') === s); });
    render();
  }

  function value(r) { return sortBy === 'season' ? (view.seasonPeople[r.person] || 0) : r[sortBy]; }

  function render() {
    if (!view) return;
    var w = view.week;
    document.getElementById('subtitle').textContent = 'pool week ' + w.number + (w.number === view.currentWeek ? ' (now)' : '') + ' · ' + w.gameCount + ' game' + (w.gameCount === 1 ? '' : 's');
    var rows = view.people.slice().sort(function (a, b) { return value(b) - value(a) || a.person.localeCompare(b.person); });
    rows.forEach(function (r, i) { r._rank = i + 1; });
    var q = filter.value.trim().toLowerCase();
    var shown = q ? rows.filter(function (r) { return r.person.toLowerCase().indexOf(q) >= 0; }) : rows;
    document.getElementById('title').textContent = (q ? shown.length + ' of ' : 'All ') + rows.length + ' players · by ' + label(sortBy);

    var t = document.getElementById('tbl');
    t.innerHTML = '';
    var head = document.createElement('tr');
    [['#', 'r', null], ['Name', 'n', null], ['Squares', 'sq hide-sm', null], ['Half', 'num', 'half'], ['Final', 'num', 'final'], ['$/game', 'num', 'expected'], ['Season $', 'num', 'season']].forEach(function (h) {
      var th = S.el('th', h[1] + (h[2] === sortBy ? ' on' : ''), h[0]);
      if (h[2]) th.addEventListener('click', (function (s) { return function () { setSort(s); }; })(h[2]));
      head.appendChild(th);
    });
    t.appendChild(head);
    shown.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.person === view.me) tr.className = 'me';
      if (r._rank <= 10) tr.className += ' top';
      tr.appendChild(S.el('td', 'r mono', String(r._rank)));
      var n = S.el('td', 'n');
      var a = S.el('a', '', r.person + (r.owners.length > 1 ? ' (' + r.owners.length + ')' : ''));
      a.href = '/odds';
      a.addEventListener('click', function () { try { localStorage.setItem('squares-odds-pick', r.person); } catch (e) {} });
      n.appendChild(a);
      tr.appendChild(n);
      tr.appendChild(S.el('td', 'sq hide-sm', r.squares.map(function (s) { return s.away + '-' + s.home; }).join(' ')));
      tr.appendChild(S.el('td', 'num mono', pct(r.half)));
      tr.appendChild(S.el('td', 'num mono', pct(r.final)));
      tr.appendChild(S.el('td', 'num mono', dollars(r.expected)));
      tr.appendChild(S.el('td', 'num mono', '$' + Math.round(view.seasonPeople[r.person] || 0)));
      t.appendChild(tr);
    });
    document.getElementById('foot').textContent =
      'Odds from every NFL game ' + view.seasons[0] + ' to ' + view.seasons[1] + ' (' + view.games.toLocaleString('en-US') + ' games). A player is every grid name that differs only by its trailing number (dave 1, dave 2, dave 3). Half and Final are the summed chance of that player\'s squares hitting in one game under this week\'s digits; $/game = ' +
      view.payout.halftime + ' × half + ' + view.payout.final + ' × final; Season $ adds every pool game (' + view.totalGames + ') under each week\'s own digits, so it does not change with the week picked. Tap a name to see their squares on the grid. History, not a promise.';
  }

  function load(week) {
    return S.getJSON('/api/odds' + (week ? '?week=' + week : '')).then(function (v) {
      view = v;
      weekSel.value = String(v.week.number);
      render();
    }).catch(function (e) { document.getElementById('title').textContent = 'Cannot load rankings: ' + (e.message || e); });
  }
  load(null);
})();
