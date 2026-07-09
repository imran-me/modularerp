/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kernel/ui.js
 * ----------------------------------------------------------------------------
 * WHAT: THE DOM + FORMATTING KIT — tiny, dependency-free, no-innerHTML helpers
 *   that every view builds itself from. Provides a hyperscript element builder,
 *   locale-aware money/number/date formatting, deterministic avatar colours, and
 *   the toast / modal / confirm feedback primitives. Framework-free on purpose so
 *   the system needs no build step and stays trivially portable.
 *
 * DATA IT OWNS (localStorage stores): none. Reads EPAL.config.group for the
 *   currency symbol/locale used by money()/date(); holds only an in-memory uid seq.
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - el() with `text:`/escapeHtml() is the safe path — user data must never be
 *     interpolated as raw innerHTML (XSS). Prefer el(...) over string HTML.
 *   - money()/compact() use Bangladeshi numbering: Lakh (1e5 -> "L") and Crore
 *     (1e7 -> "Cr"), NOT the Western K/M/B scale — keep this for local correctness.
 *   - countUp() and motion respect prefers-reduced-motion (instant set when reduced).
 *   - money(null) / date(invalid) render an em-dash, never "NaN" — reports must be clean.
 *
 * PUBLIC API (window.EPAL.ui):
 *   DOM:     $(sel,root), $$(sel,root), el(spec,attrs,children), frag(html),
 *            on(node,evt,sel,fn) [delegated], appendChildren(node,children)
 *   Format:  num, money, compact, pct, date(d,style), ago(d), dur(ms)
 *   Identity:uid(prefix), initials(name), colorFor(str), escapeHtml(s), debounce
 *   Feedback:toast(msg,level,opts), modal(opts)->{close,box,body}, confirm(opts)->Promise<bool>
 *   Misc:    icon(name,cls), copy(text), countUp(node,target,fmt,dur)
 *
 * ==> LARAVEL / PHP MAPPING: server-side this becomes Blade components/partials
 *     (modal, toast) plus formatting helpers/casts (a Money value object, Carbon
 *     for dates, an `e()`-style escaper). The DOM builders have no backend analogue.
 * ========================================================================*/

