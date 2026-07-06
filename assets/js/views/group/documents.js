/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/documents.js
 * ----------------------------------------------------------------------------
 * DOCUMENT CENTER — the group-wide registry of every branded business document
 * ever raised (invoices, receipts, vouchers, quotations, work orders, tickets…).
 *
 * Reads the `documents` store (EPAL.db.col('documents')) — the metadata each
 * EPAL.doc.open(...) files on Save — and presents:
 *   · KPI row: total documents, this-month volume, total value, by-type counts
 *   · a "By type" doughnut chart
 *   · a world-class EPAL.table (search · Type/Company filters · CSV export)
 *     with an "Open" row action that rebuilds a representative branded document
 *     via EPAL.doc.build/open for on-brand preview + reprint
 *   · header actions New Invoice / New Receipt / New Voucher that collect a few
 *     fields, raise a branded EPAL.doc.open(...) and — on its Save — append the
 *     new document straight back into this Center (live, via data:changed).
 *
 * All persistence flows through EPAL.doc / EPAL.db, so the store stays the one
 * source of truth and the table refreshes itself whenever a document is filed.
 * NOTE: never write a literal star-slash inside this comment block.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var disposer = null;   // bus subscription, cleaned up on teardown

  /* type -> presentation (label, icon, badge tone, chart colour) ------------*/
  var TYPES = {
    invoice:   { label:'Invoice',        icon:'receipt',            tone:'good',  color:'#2f6bff', badge:'INVOICE' },
    receipt:   { label:'Receipt',        icon:'cash-coin',          tone:'good',  color:'#23c17e', badge:'RECEIPT' },
    voucher:   { label:'Journal Voucher',icon:'journal-text',       tone:'',      color:'#2591D9', badge:'VOUCHER' },
    quotation: { label:'Quotation',      icon:'file-earmark-text',  tone:'warn',  color:'#7b5cff', badge:'QUOTATION' },
    workorder: { label:'Work Order',     icon:'clipboard-check',    tone:'',      color:'#e2721b', badge:'WORK ORDER' },
    po:        { label:'Purchase Order',  icon:'bag-check',         tone:'',      color:'#12b3a6', badge:'PURCHASE ORDER' },
    salary:    { label:'Salary Slip',    icon:'wallet2',            tone:'',      color:'#6f9c1c', badge:'SALARY SLIP' },
    ticket:    { label:'Ticket',         icon:'ticket-perforated',  tone:'',      color:'#e0356e', badge:'E-TICKET' },
    visacover: { label:'Visa Cover',     icon:'passport',           tone:'',      color:'#f4b740', badge:'VISA COVER' },
    document:  { label:'Document',       icon:'file-earmark',       tone:'',      color:'#8b93a7', badge:'DOCUMENT' }
  };
  function typeMeta(t) { return TYPES[t] || TYPES.document; }

  function companyList() {
    return (EPAL.config && EPAL.config.companies ? EPAL.config.companies : [])
      .filter(function (c) { return c.enabled; });
  }
  function companyName(id) {
    var c = companyList().filter(function (x) { return x.id === id; })[0];
    return c ? c.name : (id || 'Epal Group');
  }
  function companyShort(id) {
    var c = companyList().filter(function (x) { return x.id === id; })[0];
    return c ? c.short : (id || 'Group');
  }

  function docs() {
    return db.col('documents').slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/documents', {
    render: function (ctx) {
      var page = el('div.page');
      page.appendChild(EPAL.pageHead({
        eyebrow:'Epal Group', icon:'folder-fill', title:'Document Center',
        sub:'Every branded invoice, receipt and voucher across the group — preview, reprint and file new ones.',
        actions: [
          el('button.btn.btn-ghost',  { html: ui.icon('receipt')   + ' New Invoice', onclick: function () { newDoc('invoice'); } }),
          el('button.btn.btn-ghost',  { html: ui.icon('cash-coin') + ' New Receipt', onclick: function () { newDoc('receipt'); } }),
          el('button.btn.btn-primary',{ html: ui.icon('journal-plus') + ' New Voucher', onclick: function () { newDoc('voucher'); } })
        ]
      }));

      var host = el('div');
      page.appendChild(host);

      var canvasId = ui.uid('doc-donut');
      function draw() {
        host.innerHTML = '';
        var rows = docs();

        /* ---- KPIs -------------------------------------------------------*/
        var now = new Date();
        var thisMonth = rows.filter(function (d) {
          var dt = new Date(d.at || 0);
          return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
        }).length;
        var totalValue = rows.reduce(function (s, d) { return s + (+d.amount || 0); }, 0);
        var invoices = rows.filter(function (d) { return d.type === 'invoice'; }).length;
        var receipts = rows.filter(function (d) { return d.type === 'receipt'; }).length;

        host.appendChild(el('div.kpi-grid.stagger', null, [
          kpi('Total Documents', String(rows.length), 'files'),
          kpi('This Month', String(thisMonth), 'calendar-week'),
          kpi('Total Value', ui.money(totalValue, { compact:true }), 'cash-stack'),
          kpi('Invoices', String(invoices), 'receipt'),
          kpi('Receipts', String(receipts), 'cash-coin')
        ]));

        /* ---- By-type doughnut + legend ----------------------------------*/
        var byType = {};
        rows.forEach(function (d) { var t = d.type || 'document'; byType[t] = (byType[t] || 0) + 1; });
        var keys = Object.keys(byType).sort(function (p, q) { return byType[q] - byType[p]; });

        var chartCard = el('div.card', null, [
          el('div.card-head', null, [
            el('h3', { html: ui.icon('pie-chart-fill') + ' Documents by Type' }),
            el('span.card-sub', { text: keys.length + ' type' + (keys.length === 1 ? '' : 's') })
          ]),
          el('div.card-body', null, [
            keys.length
              ? el('div', { style:{ height:'240px', position:'relative' } }, [ el('canvas', { id: canvasId }) ])
              : el('div.empty-state', null, [ ui.frag(ui.icon('pie-chart')), el('h3',{text:'No documents yet'}),
                  el('p.text-muted',{text:'File your first document to see the mix.'}) ])
          ])
        ]);
        host.appendChild(chartCard);

        /* ---- Table ------------------------------------------------------*/
        var enriched = rows.map(function (d) {
          var m = typeMeta(d.type);
          var out = {};
          for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k]; }
          out.typeLabel = m.label;
          out.company = companyName(d.companyId);
          return out;
        });

        var table = EPAL.table({
          columns: [
            { key:'serial', label:'Serial', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.serial || '—') + '</span>'; } },
            { key:'typeLabel', label:'Type', render: function (r) {
                var m = typeMeta(r.type);
                return '<span class="badge' + (m.tone ? ' badge-' + m.tone : '') + '"><i class="bi bi-' + m.icon + '" style="margin-right:5px"></i>' + ui.escapeHtml(m.label) + '</span>';
              } },
            { key:'title', label:'Title' },
            { key:'company', label:'Company' },
            { key:'party', label:'Party', render: function (r) { return ui.escapeHtml(r.party || '—'); } },
            { key:'amount', label:'Amount', num:true, money:true },
            { key:'at', label:'Date', num:true, sortVal: function (r) { return r.at || 0; },
              render: function (r) { return r.at ? ui.date(new Date(r.at)) : '—'; },
              exportVal: function (r) { return r.at ? ui.date(new Date(r.at)) : ''; } }
          ],
          rows: enriched,
          searchKeys: ['serial','typeLabel','title','company','party','by'],
          filters: [ { key:'typeLabel', label:'Type' }, { key:'company', label:'Company' } ],
          pageSize: 12,
          exportName: 'document-center.csv',
          onRow: function (r) { openDoc(r); },
          actions: [ { icon:'box-arrow-up-right', title:'Open · preview & reprint', onClick: function (r) { openDoc(r); } } ],
          empty: { icon:'folder2-open', title:'No documents filed yet',
                   hint:'Use New Invoice, New Receipt or New Voucher above to raise your first branded document.' }
        });
        host.appendChild(el('div.card', null, [
          el('div.card-head', null, [ el('h3', { html: ui.icon('archive-fill') + ' Filed Documents' }) ]),
          el('div.card-body', null, [ table.el ])
        ]));

        /* ---- paint the doughnut after mount -----------------------------*/
        if (keys.length) {
          requestAnimationFrame(function () {
            var cv = document.getElementById(canvasId);
            if (!cv) return;
            EPAL.charts.doughnut(cv, {
              labels: keys.map(function (k) { return typeMeta(k).label; }),
              data: keys.map(function (k) { return byType[k]; }),
              colors: keys.map(function (k) { return typeMeta(k).color; }),
              legend: 'right'
            });
          });
        }
      }

      draw();

      // live refresh whenever a document is filed / removed anywhere.
      if (disposer) { disposer(); disposer = null; }
      disposer = EPAL.bus.on('data:changed', function (p) {
        if (p && p.store === 'documents') draw();
      });

      ctx.mount.appendChild(page);
    },
    teardown: function () { if (disposer) { disposer(); disposer = null; } }
  });

  /* ==========================================================================
   * BRANDED DOCUMENT SPEC  ·  rebuild a representative doc from a stored row
   * ========================================================================*/
  function descFor(type, title) {
    var map = {
      invoice:'Professional services rendered as per agreement',
      receipt:'Payment received with thanks — settlement against outstanding',
      voucher:'Journal voucher — accounting adjustment posted to the ledger',
      quotation:'Proposed scope & pricing — valid for 15 days from issue',
      workorder:'Approved scope of work authorised for execution',
      po:'Goods / services ordered per the terms below',
      salary:'Monthly salary disbursement',
      ticket:'Air passage — issued and confirmed',
      visacover:'Visa application cover'
    };
    return map[type] || (title || 'Document line');
  }

  function specFrom(row) {
    var amount = +row.amount || 0;
    var m = typeMeta(row.type);
    var issuedBy = { label:'Issued By', name: companyName(row.companyId),
      lines:['Epal Group of Companies', 'Dhaka, Bangladesh', 'hello@epalgroup.com'] };
    var counterparty = { label: row.type === 'po' ? 'Supplier' : 'Billed To',
      name: row.party || 'Valued Client', lines:['Dhaka, Bangladesh'] };

    var spec = {
      type: row.type || 'document',
      title: row.title || m.label,
      serial: row.serial,
      companyId: row.companyId || 'group',
      party: row.party || '',
      amount: amount,
      date: row.at ? new Date(row.at) : new Date(),
      badge: m.badge,
      subtitle: companyShort(row.companyId) + ' Division',
      parties: [ counterparty, issuedBy ],
      meta: [
        { label:'Document No', value: row.serial },
        { label:'Type', value: m.label },
        { label:'Company', value: companyName(row.companyId) },
        { label:'Prepared By', value: row.by || 'System' }
      ],
      words: EPAL.doc.amountInWords(amount),
      sign:'Authorised Signatory'
    };

    if (row.type === 'voucher') {
      // journal-style debit/credit presentation
      spec.columns = [
        { key:'account', label:'Account' },
        { key:'debit', label:'Debit', money:true },
        { key:'credit', label:'Credit', money:true }
      ];
      spec.rows = [
        { account:'Cash / Bank (1010)', debit: amount, credit: 0 },
        { account:'Revenue / Adjustment (4000)', debit: 0, credit: amount }
      ];
      spec.totals = [ { label:'Total', value: amount, grand:true } ];
      spec.terms = 'Journal voucher — computer generated. Retain for audit. E&OE.';
    } else {
      var vat = Math.round(amount / 1.05 * 0.05);   // treat stored amount as VAT-inclusive
      var net = amount - vat;
      spec.columns = [
        { key:'desc', label:'Description' },
        { key:'qty', label:'Qty', num:true },
        { key:'rate', label:'Rate', money:true },
        { key:'amount', label:'Amount', money:true }
      ];
      spec.rows = [ { desc: descFor(row.type, row.title), qty: 1, rate: net, amount: net } ];
      spec.totals = [
        { label:'Subtotal', value: net },
        { label:'VAT (5%)', value: vat },
        { label:'Grand Total', value: amount, grand:true }
      ];
    }
    return spec;
  }

  function openDoc(row) { EPAL.doc.open(specFrom(row)); }

  /* ==========================================================================
   * NEW DOCUMENT  ·  small form -> branded EPAL.doc.open (Save files it here)
   * ========================================================================*/
  function newDoc(type) {
    var m = typeMeta(type);
    var coOpts = companyList().map(function (c) { return [c.id, c.name]; });
    var titleDefault = { invoice:'Sales Invoice', receipt:'Payment Receipt', voucher:'Journal Voucher' }[type] || m.label;

    EPAL.formModal({
      title:'New ' + m.label, icon: m.icon, size:'lg',
      fields: [
        { type:'section', label:'Document' },
        { key:'title', label:'Document title', type:'text', required:true, default: titleDefault, col2:true },
        { key:'companyId', label:'Company', type:'select', required:true, options: coOpts, default:'travels' },
        { key:'party', label: type === 'voucher' ? 'Reference / Narration' : 'Party (client name)', type:'text', required:true,
          placeholder: type === 'voucher' ? 'e.g. Month-end accrual' : 'e.g. Meghna Group' },
        { key:'amount', label:'Amount (BDT)', type:'money', required:true, min:1, placeholder:'e.g. 128500' },
        { key:'note', label:'Line description (optional)', type:'text', col2:true,
          placeholder:'Leave blank for a standard ' + m.label.toLowerCase() + ' line' }
      ],
      saveLabel:'Build Document',
      onSave: function (v) {
        var row = {
          type: type,
          title: (v.title || m.label).trim(),
          serial: EPAL.doc.numberFor(type),
          companyId: v.companyId || 'group',
          party: (v.party || '').trim(),
          amount: +v.amount || 0,
          at: Date.now(),
          by: (EPAL.auth && EPAL.auth.current && (EPAL.auth.current() || {}).name) || 'System'
        };
        var spec = specFrom(row);
        if (v.note && String(v.note).trim() && spec.rows && spec.rows[0] && spec.rows[0].desc != null) {
          spec.rows[0].desc = String(v.note).trim();
        }
        // Close the form, then raise the branded document. Its "Save to Center"
        // button files the metadata into the `documents` store (data:changed →
        // our subscription redraws the table automatically).
        EPAL.doc.open(spec);
        ui.toast('Document built — use "Save to Center" to file it.', 'success');
        return true;   // close the form modal
      }
    });
  }

  /* ---------------------------------------------------- shared helpers */
  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [
        el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html:'<i class="bi bi-' + icon + '"></i>' })
      ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }

})(window.EPAL = window.EPAL || {});
