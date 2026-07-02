/* ============================================================================
 * EPAL GROUP ERP  ·  views/group/settings.js
 * ----------------------------------------------------------------------------
 * GROUP SETTINGS (route: group/settings) — the command-layer configuration.
 *
 * Registered specifically for the group so it overrides the wildcard company
 * settings view. Three form sections persisted to the settings.group store:
 *   Identity          — group name, legal name, tagline.
 *   Locale & Finance  — currency symbol (readonly BDT taka), fiscal year note,
 *                       date format.
 *   Appearance        — default theme; saving applies data-theme immediately
 *                       and persists ui.theme so the whole shell follows.
 *
 * Plus a Data Management card wired to REAL operations:
 *   Download full backup — serialises every namespaced localStorage key
 *                          (epal.v1. prefix) into one JSON file.
 *   Restore backup       — reads a JSON file, validates the key namespace,
 *                          writes everything back and reloads (with confirm).
 *   Reset demo data      — confirm, then EPAL.db.reset() and reload.
 *
 * KPI row + storage-footprint chart give the owner a live view of the data
 * layer this screen guards.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var NS = EPAL.store.namespace;            // 'epal.v1.'

  /* ---- tiny shared helpers ------------------------------------------------*/
  function kpi(label, value, icon, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }
  function nsKeys() {
    return Object.keys(localStorage).filter(function (k) { return k.indexOf(NS) === 0; });
  }
  function storageStats() {
    var keys = nsKeys(), bytes = 0, records = 0, perStore = [];
    keys.forEach(function (k) {
      var v = localStorage.getItem(k) || '';
      var b = (k.length + v.length) * 2;    // UTF-16 storage estimate
      bytes += b;
      var count = 0;
      try { var parsed = JSON.parse(v); if (Array.isArray(parsed)) count = parsed.length; } catch (e) {}
      records += count;
      perStore.push({ key: k.slice(NS.length), bytes: b, records: count });
    });
    perStore.sort(function (a, b) { return b.bytes - a.bytes; });
    return { keys: keys.length, bytes: bytes, records: records, perStore: perStore };
  }
  function dl(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/settings', { render: function (ctx) {
    var page = el('div.page');
    var cur = EPAL.store.get('settings.group', {}) || {};
    var stats = storageStats();

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'gear-fill', title: 'Group Settings',
      sub: 'Identity, locale, appearance and the data-management vault for the whole group.',
      actions: [
        el('button.btn.btn-ghost', { html: ui.icon('toggles2') + ' Module Control',
          onclick: function () { EPAL.router.navigate('group/module-manager'); } })
      ]
    }));

    /* ---- KPI row ---------------------------------------------------------*/
    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Data Stores', stats.keys, 'database-fill', 'namespaced localStorage keys'),
      kpi('Total Records', ui.num(stats.records), 'collection-fill', 'rows across all collections'),
      kpi('Storage Used', (stats.bytes / 1024).toFixed(1) + ' KB', 'hdd-fill', 'estimated on-device footprint'),
      kpi('App Version', 'v' + EPAL.config.version, 'stars', 'codename ' + EPAL.config.codename)
    ]));

    /* ---- settings form -----------------------------------------------------*/
    var form = EPAL.form([
      { type: 'section', label: 'Identity' },
      { key: 'name', label: 'Group Name', type: 'text', required: true,
        default: EPAL.config.group.name, col2: true },
      { key: 'legalName', label: 'Legal Name', type: 'text', required: true,
        default: EPAL.config.group.legalName, col2: true },
      { key: 'tagline', label: 'Tagline', type: 'text',
        default: EPAL.config.group.tagline, col2: true },

      { type: 'section', label: 'Locale & Finance' },
      { key: 'currencySymbol', label: 'Currency Symbol', type: 'text', readonly: true,
        default: EPAL.config.group.currencySymbol,
        hint: 'BDT (Bangladeshi Taka) — fixed across the group ledger.' },
      { key: 'fiscalNote', label: 'Fiscal Year', type: 'text',
        default: 'July – June (Bangladesh standard)',
        hint: 'Informational — reports label periods with this note.' },
      { key: 'dateFormat', label: 'Date Format', type: 'select',
        options: ['DD Mon YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'], default: 'DD Mon YYYY' },

      { type: 'section', label: 'Appearance' },
      { key: 'theme', label: 'Default Theme', type: 'select',
        options: [['dark', 'Dark — Command'], ['light', 'Light — Daylight']],
        default: EPAL.store.get('ui.theme', 'dark'),
        hint: 'Applied instantly on save, remembered for every session.' }
    ], cur);

    var formCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Group Profile & Preferences' }),
        el('span.card-sub', { text: 'persisted to settings.group' }) ]),
      el('div.card-body', null, [
        form.el,
        el('div.flex.justify-between.items-center.mt-2', null, [
          el('span.text-mute.xs', { text: 'Company-level preferences live in each concern’s own Settings.' }),
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Settings', onclick: function () {
            if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
            var vals = form.values();
            EPAL.store.set('settings.group', vals);
            document.documentElement.setAttribute('data-theme', vals.theme);
            EPAL.store.set('ui.theme', vals.theme);
            EPAL.bus.emit('theme:changed', { theme: vals.theme });
            ui.toast('Group settings saved · theme applied', 'success');
          } })
        ])
      ])
    ]);

    /* ---- data management ---------------------------------------------------*/
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) restoreBackup(f);
    });

    var dataCard = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('shield-lock-fill') + ' Data Management' }),
        el('span.card-sub', { text: 'backup · restore · reset' }) ]),
      el('div.card-body', null, [
        el('p.text-mute.sm', { text: 'The entire ERP state lives in the ' + NS + ' namespace. Take a full backup before big changes; restore it on any machine.' }),
        el('div.flex.gap-2.mt-2', { style: { flexWrap: 'wrap' } }, [
          el('button.btn.btn-primary', { html: ui.icon('cloud-arrow-down-fill') + ' Download Full Backup',
            onclick: function () { downloadBackup(); } }),
          el('button.btn.btn-ghost', { html: ui.icon('cloud-arrow-up') + ' Restore Backup',
            onclick: function () { fileInput.click(); } })
        ]),
        fileInput,
        el('div.mt-3', null, [
          el('div.section-label', { text: 'Danger Zone' }),
          el('p.text-mute.sm', { text: 'Wipe every store and reseed the demo dataset. All manual entries will be lost.' }),
          el('button.btn.btn-danger.mt-1', { html: ui.icon('arrow-counterclockwise') + ' Reset Demo Data',
            onclick: function () {
              ui.confirm({ title: 'Reset ALL demo data?',
                text: 'Every store (' + stats.keys + ' keys, ' + ui.num(stats.records) + ' records) will be wiped and reseeded. This cannot be undone.',
                danger: true, confirmLabel: 'Wipe & Reseed' }).then(function (ok) {
                if (!ok) return;
                EPAL.db.reset();
                ui.toast('Demo data reset — reloading…', 'success');
                setTimeout(function () { location.reload(); }, 700);
              });
            } })
        ])
      ])
    ]);

    /* ---- storage footprint chart ------------------------------------------*/
    var footId = ui.uid('gset');
    var chart = el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('hdd-stack') + ' Storage Footprint' }),
        el('span.card-sub', { text: 'largest stores by size (KB)' }) ]),
      el('div.card-body', null, [
        el('div', { style: { height: '240px', position: 'relative' } }, [ el('canvas', { id: footId }) ])
      ])
    ]);

    var row = el('div.two-col');
    row.appendChild(formCard);
    row.appendChild(el('div.flex.flex-col.gap-3', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
      dataCard, chart ]));
    page.appendChild(row);

    ctx.mount.appendChild(page);

    requestAnimationFrame(function () {
      var c = document.getElementById(footId);
      if (!c) return;
      var top = stats.perStore.slice(0, 8);
      if (!top.length) return;
      EPAL.charts.bar(c, {
        labels: top.map(function (s) { return s.key; }),
        datasets: [{ label: 'KB', data: top.map(function (s) { return +(s.bytes / 1024).toFixed(1); }),
          colors: top.map(function () { return '#c8a24a'; }) }],
        horizontal: true
      });
    });

    /* ---- backup / restore engines ------------------------------------------*/
    function downloadBackup() {
      var keys = nsKeys();
      if (!keys.length) { ui.toast('Nothing to back up yet', 'warning'); return; }
      var data = {};
      keys.forEach(function (k) { data[k] = localStorage.getItem(k); });
      var payload = {
        app: 'epal-group-erp', version: EPAL.config.version,
        exportedAt: new Date().toISOString(), keys: keys.length, data: data
      };
      dl('epal-group-backup-' + new Date().toISOString().slice(0, 10) + '.json',
        JSON.stringify(payload, null, 2), 'application/json');
      ui.toast('Backup downloaded — ' + keys.length + ' stores', 'success');
    }

    function restoreBackup(file) {
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) { ui.toast('Invalid backup — file is not valid JSON', 'error'); return; }
        var map = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
          ui.toast('Invalid backup — no data map found', 'error'); return;
        }
        var keys = Object.keys(map);
        if (!keys.length) { ui.toast('Invalid backup — the file contains no keys', 'error'); return; }
        var bad = keys.filter(function (k) { return k.indexOf(NS) !== 0; });
        if (bad.length) {
          ui.toast('Invalid backup — ' + bad.length + ' keys are outside the ' + NS + ' namespace', 'error');
          return;
        }
        ui.confirm({ title: 'Restore this backup?',
          text: keys.length + ' stores will overwrite the current data' +
            (parsed.exportedAt ? ' (backup taken ' + ui.date(parsed.exportedAt, 'full') + ')' : '') +
            '. The app will reload afterwards.',
          danger: true, confirmLabel: 'Restore & Reload' }).then(function (ok) {
          if (!ok) return;
          keys.forEach(function (k) {
            var v = map[k];
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          });
          ui.toast('Backup restored — reloading…', 'success');
          setTimeout(function () { location.reload(); }, 700);
        });
      };
      reader.onerror = function () { ui.toast('Could not read the selected file', 'error'); };
      reader.readAsText(file);
    }
  } });

})(window.EPAL = window.EPAL || {});
