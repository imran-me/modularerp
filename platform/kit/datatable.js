/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kit/datatable.js
 * ----------------------------------------------------------------------------
 * WHAT: The one reusable data table used by every module. Given a column spec
 * and a rows array (or a rows() function), it renders a premium table with a
 * toolbar (multi-key search + auto-derived dropdown filters + CSV export), a
 * sortable header (click to toggle asc/desc), client-side pagination, per-row
 * action buttons, row-click handling, an empty state and a live record count.
 * All in-memory / client-side — this is a presentation component; it never
 * touches storage. Call t.refresh() after the underlying data changes.
 *
 * DATA IT OWNS (localStorage stores): none. Pure UI toolkit.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Search / sort / filter / export operate on the SAME filtered() pipeline,
 *     so CSV export always matches exactly what the user currently sees.
 *   - Filter dropdown options are re-derived from the FULL dataset each draw
 *     (not the filtered subset) so a selection never removes its own option.
 *   - Column render()/money/date/badge are display-only; search & sort use the
 *     raw row value (or c.sortVal) so formatting never breaks matching/ordering.
 *
 * PUBLIC API (window.EPAL.*):
 *   EPAL.table(opts) -> { el, refresh(), state }
 *     opts.columns: [{ key, label, num, money, date, badge:{val:tone},
 *                      render(r), sort:false, sortVal(r), exportVal(r), width }]
 *     opts.rows: array | function(){return array;}
 *     opts.searchKeys (default all column keys) · opts.filters:[{key,label}]
 *     opts.pageSize · opts.onRow(row) · opts.actions:[{icon,title,onClick(row)}]
 *     opts.exportName (false disables export) · opts.empty:{icon,title,hint}
 *
 * ==> LARAVEL / PHP MAPPING: a reusable <x-data-table> Blade/Livewire component
 *     (or a Laravel Datatables / Filament Table). Search/sort/filter/paginate
 *     move server-side onto the Eloquent query (->where/->orderBy/->paginate);
 *     column defs map to the component's column config; CSV export becomes a
 *     download route streaming the same filtered query (Laravel Excel).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;

  EPAL.table = function (opts) {
    var state = { q: '', sortKey: null, sortDir: 1, page: 0, filters: {} };
    var cols = opts.columns || [];
    var pageSize = opts.pageSize || 10;

    var root = el('div.dt');
    /* ---- toolbar: search + filters + export -----------------------------*/
    var toolbar = el('div.dt-toolbar');
    var searchIn = el('input.input.dt-search', { placeholder: opts.searchPlaceholder || 'Search…',
      oninput: ui.debounce(function () { state.q = searchIn.value.toLowerCase(); state.page = 0; draw(); }, 120) });
    toolbar.appendChild(el('div.dt-search-wrap', null, [ ui.frag(ui.icon('search', 'dt-search-ico')), searchIn ]));

    (opts.filters || []).forEach(function (f) {
      var sel = el('select.select.dt-filter', { onchange: function () {
        state.filters[f.key] = sel.value; state.page = 0; draw(); } });
      toolbar.appendChild(sel);
      f._sel = sel;   // options are (re)derived from data in draw()
    });

    var countEl = el('span.dt-count');
    toolbar.appendChild(el('div.spacer'));
    toolbar.appendChild(countEl);
    if (opts.exportName !== false) {
      toolbar.appendChild(el('button.btn.btn-sm.btn-ghost', { html: ui.icon('download') + ' Export',
        title: 'Export the current filtered rows as CSV',
        onclick: function () { exportCSV(); } }));
    }
    root.appendChild(toolbar);

    /* ---- table + pagination ---------------------------------------------*/
    var wrap = el('div.table-wrap');
    root.appendChild(wrap);
    var foot = el('div.dt-foot');
    root.appendChild(foot);

    function getRows() { return (typeof opts.rows === 'function' ? opts.rows() : opts.rows) || []; }

    function cellText(row, c) {           // plain value used for search/sort/export
      var v = row[c.key];
      return v == null ? '' : String(v);
    }

    function filtered() {
      var rows = getRows();
      // search
      var keys = opts.searchKeys || cols.map(function (c) { return c.key; });
      if (state.q) rows = rows.filter(function (r) {
        return keys.some(function (k) { return String(r[k] == null ? '' : r[k]).toLowerCase().indexOf(state.q) >= 0; });
      });
      // dropdown filters
      Object.keys(state.filters).forEach(function (k) {
        var v = state.filters[k];
        if (v && v !== '__all') rows = rows.filter(function (r) { return String(r[k]) === v; });
      });
      // sort
      if (state.sortKey) {
        var c = cols.filter(function (x) { return x.key === state.sortKey; })[0] || {};
        rows = rows.slice().sort(function (a, b) {
          var av = c.sortVal ? c.sortVal(a) : a[state.sortKey];
          var bv = c.sortVal ? c.sortVal(b) : b[state.sortKey];
          if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * state.sortDir;
          return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * state.sortDir;
        });
      }
      return rows;
    }

    function draw() {
      var rows = filtered();
      // refresh filter options from the FULL dataset (stable)
      (opts.filters || []).forEach(function (f) {
        var cur = f._sel.value || '__all';
        var vals = {}; getRows().forEach(function (r) { if (r[f.key] != null) vals[r[f.key]] = 1; });
        f._sel.innerHTML = '';
        f._sel.appendChild(el('option', { value: '__all', text: (f.label || f.key) + ': All' }));
        Object.keys(vals).sort().forEach(function (v) {
          var o = el('option', { value: v, text: v }); if (v === cur) o.selected = true; f._sel.appendChild(o);
        });
        if (cur !== '__all') f._sel.value = cur;
      });

      countEl.textContent = rows.length + ' record' + (rows.length === 1 ? '' : 's');

      wrap.innerHTML = '';
      if (!rows.length) {
        var em = opts.empty || {};
        wrap.appendChild(el('div.empty-state', null, [
          ui.frag(ui.icon(em.icon || 'inbox')),
          el('h3', { text: em.title || 'Nothing here yet' }),
          el('p.text-muted', { text: em.hint || 'Records will appear here once created.' })
        ]));
        foot.innerHTML = '';
        return;
      }

      var table = el('table.tbl');
      var thead = el('thead'); var htr = el('tr');
      cols.forEach(function (c) {
        var th = el('th' + (c.num ? '.num' : ''), { style: c.width ? { width: c.width } : null });
        var lbl = el('span.dt-th' + (c.sort === false ? '' : '.sortable'), { text: c.label || c.key });
        if (c.sort !== false) {
          if (state.sortKey === c.key) lbl.appendChild(ui.frag(' <i class="bi bi-caret-' + (state.sortDir > 0 ? 'up' : 'down') + '-fill dt-sort-ico"></i>'));
          th.style.cursor = 'pointer';
          th.addEventListener('click', function () {
            if (state.sortKey === c.key) state.sortDir *= -1; else { state.sortKey = c.key; state.sortDir = 1; }
            draw();
          });
        }
        th.appendChild(lbl); htr.appendChild(th);
      });
      if (opts.actions && opts.actions.length) htr.appendChild(el('th', { text: '', style: { width: '1%' } }));
      thead.appendChild(htr); table.appendChild(thead);

      var tbody = el('tbody');
      var start = state.page * pageSize;
      rows.slice(start, start + pageSize).forEach(function (r) {
        var tr = el('tr' + (opts.onRow ? '.row-click' : ''));
        cols.forEach(function (c) {
          var td = el('td' + (c.num ? '.num' : ''));
          if (c.render) { var out = c.render(r); if (out && out.nodeType) td.appendChild(out); else td.innerHTML = out == null ? '—' : out; }
          else if (c.money) td.innerHTML = '<span class="num">' + ui.money(r[c.key]) + '</span>';
          else if (c.date) td.textContent = r[c.key] ? ui.date(r[c.key]) : '—';
          else if (c.badge) {
            var v = r[c.key], tone = c.badge[v];
            td.innerHTML = v == null ? '—' : '<span class="badge' + (tone ? ' badge-' + tone : '') + '">' + ui.escapeHtml(String(v)) + '</span>';
          }
          else td.textContent = cellText(r, c) || '—';
          tr.appendChild(td);
        });
        if (opts.actions && opts.actions.length) {
          var atd = el('td.dt-actions');
          // render through the shared row-action bar (inline, single line — never
          // stacks) so every table matches the cards; bind each handler to this row.
          atd.appendChild(ui.rowActions(opts.actions.map(function (a) {
            return { icon: a.icon, title: a.title, danger: a.danger, sep: a.sep,
                     onClick: function () { a.onClick(r); } };
          })));
          tr.appendChild(atd);
        }
        if (opts.onRow) tr.addEventListener('click', function () { opts.onRow(r); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);

      // pagination footer
      foot.innerHTML = '';
      var pages = Math.ceil(rows.length / pageSize);
      if (pages > 1) {
        foot.appendChild(el('span.text-mute.sm', { text: 'Page ' + (state.page + 1) + ' of ' + pages }));
        var pager = el('div.dt-pager');
        pager.appendChild(pbtn('chevron-left', state.page > 0, function () { state.page--; draw(); }));
        for (var i = 0; i < pages && i < 7; i++) {
          (function (i) {
            pager.appendChild(el('button.dt-page-btn' + (i === state.page ? '.active' : ''), { text: String(i + 1),
              onclick: function () { state.page = i; draw(); } }));
          })(i);
        }
        if (pages > 7) pager.appendChild(el('span.text-mute', { text: '…' }));
        pager.appendChild(pbtn('chevron-right', state.page < pages - 1, function () { state.page++; draw(); }));
        foot.appendChild(pager);
      }
    }

    function pbtn(icon, enabled, fn) {
      var b = el('button.dt-page-btn', { html: ui.icon(icon), onclick: fn });
      if (!enabled) { b.disabled = true; b.style.opacity = .4; }
      return b;
    }

    function exportCSV() {
      var rows = filtered();
      var head = cols.map(function (c) { return c.label || c.key; });
      var lines = [head].concat(rows.map(function (r) {
        return cols.map(function (c) {
          var v = c.exportVal ? c.exportVal(r) : r[c.key];
          return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        });
      }));
      var blob = new Blob([lines.map(function (l) { return l.join(','); }).join('\n')], { type: 'text/csv' });
      var a = el('a', { href: URL.createObjectURL(blob), download: opts.exportName || 'export.csv' });
      document.body.appendChild(a); a.click(); a.remove();
      ui.toast('Exported ' + rows.length + ' rows', 'success');
    }

    draw();
    return { el: root, refresh: draw, state: state };
  };

})(window.EPAL = window.EPAL || {});
