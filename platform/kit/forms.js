/* ============================================================================
 * EPAL GROUP ERP  ·  assets/js/kit/forms.js
 * ----------------------------------------------------------------------------
 * WHAT: The reusable form engine. You declare a schema (an array of field
 * specs) once and get back a rendered, validated, two-column premium form —
 * text/number/money/date/select/textarea/checkbox widgets, section dividers,
 * conditional (showIf) fields, and an embedded LINE-ITEM REPEATER (type:'items')
 * for multi-row data (passengers, journal lines, BOQ rows, invoice lines).
 * EPAL.formModal wraps a form in a Cancel/Save modal with validation. This file
 * owns NO data — it only builds DOM and reads/validates user input; persistence
 * is the caller's job (usually via EPAL.entity / EPAL.db).
 *
 * DATA IT OWNS (localStorage stores): none. Pure UI toolkit.
 *
 * FIELD SPEC:
 *   { key:'name', label:'Client Name', type:'text', required:true, col2:true,
 *     placeholder:'…', hint:'…', default:'', readonly:false,
 *     min:0, max:100, step:'any', pattern:/regex/, patternMsg:'…',
 *     options:['A','B'] | [['val','Label'],…] | optionsFrom:function(){…},
 *     showIf:function(values){return bool;} }
 *   Types: text · number · money · date · email · phone · select · textarea ·
 *          checkbox · section ({type:'section', label:'…'} visual divider) ·
 *          items (line-item repeater — see the 'items' spec below).
 *   ITEMS field: { type:'items', key, label, required, min, addLabel, emptyText,
 *     columns:[{key,label,type,width,options,step,default}],
 *     footer:function(rows){return html;}, onChange:function(rows,wrapEl){} }
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Required + type validation (number range, email, phone, regex) runs client
 *     side before onSave; onSave must not fire on invalid input.
 *   - showIf fields that are hidden are SKIPPED by validation (a hidden required
 *     field must not block save).
 *   - money/number values are coerced to Number (empty -> null), so downstream
 *     math and ledger postings never see strings.
 *   - The items repeater enforces a minimum row count (min, or 1 when required).
 *
 * PUBLIC API (window.EPAL.*):
 *   EPAL.form(fields, record) -> { el, values(), validate(), setErr(k,msg), ctrls }
 *       — build a form; values() returns the typed record, validate() paints
 *         inline errors and returns bool.
 *   EPAL.formModal({title,icon,size,fields,record,saveLabel,onSave}) -> modal
 *       — onSave(values, record); return false to keep the modal open.
 *
 * ==> LARAVEL / PHP MAPPING: the field schema becomes a reusable Blade form
 *     component set (<x-form> + <x-field> partials driven by a $fields array, or
 *     a Form Builder like Filament/Livewire). Validation rules (required, min/max,
 *     email, regex) map to a FormRequest's rules(). The items repeater maps to a
 *     hasMany relation edited via a repeater component; each row becomes a child
 *     model saved in one transaction with the parent.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;

  /* Searchable combobox over a native <select> — opt in with field.searchable:true
   * (great for long lists like the chart of accounts). The real <select> stays in
   * the DOM but hidden, so the form's value contract is UNCHANGED (ctrls.input is
   * still the <select>: values()/validate()/showIf all keep working). The visible
   * input filters as you type and floats matches to the TOP (a typed account CODE
   * surfaces first), writing the pick back to the <select> + dispatching change. */
  function makeCombobox(sel, f) {
    var norm = [].map.call(sel.options, function (o) { return { v: o.value, label: o.textContent }; });
    var wrap = el('div.combo');
    var display = el('input.input.combo-input', { type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: f.placeholder || 'Type to search…' });
    var caret = el('span.combo-caret', { html: '<i class="bi bi-chevron-expand"></i>' });
    var panel = el('div.combo-panel');
    sel.style.display = 'none';
    wrap.appendChild(display); wrap.appendChild(caret); wrap.appendChild(sel); wrap.appendChild(panel);

    var shown = norm.slice(), active = -1;
    function labelFor(v) { var m = norm.filter(function (o) { return o.v === String(v); })[0]; return m ? m.label : ''; }
    display.value = labelFor(sel.value);

    function score(o, q) {
      var lab = o.label.toLowerCase(), v = o.v.toLowerCase();
      if (v === q || lab === q) return 0;
      if (v.indexOf(q) === 0 || lab.indexOf(q) === 0) return 1;   // starts-with → top
      if (v.indexOf(q) >= 0 || lab.indexOf(q) >= 0) return 2;     // contains
      return -1;
    }
    function filter(q) {
      q = (q || '').trim().toLowerCase();
      if (!q) { shown = norm.slice(); }
      else {
        shown = norm.map(function (o) { return { o: o, s: score(o, q) }; })
          .filter(function (x) { return x.s >= 0; })
          .sort(function (a, b) { return a.s - b.s; })
          .map(function (x) { return x.o; });
      }
      active = shown.length ? 0 : -1;
      paint();
    }
    function paint() {
      panel.innerHTML = '';
      if (!shown.length) { panel.appendChild(el('div.combo-empty', { text: 'No match' })); return; }
      shown.forEach(function (o, i) {
        var row = el('div.combo-opt' + (o.v === sel.value ? '.is-sel' : '') + (i === active ? '.is-active' : ''), { text: o.label });
        row.addEventListener('mousedown', function (e) { e.preventDefault(); choose(o); });
        panel.appendChild(row);
      });
      var act = panel.children[active]; if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }
    function open() { if (wrap.classList.contains('open')) return; wrap.classList.add('open'); filter(''); }
    function close() { wrap.classList.remove('open'); display.value = labelFor(sel.value); }
    function choose(o) { sel.value = o.v; display.value = o.label; wrap.classList.remove('open'); sel.dispatchEvent(new Event('change', { bubbles: true })); }

    display.addEventListener('focus', open);
    display.addEventListener('input', function () { wrap.classList.add('open'); filter(display.value); });
    display.addEventListener('keydown', function (e) {
      var open_ = wrap.classList.contains('open');
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open_) { open(); return; } active = Math.min(shown.length - 1, active + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      else if (e.key === 'Enter') { if (open_ && shown[active]) { e.preventDefault(); choose(shown[active]); } }
      else if (e.key === 'Escape') { if (open_) { e.preventDefault(); close(); } }
    });
    caret.addEventListener('mousedown', function (e) { e.preventDefault(); if (wrap.classList.contains('open')) close(); else { display.focus(); open(); } });
    document.addEventListener('mousedown', function (e) { if (!wrap.contains(e.target)) close(); });
    sel.addEventListener('change', function () { if (!wrap.classList.contains('open')) display.value = labelFor(sel.value); });
    return wrap;
  }

  EPAL.form = function (fields, record) {
    record = record || {};
    var root = el('div.form-grid');
    var ctrls = {};   // key → { input, spec, errEl, wrap }

    fields.forEach(function (f) {
      if (f.type === 'section') { root.appendChild(el('div.form-section-title', { text: f.label })); return; }

      // ---- Line-item repeater (multi-pax, journal lines, BOQ rows, …) -------
      if (f.type === 'items') {
        var im = buildItems(f, record[f.key]);
        root.appendChild(im.wrap);
        ctrls[f.key] = { input: im.wrap, spec: f, errEl: im.errEl, wrap: im.wrap, getVal: im.read, isItems: true };
        return;
      }

      // ---- Image / photo picker (profile pics, logos) — stores a base64 data URL
      if (f.type === 'image') {
        var imgState = { data: record[f.key] != null ? record[f.key] : (f.default || '') };
        var preview = el('div.img-picker-preview' + (f.round ? '.round' : ''));
        var paintImg = function () {
          preview.innerHTML = '';
          preview.appendChild(imgState.data ? el('img', { src: imgState.data, alt: '' })
            : ui.frag('<span class="img-picker-ph">' + ui.icon(f.icon || 'image') + '</span>'));
        };
        paintImg();
        var fileIn = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: function (e) {
          var fl = e.target.files && e.target.files[0]; if (!fl) return;
          var rd = new FileReader(); rd.onload = function () { imgState.data = String(rd.result); paintImg(); }; rd.readAsDataURL(fl); } });
        var errImg = el('div.field-error');
        var wrapImg = el('div.field' + (f.col2 ? '.col-2' : ''), null, [
          el('label', { html: ui.escapeHtml(f.label || f.key) }),
          el('div.img-picker', null, [ preview, el('div.img-picker-ctrls', null, [
            el('button.btn.btn-sm.btn-outline', { type: 'button', html: ui.icon('upload') + ' Upload', onclick: function () { fileIn.click(); } }),
            el('button.btn.btn-sm.btn-ghost', { type: 'button', html: ui.icon('trash') + ' Remove', onclick: function () { imgState.data = ''; paintImg(); } }),
            fileIn
          ]) ]),
          f.hint ? el('div.hint', { text: f.hint }) : null, errImg
        ]);
        root.appendChild(wrapImg);
        ctrls[f.key] = { input: wrapImg, spec: f, errEl: errImg, wrap: wrapImg, getVal: function () { return imgState.data; } };
        return;
      }

      var input;
      var fieldEl = null;   // DOM to append (defaults to `input`; a searchable select wraps it in a combobox)
      var val = record[f.key] != null ? record[f.key] : (f.default != null ? f.default : '');

      if (f.type === 'select') {
        input = el('select.select', { id: 'f-' + f.key });
        var opts = f.optionsFrom ? f.optionsFrom() : (f.options || []);
        opts.forEach(function (o) {
          var v = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o;
          var op = el('option', { value: v, text: label });
          if (String(v) === String(val)) op.selected = true;
          input.appendChild(op);
        });
        if (f.searchable && opts.length) { fieldEl = makeCombobox(input, f); }
      } else if (f.type === 'textarea') {
        input = el('textarea.input', { id: 'f-' + f.key, rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = val;
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox', id: 'f-' + f.key });
        input.checked = !!val;
      } else {
        var htmlType = { money: 'number', phone: 'tel' }[f.type] || f.type || 'text';
        input = el('input.input', { id: 'f-' + f.key, type: htmlType, placeholder: f.placeholder || '' });
        input.value = val;
        if (f.type === 'money' || f.type === 'number') { input.min = f.min != null ? f.min : ''; input.step = f.step || 'any'; }
      }
      if (f.readonly) { input.disabled = true; }

      var errEl = el('div.field-error');
      var wrap = el('div.field' + (f.col2 ? '.col-2' : ''), null, [
        el('label', { html: ui.escapeHtml(f.label || f.key) + (f.required ? ' <span class="req">*</span>' : '') }),
        f.type === 'checkbox' ? el('label.switch', null, [ input, el('span.track') ]) : (fieldEl || input),
        f.hint ? el('div.hint', { text: f.hint }) : null,
        errEl
      ]);
      root.appendChild(wrap);
      ctrls[f.key] = { input: input, spec: f, errEl: errEl, wrap: wrap };

      input.addEventListener('input', function () { clearErr(f.key); applyShowIf(); });
      input.addEventListener('change', function () { clearErr(f.key); applyShowIf(); });
    });

    /* ---- Line-item repeater builder --------------------------------------*/
    function buildItems(f, initial) {
      var cols = f.columns || [];
      var rows = Array.isArray(initial) ? initial.map(function (r) { return r; }) : (Array.isArray(f.default) ? f.default.map(function (r) { return r; }) : []);
      var minRows = f.min != null ? f.min : 0;
      var errEl = el('div.field-error');
      var body = el('div.items-rows');
      var wrap = el('div.field.col-2.items-field', null, [
        el('label', { html: ui.escapeHtml(f.label || f.key) + (f.required ? ' <span class="req">*</span>' : '') }),
        body,
        el('div.items-foot', null, [
          el('button.btn.btn-sm.btn-ghost', { type: 'button', html: ui.icon('plus-lg') + ' ' + (f.addLabel || 'Add row'),
            onclick: function () { rows.push({}); render(); } }),
          f.footer ? el('div.items-total', { id: 'items-total-' + f.key }) : null
        ]),
        f.hint ? el('div.hint', { text: f.hint }) : null,
        errEl
      ]);

      function readRow(rowEl) {
        var o = {};
        cols.forEach(function (c) {
          var inp = rowEl.querySelector('[data-ik="' + c.key + '"]');
          if (!inp) { o[c.key] = null; return; }
          if (c.type === 'checkbox') o[c.key] = inp.checked;
          else if (c.type === 'number' || c.type === 'money') o[c.key] = inp.value === '' ? null : +inp.value;
          else o[c.key] = inp.value;
        });
        return o;
      }
      function read() {
        return ui.$$('.items-row', body).map(function (r) { return readRow(r); });
      }
      function refreshFooter() {
        if (!f.footer) return;
        var t = wrap.querySelector('#items-total-' + f.key);
        if (t) t.innerHTML = f.footer(read());
      }
      function render() {
        body.innerHTML = '';
        if (!rows.length) body.appendChild(el('div.items-empty.text-mute.sm', { text: f.emptyText || 'No rows yet — add one below.' }));
        rows.forEach(function (row, idx) {
          var cells = cols.map(function (c) {
            var v = row[c.key] != null ? row[c.key] : (c.default != null ? c.default : '');
            var inp;
            if (c.type === 'select') {
              inp = el('select.select.items-input', { 'data-ik': c.key });
              (c.options || []).forEach(function (o) {
                var ov = Array.isArray(o) ? o[0] : o, ol = Array.isArray(o) ? o[1] : o;
                var op = el('option', { value: ov, text: ol }); if (String(ov) === String(v)) op.selected = true; inp.appendChild(op);
              });
            } else if (c.type === 'checkbox') {
              inp = el('input.items-input', { type: 'checkbox', 'data-ik': c.key }); inp.checked = !!v;
            } else {
              var ht = { money: 'number', phone: 'tel' }[c.type] || c.type || 'text';
              inp = el('input.input.items-input', { type: ht, 'data-ik': c.key, placeholder: c.label || '' });
              inp.value = v; if (c.type === 'money' || c.type === 'number') inp.step = c.step || 'any';
            }
            inp.addEventListener('input', function () { rows[idx] = readRow(rowEl); refreshFooter(); if (f.onChange) f.onChange(read(), wrap); });
            inp.addEventListener('change', function () { rows[idx] = readRow(rowEl); refreshFooter(); if (f.onChange) f.onChange(read(), wrap); });
            return el('div.items-cell', { style: c.width ? { flex: '0 0 ' + c.width } : null }, [
              el('span.items-cell-label', { text: c.label || c.key }), inp
            ]);
          });
          var rowEl = el('div.items-row', null, cells.concat([
            el('button.items-del', { type: 'button', title: 'Remove', html: ui.icon('x-lg'),
              onclick: function () { rows.splice(idx, 1); render(); } })
          ]));
          body.appendChild(rowEl);
        });
        refreshFooter();
        if (f.onChange) f.onChange(read(), wrap);
      }
      // seed minimum rows
      while (rows.length < minRows) rows.push({});
      render();
      return { wrap: wrap, errEl: errEl, read: read };
    }

    function values() {
      var out = {};
      Object.keys(ctrls).forEach(function (k) {
        var c = ctrls[k], t = c.spec.type;
        if (c.getVal) out[k] = c.getVal();            // items + image controls
        else if (t === 'checkbox') out[k] = c.input.checked;
        else if (t === 'number' || t === 'money') out[k] = c.input.value === '' ? null : +c.input.value;
        else out[k] = c.input.value;
      });
      return out;
    }

    function setErr(key, msg) {
      var c = ctrls[key]; if (!c) return;
      if (!c.isItems) c.input.classList.add('invalid');
      c.errEl.textContent = msg;
    }
    function clearErr(key) {
      var c = ctrls[key]; if (!c) return;
      if (!c.isItems) c.input.classList.remove('invalid');
      c.errEl.textContent = '';
    }

    function validate() {
      var ok = true, vals = values();
      Object.keys(ctrls).forEach(function (k) {
        var f = ctrls[k].spec, v = vals[k];
        clearErr(k);
        // A field hidden by showIf must never block save, even if required.
        if (f.showIf && !f.showIf(vals)) return;               // hidden → skip
        if (ctrls[k].isItems) {
          // Line-item minimum: explicit min, else 1 when required, else 0.
          var need = f.min != null ? f.min : (f.required ? 1 : 0);
          if ((v ? v.length : 0) < need) { setErr(k, 'Add at least ' + need + ' ' + (need === 1 ? 'row' : 'rows')); ok = false; }
          return;
        }
        if (f.required && (v === '' || v == null || v === false && f.type !== 'checkbox')) {
          setErr(k, (f.label || k) + ' is required'); ok = false; return;
        }
        if (v == null || v === '') return;
        if ((f.type === 'number' || f.type === 'money')) {
          if (isNaN(v)) { setErr(k, 'Must be a number'); ok = false; return; }
          if (f.min != null && v < f.min) { setErr(k, 'Minimum ' + f.min); ok = false; return; }
          if (f.max != null && v > f.max) { setErr(k, 'Maximum ' + f.max); ok = false; return; }
        }
        if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setErr(k, 'Invalid email'); ok = false; return; }
        if (f.type === 'phone' && !/^[+\d][\d\s-]{6,}$/.test(v)) { setErr(k, 'Invalid phone'); ok = false; return; }
        if (f.pattern && !f.pattern.test(v)) { setErr(k, f.patternMsg || 'Invalid format'); ok = false; return; }
      });
      return ok;
    }

    function applyShowIf() {
      var vals = values();
      Object.keys(ctrls).forEach(function (k) {
        var f = ctrls[k].spec;
        if (f.showIf) ctrls[k].wrap.style.display = f.showIf(vals) ? '' : 'none';
      });
    }
    applyShowIf();

    return { el: root, values: values, validate: validate, setErr: setErr, ctrls: ctrls };
  };

  /* Convenience: a modal wrapping a form with Cancel/Save + validation. ----*/
  EPAL.formModal = function (opts) {
    var form = EPAL.form(opts.fields, opts.record);
    return ui.modal({
      title: opts.title, icon: opts.icon || 'pencil-square', size: opts.size || 'lg',
      body: form.el,
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: opts.saveLabel || 'Save', variant: 'primary', onClick: function () {
            if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return false; }
            return opts.onSave(form.values(), opts.record);
          } }
      ]
    });
  };

})(window.EPAL = window.EPAL || {});
