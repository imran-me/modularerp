/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kit/entity.js
 * ----------------------------------------------------------------------------
 * WHAT: The CRUD factory. One spec object describes a business object and this
 * builds an entire working module screen and registers it as a view: page
 * header (+ optional sub-route pills), a KPI tile row, a filterable/sortable/
 * paginated table (via EPAL.table) with CSV export, a schema-driven create/edit
 * modal (via EPAL.formModal), delete-with-confirm, and auto ANALYTICS (8-month
 * trend + breakdown doughnut). Every save/delete goes through EPAL.db so it
 * emits events and is written to the audit log — keeping the whole group in
 * sync. This is how ~60 modules exist without 60 hand-written screens; flagship
 * modules still get bespoke views, everything else is a spec.
 *
 * DATA IT OWNS (localStorage stores): none of its own. It reads/writes the
 *   caller-named collection `spec.store` through EPAL.db (db.col/save/remove).
 *   New records get: id = (spec.idPrefix||'R')-<last6 of epoch>, created = today
 *   (YYYY-MM-DD) — only if not already set.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - readonly:true suppresses New/Edit/Delete and the row-click editor.
 *   - hooks.beforeDelete returning false ABORTS the delete (veto hook, e.g. a
 *     record with dependants must not be removable).
 *   - hooks.afterSave(record,isNew) runs post-persist for side effects (e.g.
 *     post a sale to the ledger, generate a document).
 *   - Every mutation writes an activity-log line (maker + human action text) so
 *     the audit trail stays complete.
 *   - subs let one store power several sub-routes via row filter predicates.
 *
 * PUBLIC API (window.EPAL.*):
 *   EPAL.entity(spec) -> view — builds the screen and registers it with
 *       EPAL.view(spec.route). Spec keys:
 *     route, store, title, icon, singular, desc, fields[], columns[],
 *     filters[], searchKeys[], kpis[], analytics{moneyField,groupBy,dateField},
 *     subs{}, hooks{afterSave,beforeDelete}, actions[], scope(r), readonly,
 *     detail(rec,refresh), defaults{}, idPrefix, pageSize.
 *
 * ==> LARAVEL / PHP MAPPING: this is the resource Controller + views pattern.
 *     spec.store = an Eloquent model/table; fields[] = a FormRequest + Blade
 *     form; columns[] = an index table/component; the New/Edit/Delete wiring =
 *     a resourceful Controller (index/create/store/edit/update/destroy);
 *     hooks.afterSave / beforeDelete = model observers or Controller hooks;
 *     the activity-log line = an audit/observer (e.g. Laravel Auditing); KPIs +
 *     analytics = query aggregates fed to the index view.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;

  EPAL.entity = function (spec) {
    var view = {
      render: function (ctx) {
        var db = EPAL.db;
        var page = el('div.page');
        var sub = spec.subs && ctx.subId ? spec.subs[ctx.subId] : null;

        function rows() {
          var all = db.col(spec.store);
          if (spec.scope) all = all.filter(spec.scope);
          if (sub && sub.filter) all = all.filter(sub.filter);
          return all;
        }

        /* ---- header -----------------------------------------------------*/
        var actions = [];
        (spec.actions || []).forEach(function (a) { actions.push(el('button.btn.btn-ghost', { html: ui.icon(a.icon) + ' ' + a.label, onclick: function () { a.onClick(refresh); } })); });
        if (!spec.readonly) {
          actions.push(el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New ' + (spec.singular || 'Record'),
            onclick: function () { openEditor(null); } }));
        }
        page.appendChild(EPAL.pageHead({
          eyebrow: (ctx.company ? ctx.company.name : '') + (sub ? ' › ' + spec.title : ''),
          icon: spec.icon || (ctx.module && ctx.module.icon), title: sub ? sub.label : spec.title,
          sub: (sub && sub.desc) || spec.desc || (ctx.module && ctx.module.desc),
          actions: actions
        }));

        /* ---- sub-route pills (if the module declares subs) ---------------*/
        if (spec.subs && Object.keys(spec.subs).length) {
          var pills = el('div.pill-tab.mb-3');
          pills.appendChild(el('button' + (!sub ? '.active' : ''), { text: 'All',
            onclick: function () { EPAL.router.navigate(spec.route); } }));
          Object.keys(spec.subs).forEach(function (k) {
            pills.appendChild(el('button' + (ctx.subId === k ? '.active' : ''), { text: spec.subs[k].label,
              onclick: function () { EPAL.router.navigate(spec.route + '/' + k); } }));
          });
          page.appendChild(el('div', null, [pills]));
        }

        /* ---- KPI row ------------------------------------------------------*/
        var kpiHost = el('div.kpi-grid');
        page.appendChild(kpiHost);
        function drawKpis() {
          kpiHost.innerHTML = '';
          var r = rows();
          var kpis = spec.kpis || defaultKpis(spec, r);
          kpis.forEach(function (k) {
            var v = k.compute ? k.compute(r) : '—';
            var tile = el('div.kpi-card' + (k.drill ? '.drill' : ''), k.drill ? { onclick: function () { EPAL.router.navigate(k.drill); }, title: 'Open details' } : null, [
              el('div.kpi-top', null, [ el('span.kpi-label', { text: k.label }),
                el('span.kpi-ico', { html: '<i class="bi bi-' + (k.icon || 'graph-up') + '"></i>' }) ]),
              el('div.kpi-value', { text: String(v) }),
              k.foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: typeof k.foot === 'function' ? k.foot(r) : k.foot }) ]) : null
            ]);
            kpiHost.appendChild(tile);
          });
        }

        /* ---- table --------------------------------------------------------*/
        var table = EPAL.table({
          columns: spec.columns,
          rows: rows,
          searchKeys: spec.searchKeys,
          filters: spec.filters,
          pageSize: spec.pageSize || 10,
          exportName: (spec.store || 'export') + '.csv',
          empty: { icon: spec.icon, title: 'No ' + spec.title.toLowerCase() + ' yet',
                   hint: spec.readonly ? '' : 'Click "New ' + (spec.singular || 'Record') + '" to create the first one.' },
          onRow: function (r) {
            if (spec.detail) spec.detail(r, refresh);
            else if (!spec.readonly) openEditor(r);
          },
          actions: spec.readonly ? null : [
            { icon: 'pencil', title: 'Edit', onClick: function (r) { openEditor(r); } },
            { icon: 'trash', title: 'Delete', onClick: function (r) { del(r); } }
          ]
        });
        var tableCard = el('div.card', null, [ el('div.card-pad', { style: { paddingBottom: '8px' } }, [ table.el ]) ]);
        page.appendChild(tableCard);

        /* ---- analytics ------------------------------------------------------*/
        if (spec.analytics !== false) {
          page.appendChild(el('div.section-label', { text: spec.title + ' — Analytics' }));
          var aHost = el('div.two-col');
          page.appendChild(aHost);
          drawAnalytics(aHost, spec, rows);
        }

        ctx.mount.appendChild(page);
        drawKpis();

        /* ---- CRUD ----------------------------------------------------------*/
        function refresh() { table.refresh(); drawKpis(); }
        function openEditor(rec) {
          var isNew = !rec;
          EPAL.formModal({
            title: (isNew ? 'New ' : 'Edit ') + (spec.singular || 'Record'),
            icon: spec.icon, fields: spec.fields, record: rec || spec.defaults || {},
            saveLabel: isNew ? 'Create' : 'Save',
            onSave: function (vals) {
              var record = Object.assign({}, rec || {}, vals);
              if (isNew) {
                // Assign id + created only on first save; edits keep their originals.
                record.id = record.id || (spec.idPrefix || 'R') + '-' + Date.now().toString().slice(-6);
                record.created = record.created || new Date().toISOString().slice(0, 10);
              }
              db.save(spec.store, record);   // persists + emits data:changed (group stays in sync)
              if (spec.hooks && spec.hooks.afterSave) spec.hooks.afterSave(record, isNew);
              db.log(EPAL.auth.current().name, (isNew ? 'Created ' : 'Updated ') + (spec.singular || 'record') + ' ' + (record.name || record.title || record.id), (spec.route || '').split('/')[0]);
              refresh();
              ui.toast((spec.singular || 'Record') + (isNew ? ' created' : ' saved'), 'success');
            }
          });
        }
        function del(rec) {
          ui.confirm({ title: 'Delete ' + (spec.singular || 'record') + '?', danger: true,
            text: (rec.name || rec.title || rec.id) + ' will be permanently removed.', confirmLabel: 'Delete' })
            .then(function (ok) {
              if (!ok) return;
              // beforeDelete may veto (return false) — e.g. record has dependants.
              if (spec.hooks && spec.hooks.beforeDelete && spec.hooks.beforeDelete(rec) === false) return;
              db.remove(spec.store, rec.id);
              refresh(); ui.toast('Deleted', 'success');
            });
        }
      }
    };
    EPAL.view(spec.route, view);
    return view;
  };

  /* Default KPI set when a spec doesn't declare any --------------------------*/
  function defaultKpis(spec, rowsArr) {
    var moneyField = spec.analytics && spec.analytics.moneyField;
    var kpis = [{ label: 'Total ' + spec.title, icon: spec.icon || 'database',
      compute: function (r) { return r.length; } }];
    if (moneyField) {
      kpis.push({ label: 'Total Value', icon: 'cash-coin',
        compute: function (r) { return ui.money(r.reduce(function (a, x) { return a + (+x[moneyField] || 0); }, 0), { compact: true }); } });
    }
    kpis.push({ label: 'This Month', icon: 'calendar3', compute: function (r) {
      var ym = new Date().toISOString().slice(0, 7);
      return r.filter(function (x) { return String(x[(spec.analytics && spec.analytics.dateField) || 'created'] || '').indexOf(ym) === 0; }).length;
    } });
    return kpis;
  }

  /* Auto analytics: monthly trend (count or sum) + breakdown doughnut --------*/
  function drawAnalytics(host, spec, rowsFn) {
    var a = spec.analytics || {};
    var dateField = a.dateField || 'created';
    var trendId = ui.uid('an'), pieId = ui.uid('an');
    host.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('activity') + ' Monthly Trend' }),
        el('span.card-sub', { text: a.moneyField ? 'value per month' : 'records per month' }) ]),
      el('div.card-body', null, [ el('div', { style: { height: '240px', position: 'relative' } }, [ el('canvas', { id: trendId }) ]) ])
    ]));
    if (a.groupBy) {
      host.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('pie-chart') + ' By ' + (a.groupByLabel || a.groupBy) }) ]),
        el('div.card-body', null, [ el('div', { style: { height: '240px', position: 'relative' } }, [ el('canvas', { id: pieId }) ]) ])
      ]));
    }
    requestAnimationFrame(function () {
      var rows = rowsFn();
      // monthly buckets over the last 8 months
      var months = [], now = new Date();
      for (var i = 7; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      }
      var series = months.map(function (ym) {
        var inM = rows.filter(function (r) { return String(r[dateField] || '').indexOf(ym) === 0; });
        return a.moneyField ? inM.reduce(function (s, r) { return s + (+r[a.moneyField] || 0); }, 0) : inM.length;
      });
      var tCanvas = document.getElementById(trendId);
      if (tCanvas) EPAL.charts.area(tCanvas, {
        labels: months.map(function (ym) { var p = ym.split('-'); return new Date(p[0], p[1] - 1, 1).toLocaleString('en', { month: 'short' }); }),
        datasets: [{ label: a.moneyField ? 'Value' : 'Records', data: series }],
        money: !!a.moneyField, legend: false
      });
      if (a.groupBy) {
        var by = {}; rows.forEach(function (r) { var k = r[a.groupBy] == null ? '—' : String(r[a.groupBy]); by[k] = (by[k] || 0) + (a.moneyField ? (+r[a.moneyField] || 0) : 1); });
        var keys = Object.keys(by).sort(function (x, y) { return by[y] - by[x]; }).slice(0, 8);
        var pCanvas = document.getElementById(pieId);
        if (pCanvas && keys.length) EPAL.charts.doughnut(pCanvas, { labels: keys, data: keys.map(function (k) { return by[k]; }), legend: 'right' });
      }
    });
  }

})(window.EPAL = window.EPAL || {});
