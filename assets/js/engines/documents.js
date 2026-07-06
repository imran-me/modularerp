/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/engines/documents.js   (EPAL.doc)
 * ----------------------------------------------------------------------------
 * WHAT: The branded document engine — one authority for every printable business
 *   object in the group (invoice, receipt, voucher, work order, salary slip,
 *   quotation, purchase order, visa cover letter, ticket). From a plain `spec`
 *   object it renders a pixel-perfect navy (#1B2A4A) / gold (#3B6FA8) ".epal-doc"
 *   DOM tree (styles in css/deepcore.css) so any module raises an on-brand
 *   document with one call and never hand-builds HTML. It draws its serial from
 *   EPAL.serial, converts amounts to words (BD lakh/crore), and can print,
 *   download a self-contained .html, or file the doc to the Document Center.
 *
 * DATA IT OWNS (localStorage store; seeded via seedOnce):
 *   documents — Document Center metadata (NOT the rendered doc):
 *     { id, serial, type:enum(invoice|receipt|voucher|workorder|salary|
 *       quotation|po|visacover|ticket|document), title, companyId, party,
 *       amount:number, at:ms, by:string }
 *
 * BUSINESS RULES (the "why" a developer MUST preserve):
 *   - Serial is drawn via EPAL.doc.numberFor(type) -> EPAL.serial.next(prefix)
 *     using the contract-mandated PREFIX map; this keeps document numbering
 *     gapless and traceable (see serial.js). Never invent a serial by hand.
 *   - SAVE-ONCE: open()'s "Save to Center" is idempotent per modal — a second
 *     click no-ops so one displayed document files exactly one metadata row.
 *   - Saving goes through EPAL.db.save (writes store AND emits data:changed) so
 *     audit auto-records it and the Document Center refreshes live.
 *   - PRINT-SELF-CONTAINED: print/download inline the critical CSS with color
 *     values resolved (no CSS custom properties, no external stylesheet) so a
 *     document renders and prints correctly even from file:// on its own.
 *   - amountInWords uses BD/Indian numbering (crore · lakh · thousand), not the
 *     western million/billion grouping.
 *
 * PUBLIC API (window.EPAL.doc):
 *   build(spec) -> HTMLElement.epal-doc
 *   open(spec)  -> xl modal with Print / Download / Save-to-Center
 *   print(node) / download(node, filename)
 *   numberFor(type) -> next serial for that doc type
 *   amountInWords(n) -> 'Taka Forty Two Thousand Only'
 *   prefixes -> the type->prefix map
 *
 * ==> LARAVEL / PHP MAPPING: `documents` -> Document model (migration documents).
 *   build()/PRINT_CSS become a Blade template rendered to HTML, and print/
 *   download map to a PDF response via a DocumentService (dompdf / Browsershot).
 *   numberFor() calls the SerialService; open()'s Save-to-Center is a controller
 *   store action. amountInWords is a small helper/Number-to-words utility.
 *
 * NOTE: never write a literal star-slash inside this comment block.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  var S = EPAL.store;
  var ui = EPAL.ui;

  var NAVY = '#1B2A4A';
  var GOLD = '#3B6FA8';

  /* type -> serial prefix (contract-mandated map) --------------------------*/
  var PREFIX = {
    invoice: 'INV', receipt: 'RCP', voucher: 'JV', workorder: 'WO',
    salary: 'SAL', quotation: 'QUO', po: 'PO', visacover: 'VISA', ticket: 'TKT'
  };

  function group() { return (EPAL.config && EPAL.config.group) || { name: 'Epal Group', legalName: 'Epal Group of Companies' }; }

  /* ==========================================================================
   * AMOUNT -> WORDS  (Bangladesh / Indian numbering: crore · lakh · thousand)
   * ========================================================================*/
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  // Convert 0-999 to words (no scale word).
  function chunk(n) {
    var w = '';
    if (n > 99) { w += ONES[Math.floor(n / 100)] + ' Hundred'; n = n % 100; if (n) w += ' '; }
    if (n > 19) { w += TENS[Math.floor(n / 10)]; n = n % 10; if (n) w += ' ' + ONES[n]; }
    else if (n > 0) { w += ONES[n]; }
    return w;
  }

  function amountInWords(value) {
    var num = Math.round(Math.abs(+value || 0));
    if (num === 0) return 'Taka Zero Only';
    var crore = Math.floor(num / 10000000); num = num % 10000000;
    var lakh = Math.floor(num / 100000); num = num % 100000;
    var thousand = Math.floor(num / 1000); num = num % 1000;
    var rest = num; // 0-999 (handles hundreds internally)
    var parts = [];
    if (crore) parts.push(chunk(crore) + ' Crore');
    if (lakh) parts.push(chunk(lakh) + ' Lakh');
    if (thousand) parts.push(chunk(thousand) + ' Thousand');
    if (rest) parts.push(chunk(rest));
    return 'Taka ' + parts.join(' ') + ' Only';
  }

  /* ==========================================================================
   * BUILD  ·  spec -> HTMLElement.epal-doc
   * ========================================================================*/
  function cellText(col, row) {
    var v = row ? row[col.key] : null;
    if (col.money) return ui.money(+v || 0);
    if (v == null) return '';
    if (col.num && typeof v === 'number') return ui.num(v);
    return String(v);
  }

  function totalText(t) {
    if (t.value == null) return '';
    if (typeof t.value === 'number') return ui.money(t.value);
    return String(t.value);
  }

  function build(spec) {
    spec = spec || {};
    var g = group();
    var serial = spec.serial || '';
    var badge = spec.badge;

    /* ---- header ---------------------------------------------------------*/
    var metaKids = [];
    metaKids.push(ui.el('div', { text: g.legalName || g.name || 'Epal Group' }));
    metaKids.push(ui.el('div', { text: spec.subtitle || 'Dhaka, Bangladesh' }));
    if (serial) metaKids.push(ui.el('div.epal-doc-serial', { text: serial }));
    metaKids.push(ui.el('div', { text: 'Date: ' + ui.date(spec.date || new Date()) }));
    if (badge) metaKids.push(ui.el('div', { style: { marginTop: '4px' } }, [ui.el('span.epal-doc-badge', { text: badge })]));

    var head = ui.el('div.epal-doc-head', null, [
      ui.el('div.epal-doc-brand', null, [
        ui.el('div.epal-doc-logo', { text: (g.name || 'E').charAt(0).toUpperCase() }),
        ui.el('div', null, [
          ui.el('h2', { text: g.name || 'Epal Group' }),
          ui.el('div.epal-doc-tag', { text: g.tagline || 'One Group. One Operating System.' })
        ])
      ]),
      ui.el('div.epal-doc-meta', null, metaKids)
    ]);

    /* ---- title ----------------------------------------------------------*/
    var title = ui.el('div.epal-doc-title', { text: spec.title || 'Document' });

    /* ---- body -----------------------------------------------------------*/
    var bodyKids = [];

    // parties + meta row
    var partyCols = [];
    (spec.parties || []).forEach(function (p) {
      if (!p) return;
      var lines = [];
      lines.push(ui.el('h4', { text: p.label || '' }));
      if (p.name) lines.push(ui.el('div', { style: { fontWeight: '700' }, text: p.name }));
      (p.lines || []).forEach(function (ln) { if (ln != null && ln !== '') lines.push(ui.el('div', { text: String(ln) })); });
      partyCols.push(ui.el('div.epal-doc-party', null, lines));
    });
    if (spec.meta && spec.meta.length) {
      var metaLines = [ui.el('h4', { text: 'Details' })];
      spec.meta.forEach(function (m) {
        if (!m) return;
        metaLines.push(ui.el('div', null, [
          ui.el('span', { style: { color: '#8a93a8' }, text: (m.label || '') + ': ' }),
          ui.el('span', { style: { fontWeight: '600' }, text: m.value == null ? '' : String(m.value) })
        ]));
      });
      partyCols.push(ui.el('div.epal-doc-party', null, metaLines));
    }
    if (partyCols.length) bodyKids.push(ui.el('div.epal-doc-parties', null, partyCols));

    // line-item table
    if (spec.columns && spec.columns.length) {
      var cols = spec.columns;
      var ths = cols.map(function (c) {
        return ui.el('th', { style: (c.num || c.money) ? { textAlign: 'right' } : null, text: c.label || '' });
      });
      var rows = (spec.rows || []).map(function (r) {
        var tds = cols.map(function (c) {
          var cls = c.money ? 'td.amt' : (c.num ? 'td.num' : 'td');
          return ui.el(cls, { text: cellText(c, r) });
        });
        return ui.el('tr', null, tds);
      });
      if (!rows.length) {
        rows.push(ui.el('tr', null, [ui.el('td', { colspan: cols.length, style: { textAlign: 'center', color: '#8a93a8' }, text: 'No line items' })]));
      }
      bodyKids.push(ui.el('table', null, [
        ui.el('thead', null, [ui.el('tr', null, ths)]),
        ui.el('tbody', null, rows)
      ]));
    }

    // totals block
    if (spec.totals && spec.totals.length) {
      var trows = spec.totals.map(function (t) {
        var tr = ui.el('tr' + (t.grand ? '.epal-doc-grand' : ''), null, [
          ui.el('td', { text: t.label || '' }),
          ui.el('td.amt', { text: totalText(t) })
        ]);
        return tr;
      });
      bodyKids.push(ui.el('table.epal-doc-totals', null, [ui.el('tbody', null, trows)]));
    }

    // amount in words
    if (spec.words) bodyKids.push(ui.el('p.epal-doc-words', { text: spec.words }));

    var body = ui.el('div.epal-doc-body', null, bodyKids);

    /* ---- footer (terms + signature) -------------------------------------*/
    var foot = ui.el('div.epal-doc-foot', null, [
      ui.el('div.epal-doc-terms', { text: spec.terms || 'This is a computer-generated document. Goods/services once rendered are non-refundable except per company policy. E&OE.' }),
      ui.el('div.epal-doc-sign', null, [
        ui.el('div.epal-doc-sign-line'),
        ui.el('div', { text: spec.sign || 'Authorised Signatory' })
      ])
    ]);

    /* ---- root -----------------------------------------------------------*/
    var rootCls = 'div.epal-doc' + (spec.watermark ? '.epal-doc-watermark' : '');
    var attrs = {};
    if (spec.watermark) attrs['data-wm'] = spec.watermark;
    return ui.el(rootCls, attrs, [head, title, body, foot]);
  }

  /* ==========================================================================
   * PRINT-SAFE CSS  ·  the critical .epal-doc rules with values resolved so a
   * document renders standalone (no CSS custom properties, no stylesheet).
   * ========================================================================*/
  var PRINT_CSS = [
    '@page{margin:14mm;}',
    "body{margin:0;background:#eef1f7;font-family:'Inter',system-ui,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
    '.epal-doc{background:#fff;color:#1a2233;width:100%;max-width:820px;margin:0 auto;box-shadow:0 10px 40px rgba(0,0,0,.18);border-radius:8px;overflow:hidden;position:relative;}',
    '.epal-doc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:26px 30px;background:' + NAVY + ';color:#fff;border-bottom:4px solid ' + GOLD + ';}',
    '.epal-doc-brand{display:flex;align-items:center;gap:14px;}',
    '.epal-doc-logo{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,' + GOLD + ',#a5811a);color:' + NAVY + ';font-weight:800;font-size:26px;display:flex;align-items:center;justify-content:center;}',
    '.epal-doc-brand h2{margin:0;font-size:20px;font-weight:800;letter-spacing:.01em;}',
    '.epal-doc-brand .epal-doc-tag{font-size:12px;opacity:.82;}',
    '.epal-doc-meta{text-align:right;font-size:12.5px;line-height:1.7;}',
    '.epal-doc-meta .epal-doc-serial{font-size:15px;font-weight:700;color:' + GOLD + ';}',
    '.epal-doc-title{padding:16px 30px 4px;font-size:22px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:' + NAVY + ';}',
    '.epal-doc-body{padding:12px 30px 24px;}',
    '.epal-doc-parties{display:flex;justify-content:space-between;gap:24px;margin:12px 0 20px;flex-wrap:wrap;}',
    '.epal-doc-party{font-size:13px;line-height:1.7;}',
    '.epal-doc-party h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:' + GOLD + ';}',
    '.epal-doc table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;}',
    '.epal-doc thead th{background:#eef1f6;color:' + NAVY + ';text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid ' + NAVY + ';}',
    '.epal-doc tbody td{padding:9px 10px;border-bottom:1px solid #e6e9f0;}',
    '.epal-doc tbody tr:last-child td{border-bottom:none;}',
    '.epal-doc .num,.epal-doc .amt{text-align:right;white-space:nowrap;}',
    '.epal-doc-totals{margin-left:auto;width:320px;max-width:100%;margin-top:6px;}',
    '.epal-doc-totals tr td{padding:5px 10px;border:none;}',
    '.epal-doc-totals .epal-doc-grand td{border-top:2px solid ' + NAVY + ';font-weight:800;font-size:15px;color:' + NAVY + ';padding-top:9px;}',
    '.epal-doc-words{margin:8px 0 0;font-size:12.5px;font-style:italic;color:#55607a;}',
    '.epal-doc-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:18px 30px 26px;border-top:1px dashed #cfd6e4;margin-top:12px;flex-wrap:wrap;}',
    '.epal-doc-terms{font-size:11px;color:#6b7488;max-width:60%;line-height:1.6;}',
    '.epal-doc-sign{text-align:center;font-size:12px;}',
    '.epal-doc-sign .epal-doc-sign-line{width:180px;border-top:1.5px solid ' + NAVY + ';margin:34px auto 4px;}',
    '.epal-doc-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#f4ead0;color:#7a5f10;}',
    '.epal-doc-watermark::after{content:attr(data-wm);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;font-weight:800;color:rgba(200,40,40,.10);transform:rotate(-24deg);pointer-events:none;letter-spacing:.1em;}'
  ].join('\n');

  function standaloneHtml(node, title) {
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + ui.escapeHtml(title || 'Document') + '</title>' +
      '<style>' + PRINT_CSS + '</style></head>' +
      '<body>' + node.outerHTML + '</body></html>';
  }

  /* ==========================================================================
   * PRINT / DOWNLOAD
   * ========================================================================*/
  function print(node) {
    if (!node) return;
    var w = window.open('', '_blank', 'width=900,height=1040');
    if (!w) { ui.toast('Popup blocked — allow popups to print this document.', 'warning'); return; }
    w.document.open();
    w.document.write(standaloneHtml(node, 'Print · Epal Group'));
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
  }

  function download(node, filename) {
    if (!node) return;
    var name = (filename || 'document.html');
    if (!/\.html?$/i.test(name)) name += '.html';
    var blob = new Blob([standaloneHtml(node, name)], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    ui.toast('Document downloaded · ' + name, 'success');
  }

  /* ==========================================================================
   * NUMBER FOR TYPE  ·  serial via prefix map
   * ========================================================================*/
  function numberFor(type) {
    var prefix = PREFIX[type] || 'DOC';
    if (EPAL.serial && EPAL.serial.next) return EPAL.serial.next(prefix);
    return prefix + '/2026/000001';
  }

  /* ==========================================================================
   * OPEN  ·  xl modal with Print / Download / Save-to-Center
   * ========================================================================*/
  function firstParty(spec) {
    if (spec.party != null) return spec.party;
    var p = spec.parties && spec.parties[0];
    if (!p) return '';
    if (p.name) return p.name;
    if (p.lines && p.lines[0]) return String(p.lines[0]);
    return p.label || '';
  }

  function open(spec) {
    spec = spec || {};
    if (!spec.serial) spec.serial = numberFor(spec.type || 'invoice');
    var node = build(spec);
    var saved = false;

    function save() {
      if (saved) { ui.toast('Already saved to Document Center.', 'info'); return { keepOpen: true }; }
      var rec = {
        id: ui.uid('DOC'),
        serial: spec.serial,
        type: spec.type || 'document',
        title: spec.title || 'Document',
        companyId: spec.companyId || 'group',
        party: firstParty(spec),
        amount: +spec.amount || 0,
        at: Date.now(),
        by: (EPAL.auth && EPAL.auth.current && (EPAL.auth.current() || {}).name) || 'System'
      };
      // db.save writes the store AND emits data:changed (audit auto-records it,
      // Document Center refreshes live).
      EPAL.db.save('documents', rec);
      ui.toast('Saved to Document Center · ' + rec.serial, 'success', { title: 'Document filed' });
      saved = true;
      return { keepOpen: true };
    }

    return ui.modal({
      size: 'xl',
      title: spec.title || 'Document',
      icon: 'file-earmark-text',
      body: node,
      actions: [
        { label: 'Print', icon: 'printer', keepOpen: true, onClick: function () { print(node); return { keepOpen: true }; } },
        { label: 'Download', icon: 'download', keepOpen: true, onClick: function () { download(node, (spec.serial || 'document').replace(/[\\/:]+/g, '-') + '.html'); return { keepOpen: true }; } },
        { label: 'Save to Center', icon: 'inbox', variant: 'primary', keepOpen: true, onClick: function () { return save(); } }
      ]
    });
  }

  /* ==========================================================================
   * PUBLIC API
   * ========================================================================*/
  EPAL.doc = {
    build: build,
    open: open,
    print: print,
    download: download,
    numberFor: numberFor,
    amountInWords: amountInWords,
    prefixes: PREFIX
  };

  /* ==========================================================================
   * SEED  ·  ~6 believable Document Center rows (fixed serials + timestamps)
   * ========================================================================*/
  function t(iso) { var ms = Date.parse(iso); return isNaN(ms) ? 0 : ms; }

  function seedDocuments() {
    return [
      { id: 'DOC-0001', serial: 'INV/2026/000001', type: 'invoice',    title: 'Air Ticket Invoice',        companyId: 'travels',      party: 'Meghna Group',       amount: 128500, at: t('2026-06-18T10:15:00'), by: 'Mohsin (Owner)' },
      { id: 'DOC-0002', serial: 'RCP/2026/000001', type: 'receipt',    title: 'Payment Receipt',           companyId: 'travels',      party: 'Rahim Enterprise',   amount:  64000, at: t('2026-06-20T12:40:00'), by: 'Mohsin (Owner)' },
      { id: 'DOC-0003', serial: 'QUO/2026/000001', type: 'quotation',  title: 'Interior Fit-out Quotation',companyId: 'woodart',      party: 'Skyline Developers', amount: 940000, at: t('2026-06-22T09:05:00'), by: 'Mohsin (Owner)' },
      { id: 'DOC-0004', serial: 'INV/2026/000002', type: 'invoice',    title: 'Software Development Invoice',companyId: 'it',          party: 'BRAC Corp',          amount: 425000, at: t('2026-06-25T16:20:00'), by: 'Mohsin (Owner)' },
      { id: 'DOC-0005', serial: 'WO/2026/000001',  type: 'workorder',  title: 'Site Work Order',           companyId: 'construction', party: 'Delta Constructions',amount: 1850000,at: t('2026-06-28T08:30:00'), by: 'Mohsin (Owner)' },
      { id: 'DOC-0006', serial: 'RCP/2026/000002', type: 'receipt',    title: 'POS Sale Receipt',          companyId: 'shop',         party: 'Aarong Retail',      amount:  18750, at: t('2026-07-01T14:10:00'), by: 'Mohsin (Owner)' }
    ];
  }

  /* ==========================================================================
   * SELF-REGISTER
   * ========================================================================*/
  EPAL.registerEngine({
    name: 'documents',
    seed: function () {
      S.seedOnce('documents', seedDocuments());
    },
    boot: function () {
      // No runtime subscriptions required — the document engine is pull-driven
      // (modules call EPAL.doc.* on demand). Hook reserved for future auto-docs
      // (e.g. auto-invoice on sale:recorded) wired via automation rules.
    }
  });

})(window.EPAL = window.EPAL || {});
