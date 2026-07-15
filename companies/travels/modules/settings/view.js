/* ============================================================================
 * EPAL GROUP ERP  ·  companies/travels/modules/settings/view.js
 * ----------------------------------------------------------------------------
 * TRAVELS — SETTINGS. Travels-specific configuration: company profile, financial
 * defaults, document numbering, notification preferences and data tools. ONE
 * registered view branches on ctx.subId (pill-tabs). Because the router prefers a
 * specific view over the shared "star-slash-settings" wildcard, this Travels
 * screen supersedes the generic one WITHOUT touching any other company — and it
 * PRESERVES the same store key (`settings.travels`) and every field the shared
 * form used, so nothing downstream regresses.
 *
 *   profile        → identity: name, licence/IATA, BIN/VAT, contact, logo
 *   financial      → currency, fiscal year, low-margin alert, credit defaults
 *   documents      → invoice/voucher/statement prefixes, footer, logo-on-docs
 *   notifications  → which alerts & bots fire, and on which channel
 *   data           → module control, workforce, export & restore settings
 *
 * Each tab saves independently via EPAL.store.patch (shallow merge) so tabs never
 * clobber each other. Admin-gated (auth.js). Never write a literal star-slash here.
 * ==> LARAVEL: a company_settings JSON column / settings table + a SettingsController
 *     with a tab per section; policies restrict to admins.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el;
  var CID = 'travels';
  var KEY = 'settings.travels';
  var CO = { name: 'Epal Travels & Consultancy', tagline: 'Air · Visa · Consultancy' };

  function cur() { return EPAL.store.get(KEY, {}) || {}; }
  function save(values, msg) { EPAL.store.patch(KEY, values); ui.toast(msg || 'Settings saved', 'success'); }

  EPAL.view('travels/settings', {
    render: function (ctx) {
      var sub = ctx.subId || 'profile';
      if (['profile', 'financial', 'documents', 'notifications', 'data'].indexOf(sub) < 0) sub = 'profile';
      var page = el('div.page');
      var titles = { profile: 'Settings', financial: 'Financial', documents: 'Documents', notifications: 'Notifications', data: 'Data & Access' };
      page.appendChild(EPAL.pageHead({
        eyebrow: sub === 'profile' ? 'Epal Travels' : 'Travels › Settings', icon: 'gear-fill', title: titles[sub],
        sub: 'Travels-specific configuration. Module visibility lives in Group ▸ Module Control.',
        actions: [ el('a.btn.btn-ghost', { href: '#/group/module-manager', html: ui.icon('toggles2') + ' Module Control' }) ]
      }));

      // identity preview strip
      var c = cur();
      page.appendChild(el('div.card.mb-3', null, [ el('div.card-body', null, [
        el('div.flex.items-center.gap-2.flex-wrap', null, [
          c.logo ? ui.frag('<span class="avatar" style="width:46px;height:46px;background-image:url(' + c.logo + ');background-size:cover;background-position:center"></span>')
                 : ui.frag('<span class="notif-ico notif-info">' + ui.icon('airplane-fill') + '</span>'),
          el('div.flex-1', { style: { minWidth: '180px' } }, [ el('div.fw-700', { style: { fontSize: '17px' }, text: c.displayName || CO.name }),
            el('div.text-mute.sm', { text: (c.tagline || CO.tagline) + (c.iataNo ? ' · IATA ' + c.iataNo : '') }) ]),
          el('span.badge.badge-good', { text: (c.currency || 'BDT') }),
          el('span.badge', { text: 'FY ' + (c.fiscalNote || 'Jul–Jun') })
        ])
      ]) ]));

      var pills = el('div.pill-tab.mb-3');
      [['profile', 'Profile'], ['financial', 'Financial'], ['documents', 'Documents'], ['notifications', 'Notifications'], ['data', 'Data & Access']].forEach(function (p) {
        pills.appendChild(el('button' + (sub === p[0] ? '.active' : ''), { text: p[1],
          onclick: function () { EPAL.router.navigate('travels/settings' + (p[0] === 'profile' ? '' : '/' + p[0])); } }));
      });
      page.appendChild(pills);
      ({ profile: profileTab, financial: financialTab, documents: documentsTab, notifications: notificationsTab, data: dataTab }[sub])(page);
      ctx.mount.appendChild(page);
    }
  });

  /* ---- a form card with its own Save button ------------------------------*/
  function formCard(page, title, icon, fields, msg) {
    var form = EPAL.form(fields, cur());
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon(icon) + ' ' + title }) ]),
      el('div.card-body', null, [ form.el, el('div.flex.justify-end.mt-2', null, [
        el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save', onclick: function () {
          if (form.validate && !form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
          save(form.values(), msg); EPAL.router.render();
        } }) ]) ])
    ]));
    return form;
  }

  /* ======================================================= PROFILE */
  function profileTab(page) {
    formCard(page, 'Company Profile', 'buildings', [
      { type: 'section', label: 'Identity' },
      { key: 'logo', label: 'Logo', type: 'image', icon: 'airplane', col2: true },
      { key: 'displayName', label: 'Display name', type: 'text', default: CO.name, col2: true },
      { key: 'legalName', label: 'Legal name', type: 'text', default: 'Epal Travels & Consultancy Ltd.' },
      { key: 'tagline', label: 'Tagline', type: 'text', default: CO.tagline },
      { type: 'section', label: 'Licences' },
      { key: 'licenseNo', label: 'Travel licence no', type: 'text', placeholder: 'e.g. DTL-2011-0456' },
      { key: 'iataNo', label: 'IATA / ARC no', type: 'text', placeholder: 'e.g. 27-3 1234 5' },
      { key: 'binVat', label: 'BIN / VAT reg', type: 'text', placeholder: 'e.g. 004123456-0101' },
      { type: 'section', label: 'Contact' },
      { key: 'phone', label: 'Phone', type: 'phone', default: '+880 2 9876543' },
      { key: 'email', label: 'Email', type: 'email', default: 'info@epaltravels.com' },
      { key: 'website', label: 'Website', type: 'text', default: 'www.epaltravels.com' },
      { key: 'address', label: 'Address', type: 'textarea', col2: true, default: 'Gulshan Avenue, Dhaka 1212, Bangladesh' }
    ], 'Company profile saved');
  }

  /* ======================================================= FINANCIAL */
  function financialTab(page) {
    formCard(page, 'Financial Defaults', 'cash-stack', [
      { type: 'section', label: 'Currency & Year' },
      { key: 'currency', label: 'Currency', type: 'select', options: ['BDT', 'USD', 'SAR', 'AED', 'EUR'], default: 'BDT' },
      { key: 'fiscalNote', label: 'Fiscal year', type: 'text', default: 'July – June (BD standard)' },
      { type: 'section', label: 'Controls' },
      { key: 'lowMarginAlert', label: 'Low-margin alert threshold (%)', type: 'number', min: 0, max: 100, default: 12,
        hint: 'Drives the Profit-Leak flag in Analytics.' },
      { key: 'defaultCreditLimit', label: 'Default party credit limit (৳)', type: 'money', min: 0, default: 500000 },
      { key: 'invoiceTax', label: 'Default VAT / tax (%)', type: 'number', min: 0, max: 50, default: 0 },
      { key: 'notifyOnSale', label: 'Notify on every recorded sale', type: 'checkbox', default: true, col2: true }
    ], 'Financial defaults saved');
  }

  /* ======================================================= DOCUMENTS */
  function documentsTab(page) {
    var c = cur();
    formCard(page, 'Documents & Numbering', 'file-earmark-text', [
      { type: 'section', label: 'Prefixes' },
      { key: 'invoicePrefix', label: 'Invoice prefix', type: 'text', default: 'TV-INV' },
      { key: 'voucherPrefix', label: 'Voucher prefix', type: 'text', default: 'TV-PV' },
      { key: 'statementPrefix', label: 'Statement prefix', type: 'text', default: 'TV-STMT' },
      { key: 'nextNumber', label: 'Next running number', type: 'number', min: 1, default: 1001 },
      { type: 'section', label: 'Presentation' },
      { key: 'showLogoOnDocs', label: 'Show logo on printed documents', type: 'checkbox', default: true, col2: true },
      { key: 'docFooter', label: 'Document footer', type: 'textarea', col2: true, default: 'Thank you for choosing Epal Travels & Consultancy. E&OE.' }
    ], 'Document settings saved');
    // sample preview
    page.appendChild(el('div.card', null, [ el('div.card-head', null, [ el('h3', { html: ui.icon('eye') + ' Sample Numbering' }) ]),
      el('div.card-body', null, [ el('div.data-list', null, [
        drow('Next invoice', (c.invoicePrefix || 'TV-INV') + '-' + (c.nextNumber || 1001)),
        drow('Next voucher', (c.voucherPrefix || 'TV-PV') + '-' + (c.nextNumber || 1001)),
        drow('Next statement', (c.statementPrefix || 'TV-STMT') + '-' + (c.nextNumber || 1001))
      ]) ]) ]));
  }

  /* ======================================================= NOTIFICATIONS */
  function notificationsTab(page) {
    formCard(page, 'Notifications & Alerts', 'bell-fill', [
      { type: 'section', label: 'Channel' },
      { key: 'notifyChannel', label: 'Primary channel', type: 'select', options: ['In-app', 'Email', 'WhatsApp', 'SMS'], default: 'In-app' },
      { type: 'section', label: 'Which alerts fire' },
      { key: 'alertPassport', label: 'Passport expiry (≤6 months)', type: 'checkbox', default: true, col2: true },
      { key: 'alertTTL', label: 'Ticketing deadlines (TTL ≤3 days)', type: 'checkbox', default: true, col2: true },
      { key: 'alertLowWallet', label: 'Low portal wallet (< ৳20,000)', type: 'checkbox', default: true, col2: true },
      { key: 'alertOverdueAR', label: 'Overdue receivables (30+ days)', type: 'checkbox', default: true, col2: true },
      { key: 'alertContract', label: 'Contract expiry (≤30 days)', type: 'checkbox', default: true, col2: true }
    ], 'Notification preferences saved');
    page.appendChild(el('div.build-banner', null, [ ui.frag(ui.icon('robot')),
      el('div', { html: 'These preferences steer the bots in <strong>Travels ▸ Automation</strong> — open it to run or pause them individually.' }) ]));
  }

  /* ======================================================= DATA & ACCESS */
  function dataTab(page) {
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Access & Control' }) ]),
      el('div.card-body', null, [ el('div.flex.gap-2.flex-wrap', null, [
        el('a.btn.btn-ghost', { href: '#/group/module-manager', html: ui.icon('toggles2') + ' Module Control' }),
        el('a.btn.btn-ghost', { href: '#/group/employees/directory', html: ui.icon('person-badge') + ' Group Workforce' }),
        el('a.btn.btn-ghost', { href: '#/travels/automation', html: ui.icon('robot') + ' Automation' }),
        el('a.btn.btn-ghost', { href: '#/group/activity-log', html: ui.icon('shield-lock') + ' Activity Log' })
      ]) ])
    ]));
    // Appearance — Background Animation (3D airport / 2D airfield / none +
    // per-scene opacity sliders). Shared card, applies live via EPAL.atmos.
    if (EPAL.atmosSettingsCard) page.appendChild(EPAL.atmosSettingsCard());
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('download') + ' Backup' }) ]),
      el('div.card-body', null, [
        el('p.text-mute.sm.mb-2', { text: 'Export this concern’s settings as JSON, or restore the defaults.' }),
        el('div.flex.gap-2.flex-wrap', null, [
          el('button.btn.btn-outline', { html: ui.icon('filetype-json') + ' Export Settings', onclick: exportSettings }),
          el('button.btn.btn-ghost', { html: ui.icon('arrow-counterclockwise') + ' Restore Defaults', onclick: restoreDefaults })
        ])
      ])
    ]));
    page.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('exclamation-triangle') + ' Danger Zone' }) ]),
      el('div.card-body', null, [
        el('p.text-mute.sm.mb-2', { text: 'Reloading the demo dataset re-seeds ALL companies (irreversible for unsaved edits).' }),
        el('button.btn.btn-outline', { style: { color: 'var(--bad)', borderColor: 'var(--bad)' }, html: ui.icon('arrow-repeat') + ' Reload Demo Data', onclick: reloadDemo })
      ])
    ]));
  }
  function exportSettings() {
    var blob = new Blob([JSON.stringify(cur(), null, 2)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'travels-settings.json' });
    document.body.appendChild(a); a.click(); a.remove(); ui.toast('Settings exported', 'success');
  }
  function restoreDefaults() {
    ui.confirm({ title: 'Restore default settings?', text: 'Clears your saved Travels settings and reverts to defaults.', confirmLabel: 'Restore' })
      .then(function (ok) { if (!ok) return; EPAL.store.set(KEY, {}); ui.toast('Defaults restored', 'success'); EPAL.router.render(); });
  }
  function reloadDemo() {
    ui.confirm({ title: 'Reload demo data?', text: 'Re-seeds the entire demo dataset for all companies. This cannot be undone.', danger: true, confirmLabel: 'Reload' })
      .then(function (ok) { if (!ok) return; if (EPAL.db && EPAL.db.reset) { EPAL.db.reset(); ui.toast('Demo data reloaded', 'success'); EPAL.router.render(); } else { ui.toast('Reset unavailable', 'error'); } });
  }

  function drow(k, v) { return el('div.data-row', null, [ el('div.text-mute.sm.flex-1', { text: k }), el('div.strong', { text: v == null || v === '' ? '—' : String(v) }) ]); }

})(window.EPAL = window.EPAL || {});
