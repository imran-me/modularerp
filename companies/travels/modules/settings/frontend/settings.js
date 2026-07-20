/* ============================================================================
 * TRAVELS · SETTINGS · LOGIC
 * ----------------------------------------------------------------------------
 * Behaviour only — markup lives in frontend/template.html and is handed to this
 * file (by tools/build/build-module.mjs) as the string TEMPLATE_HTML. This file
 * is NOT an IIFE and has no 'use strict' of its own: the build wraps it in
 * `(function(){ 'use strict'; var TEMPLATE_HTML=…; <this file> })()`.
 *
 * TRAVELS-specific configuration behind a pill-tab (profile / financial /
 * documents / notifications / data). ONE registered view branches on ctx.subId;
 * because the router prefers a specific view over the shared "star-slash-settings"
 * wildcard, this supersedes the generic screen WITHOUT touching any other
 * company — and it PRESERVES the store key (`settings.travels`) and every field
 * the shared form used, so nothing downstream regresses. Each tab saves
 * independently via EPAL.store.patch (shallow merge) so tabs never clobber.
 *
 * ==> LARAVEL: a company_settings JSON column / settings table + a
 *     SettingsController with a tab per section; policies restrict to admins.
 * ========================================================================== */

var EPAL = window.EPAL, ui = EPAL.ui, el = ui.el, S = EPAL.store;

/* ---- template plumbing: clone a fragment, address its fill-slots ---------- */
var TPL = document.createElement('div');
TPL.innerHTML = TEMPLATE_HTML;
function frag(name) {
  var t = TPL.querySelector('template[data-tpl="' + name + '"]');
  return t.content.firstElementChild.cloneNode(true);
}
function slot(root, name) { return root.querySelector('[data-slot="' + name + '"]'); }

/* ---- constants (unchanged from the legacy view) --------------------------- */
var KEY = 'settings.travels';
var CO = { name: 'Epal Travels & Consultancy', tagline: 'Air · Visa · Consultancy' };

function cur() { return S.get(KEY, {}) || {}; }
function save(values, msg) { S.patch(KEY, values); ui.toast(msg || 'Settings saved', 'success'); }

/* one data-row (label + value), the sample-numbering helper ------------------*/
function drow(k, v) {
  var r = frag('drow');
  slot(r, 'k').textContent = k;
  slot(r, 'v').textContent = (v == null || v === '') ? '—' : String(v);
  return r;
}

/* the identity preview strip — avatar (dynamic bg-image kept inline) + badges */
function identityStrip() {
  var c = cur();
  var card = frag('identity');
  var avatar = c.logo
    ? ui.frag('<span class="avatar" style="width:46px;height:46px;background-image:url(' + c.logo + ');background-size:cover;background-position:center"></span>')
    : ui.frag('<span class="notif-ico notif-info">' + ui.icon('airplane-fill') + '</span>');
  slot(card, 'avatar').replaceWith(avatar);
  slot(card, 'name').textContent = c.displayName || CO.name;
  slot(card, 'tagline').textContent = (c.tagline || CO.tagline) + (c.iataNo ? ' · IATA ' + c.iataNo : '');
  slot(card, 'currency').textContent = (c.currency || 'BDT');
  slot(card, 'fy').textContent = 'FY ' + (c.fiscalNote || 'Jul–Jun');
  return card;
}