(function (EPAL) {
  'use strict';

  var CUR = (EPAL.config && EPAL.config.group) || { currencySymbol: '৳', locale: 'en-BD' };

  /* ---- DOM ---------------------------------------------------------------*/
  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* Hyperscript element builder.
   * el('div.card#x', {onclick:fn, 'data-id':3}, [child, 'text'])            */
  function el(spec, attrs, children) {
    var parts = spec.split(/(?=[.#])/);
    var tag = parts[0] && parts[0][0] !== '.' && parts[0][0] !== '#' ? parts.shift() : 'div';
    var node = document.createElement(tag);
    parts.forEach(function (p) {
      if (p[0] === '.') node.classList.add(p.slice(1));
      else if (p[0] === '#') node.id = p.slice(1);
    });
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className += (node.className ? ' ' : '') + v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    });
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null) return;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }
  // Build a DocumentFragment / element from an HTML string.
  function frag(htmlStr) {
    var t = document.createElement('template');
    t.innerHTML = htmlStr.trim();
    return t.content.childNodes.length === 1 ? t.content.firstChild : t.content;
  }
  function on(node, evt, sel, fn) {  // delegated events
    node.addEventListener(evt, function (e) {
      var target = e.target.closest(sel);
      if (target && node.contains(target)) fn(e, target);
    });
  }

  /* ---- Formatting --------------------------------------------------------*/
  function num(n, dp) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString(CUR.locale, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
  }
  function money(n, opts) {
    opts = opts || {};
    if (n == null || isNaN(n)) return '—';
    var sym = opts.symbol === false ? '' : (CUR.currencySymbol + ' ');
    if (opts.compact) return sym + compact(n);
    return sym + num(Math.round(n));
  }
  // 1250000 -> "12.5L" / "1.25Cr" (BD numbering) or "1.25M" if opts.intl
  function compact(n) {
    var abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (abs >= 1e7) return sign + (abs / 1e7).toFixed(2).replace(/\.00$/, '') + 'Cr';
    if (abs >= 1e5) return sign + (abs / 1e5).toFixed(2).replace(/\.00$/, '') + 'L';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return sign + abs;
  }
  function pct(n, dp) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(dp == null ? 1 : dp) + '%'; }
  function date(d, style) {
    if (!d) return '—';
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '—';
    var opt = style === 'long'  ? { day:'numeric', month:'long', year:'numeric' }
            : style === 'time'  ? { hour:'2-digit', minute:'2-digit' }
            : style === 'full'  ? { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }
            :                     { day:'2-digit', month:'short', year:'numeric' };
    return dt.toLocaleString(CUR.locale, opt);
  }
  function ago(d) {
    if (!d) return '';
    var s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    var dd = Math.floor(h / 24); if (dd < 30) return dd + 'd ago';
    return date(d);
  }
  // format a millisecond duration as 2h 15m / 45m / 12s
  function dur(ms) {
    if (!ms || ms < 0) return '0m';
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + 'h ' + (m ? m + 'm' : '');
    if (m) return m + 'm';
    return s + 's';
  }

  /* ---- Identity / misc ---------------------------------------------------*/
  var _seq = 0;
  function uid(prefix) { _seq += 1; return (prefix || 'id') + '_' + _seq.toString(36) + Math.floor(performance.now() % 1e6).toString(36); }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  // Deterministic pleasant HSL color from any string (avatars, tags, charts).
  function colorFor(str) {
    var h = 0; str = String(str);
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 62% 52%)';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms || 200); };
  }
  function icon(name, cls) { return '<i class="bi bi-' + name + (cls ? ' ' + cls : '') + '"></i>'; }
  /* Animated count-up for KPI numbers. fmt receives the interpolated value.
     Falls back to instant set when reduced-motion is preferred.             */
  function countUp(node, target, fmt, duration) {
    fmt = fmt || function (v) { return num(Math.round(v)); };
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = fmt(target); return; }
    var start = null, from = 0, dur = duration || 700;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);                    // easeOutCubic
      node.textContent = fmt(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function copy(text) { try { navigator.clipboard.writeText(text); toast('Copied to clipboard', 'success'); } catch (e) {} }

  /* ---- Toasts ------------------------------------------------------------*/
  function toastHost() {
    var h = $('#toast-host');
    if (!h) { h = el('div#toast-host.toast-host'); document.body.appendChild(h); }
    return h;
  }
  function toast(msg, level, opts) {
    opts = opts || {};
    var icons = { success:'check-circle-fill', error:'exclamation-octagon-fill',
                  warning:'exclamation-triangle-fill', info:'info-circle-fill' };
    var t = el('div.toast-item.toast-' + (level || 'info'), { role:'status' }, [
      frag('<span class="toast-ico">' + icon(icons[level || 'info']) + '</span>'),
      el('div.toast-body', null, [
        opts.title ? el('div.toast-title', { text: opts.title }) : null,
        el('div.toast-msg', { text: msg })
      ]),
      el('button.toast-x', { 'aria-label':'Dismiss', html:'&times;', onclick:function () { dismiss(); } })
    ]);
    toastHost().appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    var timer = setTimeout(dismiss, opts.duration || 3600);
    function dismiss() { clearTimeout(timer); t.classList.remove('in'); setTimeout(function () { t.remove(); }, 250); }
    return dismiss;
  }

  /* ---- Modal / Sheet -----------------------------------------------------*/
  function modal(opts) {
    opts = opts || {};
    var overlay = el('div.modal-overlay', { role:'dialog', 'aria-modal':'true' });
    var box = el('div.modal-box' + (opts.size ? '.modal-' + opts.size : ''));
    var head = el('div.modal-head', null, [
      el('div.modal-title', { html: (opts.icon ? icon(opts.icon) + ' ' : '') + escapeHtml(opts.title || '') }),
      el('button.modal-x', { 'aria-label':'Close', html:'&times;', onclick:close })
    ]);
    var body = el('div.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) appendChildren(body, opts.body);
    box.appendChild(head); box.appendChild(body);
    if (opts.footer !== false) {
      var foot = el('div.modal-foot');
      (opts.actions || [{ label:'Close', onClick: close }]).forEach(function (a) {
        foot.appendChild(el('button.btn' + (a.variant ? '.btn-' + a.variant : '.btn-ghost'),
          { onclick: function () { var r = a.onClick && a.onClick(box); if (r !== false && !a.keepOpen) close(); },
            html: (a.icon ? icon(a.icon) + ' ' : '') + escapeHtml(a.label) }));
      });
      box.appendChild(foot);
    }
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && opts.dismissable !== false) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('in'); });
    function esc(e) { if (e.key === 'Escape' && opts.dismissable !== false) close(); }
    function close() { document.removeEventListener('keydown', esc); overlay.classList.remove('in');
      setTimeout(function () { overlay.remove(); }, 220); if (opts.onClose) opts.onClose(); }
    return { close: close, box: box, body: body };
  }

  function confirm(opts) {
    opts = typeof opts === 'string' ? { text: opts } : (opts || {});
    return new Promise(function (resolve) {
      modal({
        title: opts.title || 'Please confirm', icon: opts.icon || 'question-circle',
        size: 'sm', dismissable: true,
        body: el('p.text-muted', { text: opts.text || 'Are you sure?' }),
        actions: [
          { label: opts.cancelLabel || 'Cancel', variant: 'ghost', onClick: function () { resolve(false); } },
          { label: opts.confirmLabel || 'Confirm', variant: opts.danger ? 'danger' : 'primary',
            onClick: function () { resolve(true); } }
        ],
        onClose: function () { resolve(false); }
      });
    });
  }

  /* ---- Direct one-tap send launchers (no modal) -------------------------- */
  function waOpen(phone, text) {
    window.open('https://wa.me/' + String(phone || '').replace(/[^0-9]/g, '') +
      '?text=' + encodeURIComponent(text || ''), '_blank', 'noopener');
  }
  function gmailOpen(to, subject, body) {
    window.open('https://mail.google.com/mail/?view=cm&fs=1' + (to ? '&to=' + encodeURIComponent(to) : '') +
      '&su=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || ''), '_blank', 'noopener');
  }

  // Download a data-URL (e.g. a base64 profile photo) as a file.
  function downloadDataUrl(dataUrl, filename) {
    if (!dataUrl) return;
    var a = el('a', { href: dataUrl, download: filename || 'download' });
    document.body.appendChild(a); a.click(); a.remove();
  }
  // Render a branded profile CARD to a PNG File (no libraries) for sharing.
  function profileCardImage(spec, cb) {
    try {
      spec = spec || {};
      var lines = spec.lines || [], W = 760, H = 176 + lines.length * 46 + 60;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#0A2472'; g.fillRect(0, 0, W, 86);                       // brand header
      g.fillStyle = '#ffffff'; g.font = '700 22px Inter, Arial, sans-serif'; g.fillText(spec.brand || 'Epal Group', 28, 52);
      g.fillStyle = '#0e1a31'; g.font = '800 27px Inter, Arial, sans-serif'; g.fillText(String(spec.title || ''), 28, 138);
      if (spec.subtitle) { g.fillStyle = '#54607d'; g.font = '400 15px Inter, Arial, sans-serif'; g.fillText(String(spec.subtitle), 28, 164); }
      var y = 214;
      lines.forEach(function (l) {
        g.fillStyle = '#8a93a9'; g.font = '600 12px Inter, Arial, sans-serif'; g.fillText(String(l[0] || '').toUpperCase(), 28, y);
        g.fillStyle = '#0e1a31'; g.font = '600 18px Inter, Arial, sans-serif'; g.fillText(String(l[1] == null ? '—' : l[1]), 28, y + 24);
        y += 46;
      });
      g.fillStyle = '#8a93a9'; g.font = '400 12px Inter, Arial, sans-serif'; g.fillText('Generated by ' + (spec.brand || 'Epal Group') + ' ERP', 28, H - 22);
      var name = (String(spec.title || 'profile').replace(/[^a-z0-9]+/gi, '-').toLowerCase()) + '.png';
      if (c.toBlob) c.toBlob(function (b) { cb(b ? new File([b], name, { type: 'image/png' }) : null); }, 'image/png');
      else cb(null);
    } catch (e) { cb(null); }
  }
  /* ---- Send with an OPTIONAL profile attachment ---------------------------
     A server (Laravel + WhatsApp Business API / Mail::attach) is what truly
     auto-sends a file. In the browser: the Web Share API can attach a generated
     card + text where supported (mobile/PWA); otherwise we download the profile
     for manual attach, then open the prefilled chat — or just send the message.
     opts: { channel:'wa'|'gmail', name, phone, to, subject, body,
             profile: { card:{title,subtitle,lines}, pdf: fn } } */
  function sendModal(opts) {
    opts = opts || {};
    function openChat() { if (opts.channel === 'gmail') gmailOpen(opts.to, opts.subject, opts.body); else waOpen(opts.phone, opts.body); }
    var prof = opts.profile;
    if (!prof) { openChat(); return; }
    var brand = (EPAL.config && EPAL.config.group && EPAL.config.group.name) || 'Epal Group';
    profileCardImage(prof.card || { brand: brand, title: opts.name }, function (file) {
      var canNative = false;
      try { canNative = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canNative = false; }
      var m = modal({ title: 'Send to ' + escapeHtml(opts.name || 'contact'), icon: opts.channel === 'gmail' ? 'envelope-fill' : 'whatsapp', size: 'sm', footer: false, body:
        el('div', null, [
          el('p.text-muted.sm', { style: { marginBottom: '14px' }, text: canNative
            ? 'Share the profile card AND your message together, or just send the text.'
            : 'Web ' + (opts.channel === 'gmail' ? 'Gmail' : 'WhatsApp') + ' can’t auto-attach a file — download the profile to attach it manually, then the chat opens with the message ready.' }),
          el('div.flex.flex-col.gap-2', null, [
            canNative ? el('button.btn.btn-primary.btn-block', { html: icon('share-fill') + ' Send profile card + message',
              onclick: function () { try { navigator.share({ files: [file], text: opts.body, title: opts.subject || opts.name }); } catch (e) {} m.close(); } }) : null,
            prof.pdf ? el('button.btn.btn-outline.btn-block', { html: icon('filetype-pdf') + ' Download profile (PDF), then open',
              onclick: function () { try { prof.pdf(); } catch (e) {} setTimeout(openChat, 500); m.close(); } }) : null,
            file ? el('button.btn.btn-outline.btn-block', { html: icon('image') + ' Download card (image), then open',
              onclick: function () { downloadDataUrl(URL.createObjectURL(file), (opts.name || 'profile') + '.png'); setTimeout(openChat, 500); m.close(); } }) : null,
            el('button.btn' + (canNative ? '.btn-ghost' : '.btn-primary') + '.btn-block', { html: icon('send') + ' Just send the message',
              onclick: function () { openChat(); m.close(); } })
          ])
        ]) });
    });
  }

  /* ---- Canonical action set — the SAME six actions, SAME order, everywhere:
         view · edit · delete  │  print · WhatsApp · Gmail. Pass only the ones a
         row supports; each is a handler, except wa/gmail which take a payload
         (or a function returning one) so the message is built per row:
           view/edit/del/print : function()
           wa    : { phone, text }   | function -> { phone, text }
           gmail : { to, subject, body } | function -> { to, subject, body }
         Returns a descriptor array for ui.rowActions() or datatable actions. */
  function actions(o) {
    o = o || {};
    // wa/gmail payloads may be an object or a function(row) — forward the row the
    // caller receives (datatable binds it; manual callers close over it, arg unused).
    function pay(v, r) { return (typeof v === 'function' ? v(r) : v) || {}; }
    // optional profile attachment resolver (enables the send-with-attachment chooser)
    function prof(r) { return o.profile ? (typeof o.profile === 'function' ? o.profile(r) : o.profile) : null; }
    var out = [];
    // NOTE: no 'view'/eye icon — clicking the ROW opens the detail everywhere, so
    // an eye button would be redundant. Modules wire row-click (onRow / tr onclick).
    if (o.edit)  out.push({ icon: 'pencil',  title: o.editTitle  || 'Edit',   onClick: o.edit });
    if (o.del)   out.push({ icon: 'trash',   title: o.delTitle   || 'Delete', danger: true, onClick: o.del });
    // divider sits before the first of the output group that is present
    var lead = o.print ? 'print' : o.wa ? 'wa' : o.gmail ? 'gmail' : null;
    if (o.print) out.push({ icon: 'printer',       title: o.printTitle || 'Print',            sep: lead === 'print', onClick: o.print });
    if (o.wa)    out.push({ icon: 'whatsapp',      title: o.waTitle    || 'Send on WhatsApp', sep: lead === 'wa',    onClick: function (r) { var p = pay(o.wa, r);    if (o.profile) sendModal({ channel: 'wa', name: p.name || (prof(r) || {}).name, phone: p.phone, body: p.text, profile: prof(r) }); else waOpen(p.phone, p.text); } });
    if (o.gmail) out.push({ icon: 'envelope-fill', title: o.gmailTitle || 'Send via Gmail',   sep: lead === 'gmail', onClick: function (r) { var p = pay(o.gmail, r); if (o.profile) sendModal({ channel: 'gmail', name: (prof(r) || {}).name, to: p.to, subject: p.subject, body: p.body, profile: prof(r) }); else gmailOpen(p.to, p.subject, p.body); } });
    return out;
  }

  /* ---- Share (Gmail / WhatsApp / Copy) — a small compose launcher ---------
     opts: { title, subject, body, to, toName, phone }. Opens Gmail's web compose
     and WhatsApp's click-to-chat prefilled — no backend, no API keys. */
  function share(opts) {
    opts = opts || {};
    var subject = opts.subject || opts.title || 'Epal Group';
    var body = opts.body || '';
    var to = opts.to || '';
    var phone = String(opts.phone || '').replace(/[^0-9]/g, '');
    var gmail = 'https://mail.google.com/mail/?view=cm&fs=1' + (to ? '&to=' + encodeURIComponent(to) : '') +
                '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    var wa = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(subject + '\n\n' + body);
    function chan(label, ic, color, onclick) {
      return el('button.share-chan', { onclick: onclick }, [
        frag('<span class="share-chan-ico" style="background:' + color + '22;color:' + color + '">' + icon(ic) + '</span>'),
        el('span.share-chan-lbl', { text: label })
      ]);
    }
    var m = modal({ title: opts.title || 'Share', icon: 'share-fill', size: 'md', footer: false, body:
      el('div', null, [
        (opts.to || opts.phone) ? el('div.share-to', { html: 'To: <strong>' + escapeHtml(opts.toName || opts.to || opts.phone) + '</strong>' }) : null,
        el('div.share-chans', null, [
          chan('Gmail', 'envelope-fill', '#EA4335', function () { window.open(gmail, '_blank', 'noopener'); }),
          chan('WhatsApp', 'whatsapp', '#25D366', function () { window.open(wa, '_blank', 'noopener'); }),
          chan('Copy text', 'clipboard-check', '#1A43BF', function () { copy(subject + '\n\n' + body); toast('Copied to clipboard', 'good'); m.close(); })
        ]),
        el('div.share-preview', null, [ el('div.share-preview-h', { text: subject }), el('pre.share-preview-b', { text: body }) ])
      ]) });
    return m;
  }

  /* ---- Print — a branded, printable window ------------------------------
     opts: { title, subtitle, meta, bodyHtml, footer }. Checklists render nicely
     from a <ul>; tables from a <table>. */
  function printDoc(opts) {
    opts = opts || {};
    var w = window.open('', '_blank', 'width=840,height=1040');
    if (!w) { toast('Allow pop-ups to print', 'warn'); return; }
    var brand = (EPAL.config && EPAL.config.group && EPAL.config.group.name) || 'Epal Group';
    var css = 'body{font-family:Inter,system-ui,Arial,sans-serif;color:#0e1a31;margin:0;padding:44px;}' +
      '.h{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1A43BF;padding-bottom:14px;margin-bottom:24px;}' +
      '.brand{font-weight:800;font-size:20px;color:#0A2472;letter-spacing:-.01em;}' +
      '.meta{color:#8a93a9;font-size:12px;}' +
      '.doc-title{font-size:23px;font-weight:800;margin:0 0 4px;letter-spacing:-.02em;}' +
      '.doc-sub{color:#54607d;font-size:13px;margin-bottom:20px;}' +
      'ul{padding:0;list-style:none;margin:0;} li{padding:10px 2px;border-bottom:1px solid #e6ebf5;font-size:14px;} li:before{content:"\\2610";color:#1A43BF;margin-right:10px;font-size:15px;}' +
      'table{width:100%;border-collapse:collapse;} td,th{padding:9px 10px;border-bottom:1px solid #e6ebf5;text-align:left;font-size:13px;} th{color:#8a93a9;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;}' +
      '.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
      '.foot{margin-top:30px;color:#8a93a9;font-size:11px;border-top:1px solid #e6ebf5;padding-top:12px;}';
    w.document.write('<html><head><title>' + escapeHtml(opts.title || 'Print') + '</title><style>' + css + '</style></head><body>' +
      '<div class="h"><div class="brand">' + escapeHtml(brand) + '</div><div class="meta">' + escapeHtml(opts.meta || '') + '</div></div>' +
      '<div class="doc-title">' + escapeHtml(opts.title || '') + '</div>' +
      (opts.subtitle ? '<div class="doc-sub">' + escapeHtml(opts.subtitle) + '</div>' : '') +
      (opts.bodyHtml || '') +
      '<div class="foot">Generated by ' + escapeHtml(brand) + ' ERP' + (opts.footer ? ' · ' + escapeHtml(opts.footer) : '') + '</div>' +
      '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350);
  }

  /* ---- Row actions — a compact icon-button group for table rows / cards ---
     actions: [{ icon, title, onClick, danger }] */
  function rowActions(list) {
    var wrap = el('div.row-actions');
    (list || []).forEach(function (a) {
      if (!a) return;
      if (a.sep) wrap.appendChild(el('span.row-act-sep', { 'aria-hidden': 'true' }));
      wrap.appendChild(el('button.row-act' + (a.danger ? '.row-act-danger' : ''), {
        title: a.title || a.label, 'aria-label': a.title || a.label,
        onclick: function (e) { e.stopPropagation(); a.onClick && a.onClick(e); }, html: icon(a.icon)
      }));
    });
    return wrap;
  }

  EPAL.ui = {
    $: $, $$: $$, el: el, frag: frag, on: on, appendChildren: appendChildren,
    num: num, money: money, compact: compact, pct: pct, date: date, ago: ago, dur: dur,
    uid: uid, initials: initials, colorFor: colorFor, escapeHtml: escapeHtml,
    debounce: debounce, icon: icon, copy: copy, countUp: countUp,
    toast: toast, modal: modal, confirm: confirm,
    share: share, waOpen: waOpen, gmailOpen: gmailOpen, actions: actions,
    sendModal: sendModal, downloadDataUrl: downloadDataUrl,
    printDoc: printDoc, rowActions: rowActions
  };

})(window.EPAL = window.EPAL || {});
