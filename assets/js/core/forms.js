/* ============================================================================
 * EPAL GROUP ERP  ·  core/forms.js
 * ----------------------------------------------------------------------------
 * SCHEMA-DRIVEN FORMS — declare fields once, get a premium form with inline
 * validation, sensible widgets, section titles and a save modal.
 *
 * Field spec:
 *   { key:'name', label:'Client Name', type:'text', required:true, col2:true,
 *     placeholder:'…', hint:'…', default:'', readonly:false,
 *     min:0, max:100, pattern:/regex/,
 *     options:['A','B'] | [['val','Label'],…] | optionsFrom:function(){…},
 *     showIf:function(values){return bool;} }
 * Types: text · number · money · date · email · phone · select · textarea ·
 *        checkbox · section (visual divider: {type:'section', label:'…'})
 *
 * API:
 *   var f = EPAL.form(fields, record);   // f.el, f.values(), f.validate()
 *   EPAL.formModal({ title, icon, size, fields, record, saveLabel,
 *                    onSave:function(values, record){ … return false to keep open } });
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;

  EPAL.form = function (fields, record) {
    record = record || {};
    var root = el('div.form-grid');
    var ctrls = {};   // key → { input, spec, errEl, wrap }

    fields.forEach(function (f) {
      if (f.type === 'section') { root.appendChild(el('div.form-section-title', { text: f.label })); return; }

      var input;
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
        f.type === 'checkbox' ? el('label.switch', null, [ input, el('span.track') ]) : input,
        f.hint ? el('div.hint', { text: f.hint }) : null,
        errEl
      ]);
      root.appendChild(wrap);
      ctrls[f.key] = { input: input, spec: f, errEl: errEl, wrap: wrap };

      input.addEventListener('input', function () { clearErr(f.key); applyShowIf(); });
      input.addEventListener('change', function () { clearErr(f.key); applyShowIf(); });
    });

    function values() {
      var out = {};
      Object.keys(ctrls).forEach(function (k) {
        var c = ctrls[k], t = c.spec.type;
        if (t === 'checkbox') out[k] = c.input.checked;
        else if (t === 'number' || t === 'money') out[k] = c.input.value === '' ? null : +c.input.value;
        else out[k] = c.input.value;
      });
      return out;
    }

    function setErr(key, msg) {
      var c = ctrls[key]; if (!c) return;
      c.input.classList.add('invalid'); c.errEl.textContent = msg;
    }
    function clearErr(key) {
      var c = ctrls[key]; if (!c) return;
      c.input.classList.remove('invalid'); c.errEl.textContent = '';
    }

    function validate() {
      var ok = true, vals = values();
      Object.keys(ctrls).forEach(function (k) {
        var f = ctrls[k].spec, v = vals[k];
        clearErr(k);
        if (f.showIf && !f.showIf(vals)) return;               // hidden → skip
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