EPAL.view('travels/settings', {
  render: function (ctx) {
    var sub = ctx.subId || 'profile';
    if (['profile', 'financial', 'documents', 'notifications', 'data'].indexOf(sub) < 0) sub = 'profile';
    var page = frag('page');
    var titles = { profile: 'Settings', financial: 'Financial', documents: 'Documents', notifications: 'Notifications', data: 'Data & Access' };
    page.appendChild(EPAL.pageHead({
      eyebrow: sub === 'profile' ? 'Epal Travels' : 'Travels › Settings', icon: 'gear-fill', title: titles[sub],
      sub: 'Travels-specific configuration. Module visibility lives in Group ▸ Module Control.',
      actions: [ el('a.btn.btn-ghost', { href: '#/group/module-manager', html: ui.icon('toggles2') + ' Module Control' }) ]
    }));

    // identity preview strip
    page.appendChild(identityStrip());

    // SECTION NAV — the house full-bleed underline band (owner grammar 2026-07-15)
    var pills = frag('nav');
    [['profile', 'Profile'], ['financial', 'Financial'], ['documents', 'Documents'], ['notifications', 'Notifications'], ['data', 'Data & Access']].forEach(function (p) {
      var btn = frag('nav-btn');
      if (sub === p[0]) btn.classList.add('active');
      btn.textContent = p[1];
      btn.addEventListener('click', function () { EPAL.router.navigate('travels/settings' + (p[0] === 'profile' ? '' : '/' + p[0])); });
      pills.appendChild(btn);
    });
    page.appendChild(pills);

    ({ profile: profileTab, financial: financialTab, documents: documentsTab, notifications: notificationsTab, data: dataTab }[sub])(page);
    ctx.mount.appendChild(page);
  }
});

/* ---- a form card with its own Save button --------------------------------*/
function formCard(page, title, icon, fields, msg) {
  var form = EPAL.form(fields, cur());
  var card = frag('form-card');
  slot(card, 'title').innerHTML = ui.icon(icon) + ' ' + title;
  slot(card, 'form').replaceWith(form.el);
  slot(card, 'save').addEventListener('click', function () {
    if (form.validate && !form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return; }
    save(form.values(), msg); EPAL.router.render();
  });
  page.appendChild(card);
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
  var card = frag('sample-card');
  var rows = slot(card, 'rows');
  rows.appendChild(drow('Next invoice', (c.invoicePrefix || 'TV-INV') + '-' + (c.nextNumber || 1001)));
  rows.appendChild(drow('Next voucher', (c.voucherPrefix || 'TV-PV') + '-' + (c.nextNumber || 1001)));
  rows.appendChild(drow('Next statement', (c.statementPrefix || 'TV-STMT') + '-' + (c.nextNumber || 1001)));
  page.appendChild(card);
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
  page.appendChild(frag('build-banner-automation'));
}

/* ======================================================= DATA & ACCESS */
function dataTab(page) {
  page.appendChild(frag('access-card'));
  // Appearance — Background Animation (shared card, applies live via EPAL.atmos)
  if (EPAL.atmosSettingsCard) page.appendChild(EPAL.atmosSettingsCard());
  var backup = frag('backup-card');
  slot(backup, 'export').addEventListener('click', exportSettings);
  slot(backup, 'restore').addEventListener('click', restoreDefaults);
  page.appendChild(backup);
  var danger = frag('danger-card');
  slot(danger, 'reload').addEventListener('click', reloadDemo);
  page.appendChild(danger);
}
function exportSettings() {
  var blob = new Blob([JSON.stringify(cur(), null, 2)], { type: 'application/json' });
  var a = el('a', { href: URL.createObjectURL(blob), download: 'travels-settings.json' });
  document.body.appendChild(a); a.click(); a.remove(); ui.toast('Settings exported', 'success');
}
function restoreDefaults() {
  ui.confirm({ title: 'Restore default settings?', text: 'Clears your saved Travels settings and reverts to defaults.', confirmLabel: 'Restore' })
    .then(function (ok) { if (!ok) return; S.set(KEY, {}); ui.toast('Defaults restored', 'success'); EPAL.router.render(); });
}
function reloadDemo() {
  ui.confirm({ title: 'Reload demo data?', text: 'Re-seeds the entire demo dataset for all companies. This cannot be undone.', danger: true, confirmLabel: 'Reload' })
    .then(function (ok) { if (!ok) return; if (EPAL.db && EPAL.db.reset) { EPAL.db.reset(); ui.toast('Demo data reloaded', 'success'); EPAL.router.render(); } else { ui.toast('Reset unavailable', 'error'); } });
}
