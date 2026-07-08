/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/briefing.js
 * ----------------------------------------------------------------------------
 * THE MD BRIEFING — the owner's daily narrative advisor (route: group/briefing).
 *
 * A luxury executive digest rendered entirely from EPAL.intel.mdBriefing():
 *   1. a premium navy/gold HERO panel with today's date + the narrated snapshot
 *   2. a HEADLINE KPI row (Sales MTD / Cash / AR Overdue / Group Profit) with
 *      up/down coloured deltas
 *   3. an EXCEPTIONS block (anomalies + pending approvals) — click any row to
 *      jump straight to the offending screen; an "All clear" state when empty
 *   4. a per-company POSITION mini-table (3M sales, MTD, cash, AR overdue)
 *   5. a COLLECTIONS call-sheet of the top overdue parties, each with a
 *      one-click branded "Generate statement" (EPAL.doc.open)
 *   6. an ANOMALY RADAR card from EPAL.intel.anomalies()
 * plus a "Print briefing" action that renders the whole digest as a branded,
 * confidential Epal document (EPAL.doc.open).
 *
 * Read-only by design — it advises; the operating modules move the numbers.
 * Every figure is computed live, so this digest can never drift from source.
 * ES5 only. Never write a literal star-slash inside this comment.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var RED = '#f0506e', GREEN = '#23c17e', GOLD = '#1A43BF';

  EPAL.view('group/briefing', {
    render: function (ctx) {
      var b = (EPAL.intel && EPAL.intel.mdBriefing) ? EPAL.intel.mdBriefing() : emptyBriefing();
      var page = el('div.page');

      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Group · Office of the Chairman',
        icon: 'stars',
        title: 'MD Daily Briefing',
        sub: 'Your narrated executive digest for ' + ui.date(b.date, 'long') + ' — snapshot, exceptions, collections and anomalies in one glance.',
        actions: [
          el('button.btn.btn-ghost', { html: ui.icon('arrow-repeat') + ' Refresh',
            onclick: function () { EPAL.router.render(); } }),
          el('button.btn.btn-primary', { html: ui.icon('printer') + ' Print Briefing',
            onclick: function () { printBriefing(b); } })
        ]
      }));

      /* ---- 1. HERO -------------------------------------------------------*/
      page.appendChild(el('div.brief-hero', null, [
        el('div.brief-date', { text: 'EXECUTIVE DIGEST · ' + ui.date(b.date, 'long') }),
        el('h2', { text: "Today's Snapshot" }),
        el('div.brief-narrative', { html: b.narrative || '' })
      ]));

      /* ---- 2. HEADLINE KPIs ---------------------------------------------*/
      var krow = el('div.kpi-grid.stagger');
      (b.headline || []).forEach(function (h) { krow.appendChild(headlineCard(h)); });
      page.appendChild(krow);

      /* ---- 3. EXCEPTIONS -------------------------------------------------*/
      page.appendChild(sec('exclamation-triangle-fill', 'Exceptions · needs your attention today'));
      if (!(b.exceptions && b.exceptions.length)) {
        page.appendChild(el('div.brief-good', { html: ui.icon('check-circle-fill') + ' All clear — no exceptions flagged across the group today.' }));
      } else {
        b.exceptions.forEach(function (x) { page.appendChild(excRow(x)); });
      }

      /* ---- 4. PER-COMPANY POSITION --------------------------------------*/
      page.appendChild(sec('diagram-3-fill', 'Per-Company Position'));
      page.appendChild(perCompanyCard(b));

      /* ---- 5 + 6. COLLECTIONS + ANOMALIES -------------------------------*/
      page.appendChild(sec('clipboard-data-fill', 'Collections & Anomalies'));
      var row = el('div.two-col');
      row.appendChild(collectionsCard(b));
      row.appendChild(anomaliesCard());
      page.appendChild(row);

      ctx.mount.appendChild(page);
    }
  });

  /* =====================================================================
   * SECTIONS
   * ===================================================================*/
  function headlineCard(h) {
    var dir = h.dir === 'up' ? 'up' : 'down';
    var deltaEl = h.delta
      ? el('span.kpi-trend.' + dir, { html: ui.icon(dir === 'up' ? 'arrow-up-right' : 'arrow-down-right') + ' ' + ui.escapeHtml(String(h.delta)) })
      : null;
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [
        el('span.kpi-label', { text: h.label || '' }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + iconFor(h.label) + '"></i>' })
      ]),
      el('div.kpi-value', { text: String(h.value == null ? '—' : h.value) }),
      el('div.kpi-foot', null, [ deltaEl ])
    ]);
  }

  function excRow(x) {
    var sev = x.severity === 'high' ? 'high' : x.severity === 'med' ? 'med' : 'low';
    var icon = sev === 'high' ? 'exclamation-octagon-fill' : sev === 'med' ? 'exclamation-triangle-fill' : 'info-circle-fill';
    return el('div.brief-exc.sev-' + sev, {
      style: x.route ? { cursor: 'pointer' } : null,
      title: x.route ? 'Open the affected screen' : null,
      onclick: x.route ? function () { EPAL.router.navigate(x.route); } : null
    }, [
      el('div.brief-exc-ico', { html: ui.icon(icon) }),
      el('div.brief-exc-body', null, [
        el('strong', { text: x.title || 'Exception' }),
        el('span', { text: x.detail || '' })
      ]),
      x.route ? ui.frag('<i class="bi bi-chevron-right text-mute"></i>') : null
    ]);
  }

  function perCompanyCard(b) {
    var per = b.perCompany || [];
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('buildings-fill') + ' Sister Concern Positions' }),
      el('span.card-sub', { text: 'click a row to open that concern’s accounts' })
    ]));
    if (!per.length) {
      card.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('inbox')),
        el('h3', { text: 'No active concerns' }) ]));
      return card;
    }
    var table = el('table.tbl');
    table.innerHTML = '<thead><tr><th>Concern</th><th class="num">Sales (3M)</th>' +
      '<th class="num">MTD</th><th class="num">Cash</th><th class="num">AR Overdue</th></tr></thead>';
    var tb = el('tbody');
    per.forEach(function (c) {
      var co = EPAL.config && EPAL.config.company ? EPAL.config.company(c.id) : null;
      var accent = co ? co.accent : GOLD;
      var tr = el('tr.row-click', { onclick: function () { EPAL.router.navigate(c.id + '/accounts'); } }, [
        tdHtml('<span class="strong" style="color:' + accent + '">' + ui.escapeHtml(c.name || c.id) + '</span>'),
        tdNum(ui.money(c.sales || 0, { compact: true })),
        tdNum(ui.money(c.mtd || 0, { compact: true })),
        tdNum(ui.money(c.cash || 0, { compact: true })),
        tdNum('<span style="color:' + ((c.arOverdue || 0) > 0 ? RED : 'inherit') + '">' + ui.money(c.arOverdue || 0, { compact: true }) + '</span>')
      ]);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(el('div.table-wrap', null, [ table ]));
    return card;
  }

  function collectionsCard(b) {
    var list = b.collections || [];
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('telephone-outbound-fill') + ' Collections Call-Sheet' }),
      el('span.card-sub', { text: 'top overdue parties to chase' })
    ]));
    var body = el('div.card-body');
    if (!list.length) {
      body.appendChild(el('div.brief-good', { html: ui.icon('emoji-smile') + ' Nothing outstanding to collect — receivables are clean.' }));
    } else {
      var dl = el('div.data-list');
      list.forEach(function (c) {
        dl.appendChild(el('div.data-row', null, [
          ui.frag('<span class="notif-ico notif-warning">' + ui.icon('cash-stack') + '</span>'),
          el('div.flex-1', null, [
            el('div.fw-600.sm', { text: c.party || 'Unknown party' }),
            el('div.text-mute.xs', { text: (c.days > 0 ? c.days + ' days overdue' : 'current / not yet due') })
          ]),
          el('span.num.strong', { text: ui.money(c.amount || 0) }),
          el('button.btn.btn-sm.btn-outline', {
            html: ui.icon('file-earmark-text') + ' Statement',
            title: 'Generate a branded statement of account',
            onclick: function () { generateStatement(c.party, c.amount, c.days); }
          })
        ]));
      });
      body.appendChild(dl);
    }
    card.appendChild(body);
    return card;
  }

  function anomaliesCard() {
    var list = (EPAL.intel && EPAL.intel.anomalies) ? EPAL.intel.anomalies() : [];
    var card = el('div.card');
    card.appendChild(el('div.card-head', null, [
      el('h3', { html: ui.icon('radar') + ' Anomaly Radar' }),
      el('span.card-sub', { text: list.length + ' signal' + (list.length === 1 ? '' : 's') + ' detected' })
    ]));
    var body = el('div.card-body');
    if (!list.length) {
      body.appendChild(el('div.brief-good', { html: ui.icon('shield-check') + ' No anomalies detected across the group.' }));
    } else {
      var dl = el('div.data-list');
      list.slice(0, 6).forEach(function (a) {
        var sev = a.severity === 'high' ? 'high' : a.severity === 'med' ? 'med' : 'low';
        var tone = sev === 'high' ? 'error' : sev === 'med' ? 'warning' : 'info';
        dl.appendChild(el('div.data-row', {
          style: a.route ? { cursor: 'pointer' } : null,
          onclick: a.route ? function () { EPAL.router.navigate(a.route); } : null
        }, [
          ui.frag('<span class="notif-ico notif-' + tone + '">' + ui.icon('activity') + '</span>'),
          el('div.flex-1', null, [
            el('div.fw-600.sm', { text: a.title || 'Anomaly' }),
            el('div.text-mute.xs', { text: a.detail || '' })
          ]),
          el('span.badge.badge-' + (sev === 'high' ? 'bad' : sev === 'med' ? 'warn' : 'good'), { text: sev })
        ]));
      });
      body.appendChild(dl);
    }
    card.appendChild(body);
    return card;
  }

  /* =====================================================================
   * BRANDED DOCUMENTS (EPAL.doc.open)
   * ===================================================================*/
  // Statement of account for one overdue party — pulls the ledger subledger
  // when available, else falls back to a single carried-forward balance line.
  function generateStatement(party, amount, days) {
    party = (party || 'Customer').toString();
    var today = (EPAL.intel && EPAL.intel.mdBriefing) ? EPAL.intel.mdBriefing().date : new Date().toISOString().slice(0, 10);
    var rows = [];
    if (EPAL.ledger && EPAL.ledger.partyLedger) {
      try {
        var led = EPAL.ledger.partyLedger(party) || [];
        led.forEach(function (r) {
          rows.push({ date: r.date || '', ref: r.ref || '', memo: r.memo || '',
            debit: +r.debit || 0, credit: +r.credit || 0, balance: +r.balance || 0 });
        });
      } catch (e) { rows = []; }
    }
    if (!rows.length) {
      rows.push({ date: today, ref: '—', memo: 'Outstanding balance carried forward',
        debit: +amount || 0, credit: 0, balance: +amount || 0 });
    }
    var outstanding = rows.length ? rows[rows.length - 1].balance : (+amount || 0);
    var grp = (EPAL.config && EPAL.config.group) ? EPAL.config.group : {};

    EPAL.doc.open({
      type: 'invoice',
      title: 'Statement of Account',
      badge: days > 0 ? days + ' days overdue' : 'Current',
      date: today,
      companyId: 'group',
      amount: outstanding,
      parties: [
        { label: 'Statement For', name: party, lines: [ 'Outstanding as at ' + ui.date(today) ] },
        { label: 'Issued By', name: grp.name || 'Epal Group', lines: [ 'Group Credit Control', 'Dhaka, Bangladesh' ] }
      ],
      meta: [
        { label: 'Statement Date', value: ui.date(today) },
        { label: 'Outstanding', value: ui.money(outstanding) },
        { label: 'Status', value: days > 0 ? days + ' days overdue' : 'Current' }
      ],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'ref', label: 'Reference' },
        { key: 'memo', label: 'Description' },
        { key: 'debit', label: 'Debit', num: true, money: true },
        { key: 'credit', label: 'Credit', num: true, money: true },
        { key: 'balance', label: 'Balance', num: true, money: true }
      ],
      rows: rows,
      totals: [ { label: 'Total Outstanding', value: outstanding, grand: true } ],
      words: EPAL.doc.amountInWords ? EPAL.doc.amountInWords(Math.round(outstanding)) : '',
      terms: 'Please arrange settlement of the outstanding balance at your earliest convenience. Kindly disregard this statement if payment has already been made. E&OE.',
      sign: 'Group Credit Control'
    });
  }

  // The whole digest as a confidential, branded Epal document.
  function printBriefing(b) {
    var narrative = String(b.narrative || '')
      .replace(/<\/p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

    var per = b.perCompany || [];
    var rows = per.map(function (c) {
      return { name: c.name || c.id, sales: c.sales || 0, mtd: c.mtd || 0, cash: c.cash || 0, ar: c.arOverdue || 0 };
    });
    var totSales = 0, totCash = 0, totAr = 0;
    rows.forEach(function (r) { totSales += r.sales; totCash += r.cash; totAr += r.ar; });

    var metaKpis = (b.headline || []).map(function (h) {
      return { label: h.label, value: String(h.value) + (h.delta ? '  (' + h.delta + ')' : '') };
    });
    var grp = (EPAL.config && EPAL.config.group) ? EPAL.config.group : {};

    EPAL.doc.open({
      type: 'document',
      title: 'MD Daily Briefing',
      badge: 'Confidential',
      date: b.date,
      companyId: 'group',
      parties: [
        { label: 'Prepared For', name: 'Office of the Chairman', lines: [ grp.name || 'Epal Group' ] },
        { label: 'Prepared By', name: 'Epal Intelligence', lines: [ 'Automated Executive Digest', 'Generated ' + ui.date(b.date) ] }
      ],
      meta: metaKpis,
      columns: [
        { key: 'name', label: 'Concern' },
        { key: 'sales', label: 'Sales (3M)', num: true, money: true },
        { key: 'mtd', label: 'MTD', num: true, money: true },
        { key: 'cash', label: 'Cash', num: true, money: true },
        { key: 'ar', label: 'AR Overdue', num: true, money: true }
      ],
      rows: rows,
      totals: [
        { label: 'Group Sales (3M)', value: totSales },
        { label: 'Group Cash', value: totCash },
        { label: 'Group AR Overdue', value: totAr, grand: true }
      ],
      words: narrative,
      terms: 'Confidential — for the Office of the Chairman only. Figures are live management estimates derived from operational data and are not audited. E&OE.',
      sign: 'Epal Intelligence'
    });
  }

  /* =====================================================================
   * SMALL HELPERS
   * ===================================================================*/
  function sec(icon, text) {
    return el('div.brief-section-title', null, [ ui.frag(ui.icon(icon)), el('span', { text: text }) ]);
  }
  function tdHtml(html) { var t = el('td'); t.innerHTML = html; return t; }
  function tdNum(html) { var t = el('td.num'); t.innerHTML = html; return t; }
  function iconFor(label) {
    var l = (label || '').toLowerCase();
    if (l.indexOf('sales') >= 0) return 'cash-coin';
    if (l.indexOf('cash') >= 0) return 'bank';
    if (l.indexOf('overdue') >= 0 || l.indexOf('receivable') >= 0 || l.indexOf(' ar') >= 0) return 'exclamation-diamond-fill';
    if (l.indexOf('profit') >= 0) return 'graph-up-arrow';
    return 'activity';
  }
  function emptyBriefing() {
    return { date: new Date().toISOString().slice(0, 10), narrative: '<p>Briefing engine unavailable.</p>',
      headline: [], exceptions: [], perCompany: [], collections: [] };
  }

})(window.EPAL = window.EPAL || {});
