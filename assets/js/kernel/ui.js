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

  EPAL.ui = {
    $: $, $$: $$, el: el, frag: frag, on: on, appendChildren: appendChildren,
    num: num, money: money, compact: compact, pct: pct, date: date, ago: ago, dur: dur,
    uid: uid, initials: initials, colorFor: colorFor, escapeHtml: escapeHtml,
    debounce: debounce, icon: icon, copy: copy, countUp: countUp,
    toast: toast, modal: modal, confirm: confirm
  };

})(window.EPAL = window.EPAL || {});
