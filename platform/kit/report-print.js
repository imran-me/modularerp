/* ============================================================================
 * EPAL GROUP ERP  ·  platform/kit/report-print.js   (EPAL.report)
 * ----------------------------------------------------------------------------
 * WHAT: the FORMAL REPORT renderer — the printed, signed, filed artifact a
 * finance department hands to an auditor. Given a spec (masthead · title ·
 * scope · KPI band · one wide table · paired panels · notes · sign-off) it lays
 * the report out on A4 LANDSCAPE pages, paginating in JS, and gives back real
 * DOM: the same nodes are shown in the preview modal and written into the
 * printed window, so what is previewed IS what prints.
 *
 * WHY JS PAGINATION rather than CSS page breaks: Chrome does not support the
 * `@page` margin boxes that would carry "Page X of Y", and a browser cannot be
 * asked how many pages it made. Measuring the flow ourselves is the only way to
 * get an honest page count, a footer on EVERY page, a table header that repeats
 * on each one, rows that never split, and a sign-off block that always lands at
 * the end. It also means the preview is exact rather than approximate.
 *
 * DATA IT OWNS: none. Pure presentation — it is handed finished figures.
 *
 * HOUSE RULES BAKED IN (owner 2026-07-30, "avoid too much colours"):
 *   - EVERY figure prints pure black. No accent colours on data — a payroll
 *     register is photocopied, faxed and scanned, and a pale gold number is
 *     gone by the second generation. Colour is structural only: the navy column
 *     header band, the hairline rules and the panel headings.
 *   - Negatives print in accounting brackets — (69,388) — never with a minus
 *     sign and never in red. Nothing print as 0: an absent figure is an en dash.
 *   - Money is grouped the Bangladeshi way — 53,74,501, not 5,374,501 — and
 *     carries no symbol inside a cell; the masthead declares the currency once.
 *   - Backgrounds are forced with print-color-adjust:exact, because Chrome
 *     prints background graphics OFF by default and the header band would
 *     otherwise vanish into white-on-white.
 *
 * PUBLIC API (window.EPAL.report):
 *   open(spec)             → preview modal with Print / Save as PDF
 *   pages(spec)            → [HTMLElement] one node per printed page
 *   print(spec)            → straight to the print dialog, no preview
 *   money(n) · pct(n,dp) · brackets(n)  → the printed number formats
 *
 * ==> LARAVEL: the spec is what a ReportController would hand a Blade view;
 *     pagination moves to the PDF engine (Browsershot/dompdf) and money()/pct()
 *     become Blade formatters. Keep the SPEC SHAPE identical across the move.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, esc = ui.escapeHtml;

  /* ---- geometry — A4 landscape at the CSS 96dpi reference ---------------- */
  var MM = 96 / 25.4;                       // 1mm in CSS px
  var PAGE_H = 210, PAD_T = 12, PAD_B = 14; // mm — bottom clears the footer
  var FLOW_PX = (PAGE_H - PAD_T - PAD_B) * MM;

  /* ---- the stylesheet — literal colours, no custom properties -------------
   * Inlined into the print window exactly as it is used for measuring, so the
   * preview, the measurement and the print can never disagree. It is also
   * injected into the app document (once) because pagination has to measure
   * real, styled nodes. Everything is prefixed .rp- so it cannot touch a screen. */
  var CSS = [
    '.rp-doc{background:#fff;color:#000;}',
    '.rp-doc *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
    /* colour and type are set on the PAGE, not only on .rp-doc: in the preview
       the pages hang inside the app's modal, where they would otherwise inherit
       the theme's text colour and print-preview a different document from the
       one that prints */
    '.rp-page{width:297mm;height:210mm;padding:12mm 12mm 14mm;position:relative;background:#fff;overflow:hidden;',
    'color:#000;font-family:"Segoe UI",Inter,Arial,sans-serif;font-size:8pt;line-height:1.35;}',
    '.rp-flow{width:100%;}',
    /* masthead ---------------------------------------------------------- */
    '.rp-mast{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm;',
    'border-bottom:1.4pt solid #0B2545;padding-bottom:2.6mm;}',
    '.rp-brand{font-family:Georgia,"Times New Roman",serif;font-size:15pt;font-weight:700;color:#0B2545;line-height:1;}',
    '.rp-div{display:inline-block;margin-left:3mm;font-size:6.5pt;font-weight:700;letter-spacing:.16em;',
    'text-transform:uppercase;color:#0B2545;border-left:.6pt solid #0B2545;padding-left:3mm;vertical-align:middle;}',
    '.rp-lines{font-size:7pt;margin-top:1.4mm;line-height:1.5;}',
    '.rp-meta{text-align:right;font-family:Consolas,"Roboto Mono",monospace;font-size:7pt;line-height:1.55;white-space:nowrap;}',
    /* title + scope ----------------------------------------------------- */
    '.rp-title{font-family:Georgia,"Times New Roman",serif;font-size:15pt;font-weight:700;margin-top:3.4mm;color:#0B2545;}',
    '.rp-scope{font-size:8pt;margin-top:1mm;}',
    '.rp-notice{font-size:8pt;font-weight:700;border:.8pt solid #0B2545;padding:1.4mm 2mm;margin-top:2mm;}',
    /* KPI band ---------------------------------------------------------- */
    '.rp-kpis{display:flex;margin-top:3mm;border-top:.6pt solid #0B2545;border-bottom:.6pt solid #0B2545;}',
    '.rp-kpi{flex:1;padding:2mm 3mm 2.2mm;border-right:.4pt solid #C7D0DC;min-width:0;}',
    '.rp-kpi:last-child{border-right:none;}',
    '.rp-kpi-l{font-size:6.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0B2545;}',
    '.rp-kpi-v{font-family:Consolas,"Roboto Mono",monospace;font-variant-numeric:tabular-nums;font-size:13.5pt;font-weight:700;margin-top:.6mm;}',
    '.rp-kpi-s{font-size:6.5pt;margin-top:.4mm;}',
    /* the table --------------------------------------------------------- */
    'table.rp-tbl{width:100%;border-collapse:collapse;margin-top:3.2mm;table-layout:fixed;}',
    '.rp-tbl th{background:#0B2545;color:#fff;font-size:6.5pt;font-weight:600;letter-spacing:.06em;',
    'text-transform:uppercase;text-align:left;padding:1.5mm 1.3mm;line-height:1.2;vertical-align:bottom;}',
    '.rp-tbl th.rp-grp{background:#14365F;text-align:center;letter-spacing:.1em;border-left:.4pt solid #fff;}',
    '.rp-tbl th.num{text-align:right;}',
    /* a hairline between column heads: fifteen right-aligned labels in a row run
       into one another otherwise, and the reader cannot tell where one ends */
    '.rp-tbl thead tr:last-child th + th{border-left:.3pt solid rgba(255,255,255,.28);}',
    /* WIDE — 15+ columns. The only thing that shrinks is the gutter; type stays
       at 8.5pt, because a payroll register that needs a magnifier is not one. */
    '.rp-tbl.rp-wide th,.rp-tbl.rp-wide td{padding-left:.8mm;padding-right:.8mm;}',
    /* TALL — a row somebody has to WRITE on. A disbursement sheet is signed line
       by line as the money is handed over, and a 4mm row leaves nowhere to sign;
       this gives every row a thumb's worth of height and puts a dotted rule in
       the signature cell so the eye knows where the pen goes. */
    '.rp-tbl.rp-tall td{padding-top:2.6mm;padding-bottom:2.6mm;}',
    '.rp-sigline{display:block;border-bottom:.4pt dotted #7A8798;margin-top:3.4mm;}',
    '.rp-tbl td{font-size:8.5pt;padding:1.35mm 1.3mm;border-bottom:.3pt solid #D8E0EA;vertical-align:top;',
    'overflow-wrap:anywhere;}',
    '.rp-tbl td.num{text-align:right;font-family:Consolas,"Roboto Mono",monospace;font-variant-numeric:tabular-nums;',
    'white-space:nowrap;overflow-wrap:normal;}',
    '.rp-tbl tbody tr:nth-child(even) td{background:#F7F9FB;}',
    '.rp-tbl .rp-strong{font-weight:700;}',
    '.rp-tbl .rp-sub{display:block;font-size:6.5pt;color:#3C4A5E;}',
    // the same sub-label inside a column head sits on the navy band, where a dark
    // grey is dark-on-dark — it lightens instead of disappearing
    '.rp-tbl th .rp-sub{color:rgba(255,255,255,.74);}',
    '.rp-tot td{background:#EDF1F7;border-top:1.5pt solid #0B2545;border-bottom:1.5pt solid #0B2545;font-weight:700;}',
    // tag+class, to out-specify table.rp-tbl's own top margin — a panel's table
    // butts straight onto the panel heading, with no white band between them
    'table.rp-mini{margin-top:0;}',
    '.rp-mini th{font-size:6pt;padding:1.1mm 2mm;}',
    '.rp-mini td{font-size:7.5pt;padding:1mm 2mm;}',
    '.rp-tbl tbody tr.rp-tot:nth-child(even) td{background:#EDF1F7;}',
    /* panels ------------------------------------------------------------ */
    /* flex-start, not stretch: a three-line panel beside a six-line one should
       end where its content ends — a box with two empty rows in it reads as a
       missing figure */
    '.rp-panels{display:flex;gap:6mm;margin-top:4mm;align-items:flex-start;}',
    '.rp-panel{flex:1;border:.5pt solid #0B2545;min-width:0;}',
    '.rp-panel-h{background:#EDF1F7;color:#0B2545;font-size:6.5pt;font-weight:700;letter-spacing:.08em;',
    'text-transform:uppercase;padding:1.4mm 2.4mm;border-bottom:.5pt solid #0B2545;}',
    '.rp-line{display:flex;justify-content:space-between;gap:6mm;padding:1.1mm 2.4mm;font-size:8pt;}',
    '.rp-line .rp-v{font-family:Consolas,"Roboto Mono",monospace;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.rp-line.is-rule{border-top:.5pt solid #0B2545;font-weight:700;}',
    '.rp-line.is-close{border-top:1.2pt solid #0B2545;border-bottom:1.2pt solid #0B2545;font-weight:700;background:#EDF1F7;}',
    /* notes ------------------------------------------------------------- */
    '.rp-notes{margin-top:4mm;border-top:.6pt solid #0B2545;padding-top:1.6mm;}',
    '.rp-notes-h{font-size:6.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0B2545;margin-bottom:1mm;}',
    '.rp-note{display:flex;gap:2.4mm;font-size:7.5pt;padding:.7mm 0;align-items:baseline;}',
    '.rp-tag{flex:none;width:14mm;text-align:center;font-size:6pt;font-weight:700;letter-spacing:.1em;',
    'border:.5pt solid #0B2545;color:#0B2545;padding:.2mm 0;}',
    /* sign-off ---------------------------------------------------------- */
    '.rp-sign{display:flex;gap:10mm;margin-top:12mm;}',
    '.rp-sign-c{flex:1;border-top:.6pt solid #000;padding-top:1.6mm;}',
    '.rp-sign-l{font-size:7pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}',
    '.rp-sign-n{font-size:7pt;color:#3C4A5E;}',
    /* the footer, on every page ---------------------------------------- */
    '.rp-foot{position:absolute;left:12mm;right:12mm;bottom:6mm;display:flex;justify-content:space-between;',
    'gap:8mm;border-top:.5pt solid #0B2545;padding-top:1.4mm;font-size:6.5pt;color:#0B2545;',
    'font-family:Consolas,"Roboto Mono",monospace;letter-spacing:.06em;}',
    '.rp-foot-c{text-align:center;flex:1;}',
    '.rp-foot-r{text-align:right;}',
    /* preview only — never printed ------------------------------------- */
    '.rp-prev{background:#8892a4;padding:14px;overflow:auto;max-height:66vh;}',
    '.rp-prev-in{transform-origin:top left;}',
    '.rp-prev .rp-page{box-shadow:0 2px 10px rgba(0,0,0,.35);margin-bottom:14px;}',
    '@media print{',
    '@page{size:A4 landscape;margin:0;}',
    'html,body{margin:0;padding:0;background:#fff;}',
    '.rp-page{page-break-after:always;break-after:page;box-shadow:none;margin:0;}',
    '.rp-page:last-child{page-break-after:auto;break-after:auto;}',
    '}'
  ].join('');

  function styleOnce() {
    if (document.querySelector('style[data-report-style]')) return;
    var st = document.createElement('style');
    st.setAttribute('data-report-style', '1');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ==========================================================================
   * NUMBERS — the printed formats. Nothing else in the app formats like this,
   * on purpose: this is the accounting presentation, not the screen's.
   * ========================================================================*/
  // 5374501 -> "53,74,501"  (last three digits, then pairs — BD/Indian grouping)
  function grouped(n) {
    var s = String(Math.round(Math.abs(n)));
    if (s.length <= 3) return s;
    var head = s.slice(0, -3), tail = s.slice(-3), out = '';
    while (head.length > 2) { out = ',' + head.slice(-2) + out; head = head.slice(0, -2); }
    return head + out + ',' + tail;
  }
  // a figure as it prints: nothing is "0", a negative wears brackets
  function money(n, opts) {
    opts = opts || {};
    if (n == null || isNaN(n)) return '–';
    var v = Math.round(n);
    if (!v && !opts.zero) return '–';
    return v < 0 ? '(' + grouped(v) + ')' : grouped(v);
  }
  // a value that is negative BY NATURE (a deduction) — always in brackets
  function brackets(n) { return (!n || isNaN(n)) ? '–' : '(' + grouped(n) + ')'; }
  function pct(n, dp) {
    if (n == null || isNaN(n) || !isFinite(n)) return '–';
    return Number(n).toFixed(dp == null ? 2 : dp) + '%';
  }

  /* ==========================================================================
   * BUILDING BLOCKS — every one returns a detached node the paginator places.
   * ========================================================================*/
  function cellNode(tag, c) {
    // a cell is a string of HTML, or { v, num, strong, sub, span, cls }
    if (c == null) c = '';
    if (typeof c === 'string' || typeof c === 'number') c = { v: String(c) };
    var cls = (c.num ? '.num' : '') + (c.strong ? '.rp-strong' : '') + (c.cls ? '.' + c.cls : '');
    var td = el(tag + cls);
    td.innerHTML = (c.v == null ? '' : c.v) + (c.sub ? '<span class="rp-sub">' + c.sub + '</span>' : '');
    if (c.span) td.colSpan = c.span;
    if (c.width) td.style.width = c.width;
    return td;
  }

  /* A table plus its widths. The widths MUST travel in a <colgroup>: under
   * table-layout:fixed the browser takes its column widths from the FIRST row,
   * and the first row of these tables is the group band ("Earnings and
   * deductions" over four columns) — so widths written on the header cells below
   * it are silently ignored and every column inside a group comes out equal.
   * That one detail is the difference between a register and a mess. */
  function newTable(t, cls) {
    var table = el(cls);
    var head = t.head || [];
    var any = head.filter(function (h) { return h && h.width; }).length;
    if (any) {
      var cg = el('colgroup');
      head.forEach(function (h) { cg.appendChild(el('col', { style: (h && h.width) ? { width: h.width } : null })); });
      table.appendChild(cg);
    }
    table.appendChild(tableHead(t));
    return table;
  }

  function tableHead(t) {
    var thead = el('thead');
    if (t.groups && t.groups.length) {
      var gtr = el('tr');
      t.groups.forEach(function (g) {
        var th = el('th' + (g.label ? '.rp-grp' : ''), { text: g.label || '' });
        th.colSpan = g.span || 1;
        if (!g.label) th.className = '';
        gtr.appendChild(th);
      });
      thead.appendChild(gtr);
    }
    var htr = el('tr');
    t.head.forEach(function (h) {
      if (typeof h === 'string') h = { label: h };
      var th = el('th' + (h.num ? '.num' : ''));
      th.innerHTML = esc(h.label || '') + (h.sub ? '<span class="rp-sub">' + esc(h.sub) + '</span>' : '');
      if (h.width) th.style.width = h.width;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    return thead;
  }

  function panelsNode(pair) {
    var wrap = el('div.rp-panels');
    pair.forEach(function (p) {
      if (!p) return;
      var box = el('div.rp-panel');
      box.appendChild(el('div.rp-panel-h', { text: p.title || '' }));
      /* A panel can carry a small TABLE instead of label→value lines — a
       * departmental summary is four figures per department, which reads as a
       * table and as nothing else. It does not paginate: a panel moves whole. */
      if (p.table) {
        var mt = newTable(p.table, 'table.rp-tbl.rp-mini');
        var mb = el('tbody');
        (p.table.rows || []).forEach(function (r) {
          var tr = el('tr');
          r.forEach(function (c) { tr.appendChild(cellNode('td', c)); });
          mb.appendChild(tr);
        });
        if (p.table.totals) {
          var mtr = el('tr.rp-tot');
          p.table.totals.forEach(function (c) { mtr.appendChild(cellNode('td', c)); });
          mb.appendChild(mtr);
        }
        mt.appendChild(mb); box.appendChild(mt);
      }
      (p.lines || []).forEach(function (l) {
        var row = el('div.rp-line' + (l.rule ? '.is-rule' : '') + (l.close ? '.is-close' : ''));
        row.appendChild(el('span.rp-k', { text: l.k }));
        row.appendChild(el('span.rp-v', { text: l.v }));
        box.appendChild(row);
      });
      wrap.appendChild(box);
    });
    return wrap;
  }

  function notesNode(spec) {
    var wrap = el('div.rp-notes');
    wrap.appendChild(el('div.rp-notes-h', { text: spec.notesTitle || 'Notes' }));
    (spec.notes || []).forEach(function (n) {
      var row = el('div.rp-note');
      row.appendChild(el('span.rp-tag', { text: n.tag || 'NOTE' }));
      row.appendChild(el('span', { text: n.text }));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function signNode(spec) {
    var wrap = el('div.rp-sign');
    (spec.signoff || []).forEach(function (s) {
      wrap.appendChild(el('div.rp-sign-c', null, [
        el('div.rp-sign-l', { text: s.role }),
        el('div.rp-sign-n', { text: s.name || '' })
      ]));
    });
    return wrap;
  }

  function headNode(spec) {
    var wrap = el('div');
    var left = el('div', null, [
      el('div', null, [
        el('span.rp-brand', { text: spec.brand.name }),
        spec.brand.division ? el('span.rp-div', { text: spec.brand.division }) : null
      ].filter(Boolean)),
      el('div.rp-lines', { html: (spec.brand.lines || []).map(esc).join('<br>') })
    ]);
    var right = el('div.rp-meta', { html: (spec.meta || []).map(esc).join('<br>') });
    wrap.appendChild(el('div.rp-mast', null, [left, right]));
    wrap.appendChild(el('div.rp-title', { text: spec.title }));
    // scope is one line, or several: what the figures cover, then the policy a
    // reader needs in order not to misread them
    (Array.isArray(spec.scope) ? spec.scope : [spec.scope]).forEach(function (s) {
      if (s) wrap.appendChild(el('div.rp-scope', { text: s }));
    });
    if (spec.notice) wrap.appendChild(el('div.rp-notice', { text: spec.notice }));
    if (spec.kpis && spec.kpis.length) {
      var band = el('div.rp-kpis');
      spec.kpis.forEach(function (k) {
        band.appendChild(el('div.rp-kpi', null, [
          el('div.rp-kpi-l', { text: k.label }),
          el('div.rp-kpi-v', { text: k.value }),
          k.sub ? el('div.rp-kpi-s', { text: k.sub }) : null
        ].filter(Boolean)));
      });
      wrap.appendChild(band);
    }
    return wrap;
  }

  /* ==========================================================================
   * THE PAGINATOR
   * --------------------------------------------------------------------------
   * Fills one page's flow until the next node would cross the bottom margin,
   * then starts another. The table is the only thing that SPLITS, and it splits
   * only between rows, carrying its header onto each page. Everything else —
   * a panel pair, the notes, the sign-off — is atomic: it moves whole.
   * ========================================================================*/
  function pages(spec) {
    styleOnce();
    var host = el('div.rp-doc', { style: { position: 'fixed', left: '-10000px', top: '0', width: '297mm' } });
    document.body.appendChild(host);
    var out = [], flow = null;

    function newPage() {
      var pg = el('div.rp-page');
      flow = el('div.rp-flow');
      pg.appendChild(flow);
      host.appendChild(pg);
      out.push(pg);
      return pg;
    }
    function fits() { return flow.getBoundingClientRect().height <= FLOW_PX; }
    // append an ATOMIC node; if it does not fit on this page it moves to the next
    function place(node) {
      if (!flow) newPage();
      flow.appendChild(node);
      if (!fits() && flow.childNodes.length > 1) { flow.removeChild(node); newPage(); flow.appendChild(node); }
    }

    newPage();
    place(headNode(spec));

    if (spec.table) {
      var t = spec.table;
      var TCLS = 'table.rp-tbl' + (t.wide ? '.rp-wide' : '') + (t.tall ? '.rp-tall' : '');
      var table = newTable(t, TCLS), tbody = el('tbody');
      table.appendChild(tbody);
      place(table);
      (t.rows || []).forEach(function (r) {
        var tr = el('tr');
        (r.cells || r).forEach(function (c) { tr.appendChild(cellNode('td', c)); });
        tbody.appendChild(tr);
        if (!fits()) {                                   // this row crossed the line
          tbody.removeChild(tr);
          newPage();
          table = newTable(t, TCLS); tbody = el('tbody');
          table.appendChild(tbody);
          flow.appendChild(table);
          tbody.appendChild(tr);                         // it opens the new page
        }
      });
      /* THE TOTALS ROW prints ONCE, under the last body row — and never alone on
       * a page: a totals row with no rows above it reads as a report of nothing.
       * If it will not fit, the page break takes the last data row with it. */
      if (t.totals) {
        var ttr = el('tr.rp-tot');
        t.totals.forEach(function (c) { ttr.appendChild(cellNode('td', c)); });
        tbody.appendChild(ttr);
        if (!fits()) {
          tbody.removeChild(ttr);
          var last = tbody.lastChild;
          if (last) tbody.removeChild(last);
          newPage();
          table = newTable(t, TCLS); tbody = el('tbody');
          table.appendChild(tbody);
          flow.appendChild(table);
          if (last) tbody.appendChild(last);
          tbody.appendChild(ttr);
        }
      }
    }

    (spec.panelPairs || []).forEach(function (pair) { place(panelsNode(pair)); });
    if (spec.notes && spec.notes.length) place(notesNode(spec));
    if (spec.signoff && spec.signoff.length) place(signNode(spec));

    /* the footer — written last, because only now is "of Y" knowable */
    out.forEach(function (pg, i) {
      pg.appendChild(el('div.rp-foot', null, [
        el('span', { text: spec.confidential || 'CONFIDENTIAL' }),
        el('span.rp-foot-c', { text: spec.footId || '' }),
        el('span.rp-foot-r', { text: 'Page ' + (i + 1) + ' of ' + out.length })
      ]));
    });

    out.forEach(function (pg) { host.removeChild(pg); });
    document.body.removeChild(host);
    return out;
  }

  /* ==========================================================================
   * OUTPUT — one window, one document, the browser's own Save-as-PDF.
   * No library: the site is a static no-build deploy and stays free. Chrome
   * names the PDF after the document TITLE, so the spec's filename is set as
   * the title and the reader gets it pre-filled in the save dialog.
   * ========================================================================*/
  function docHtml(spec, nodes) {
    var body = nodes.map(function (n) { return n.outerHTML; }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(spec.docTitle || spec.title || 'Report') +
      '</title><style>' + CSS + '</style></head><body class="rp-doc">' + body + '</body></html>';
  }

  function spawn(spec, nodes) {
    var w = window.open('', '_blank', 'width=1200,height=880');
    if (!w) { ui.toast('Allow pop-ups to print this report', 'warn'); return null; }
    // the document is ISSUED at this point, not when it was previewed — a caller
    // that numbers its revisions commits the number here (see spec.onPrint)
    if (spec.onPrint) { try { spec.onPrint(); } catch (e) {} }
    w.document.write(docHtml(spec, nodes || pages(spec)));
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    return w;
  }

  /* The PREVIEW — the real pages, scaled to the modal. Not a mock-up of the
   * layout: the very nodes that are about to be printed. */
  function open(spec) {
    var nodes = pages(spec);
    var prev = el('div.rp-prev'), inner = el('div.rp-prev-in');
    nodes.forEach(function (n) { inner.appendChild(n); });
    prev.appendChild(inner);

    var m = ui.modal({
      title: spec.previewTitle || 'Print preview — ' + (spec.title || 'Report'), icon: 'printer', size: 'xl',
      body: el('div', null, [
        el('div.text-mute.sm.mb-2', { text: nodes.length + ' page' + (nodes.length === 1 ? '' : 's') +
          ' · A4 landscape · ' + (spec.footId || '') }),
        prev
      ]),
      /* keepOpen on both output buttons: the print dialog is a decision, and a
       * reader who cancels it must land back on the preview, not on nothing. */
      actions: [
        { label: 'Cancel', onClick: function () {} },
        { label: 'Save as PDF', icon: 'filetype-pdf', keepOpen: true, onClick: function () {
            ui.toast('In the print dialog choose Destination → Save as PDF', 'info');
            spawn(spec, nodes);
          } },
        { label: 'Print', icon: 'printer', variant: 'primary', keepOpen: true,
          onClick: function () { spawn(spec, nodes); } }
      ]
    });
    // scale to the modal's real width once it is on screen (a page is 297mm wide)
    requestAnimationFrame(function () {
      // 28px of padding + room for the scrollbar the tall preview always has —
      // an over-wide inner clips the right-hand columns, which is the one thing
      // a print preview must never do
      var avail = prev.clientWidth - 46, pageW = 297 * MM;
      var k = Math.min(1, avail / pageW);
      inner.style.transform = 'scale(' + k + ')';
      inner.style.width = pageW + 'px';
      inner.style.height = (nodes.length * (210 * MM + 14) * k) + 'px';
    });
    return m;
  }

  EPAL.report = { open: open, pages: pages, print: function (spec) { return spawn(spec); },
    money: money, brackets: brackets, pct: pct, grouped: grouped, css: CSS };

})(window.EPAL = window.EPAL || {});
