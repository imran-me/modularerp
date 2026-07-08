/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/marketing.js
 * ----------------------------------------------------------------------------
 * MARKETING & MESSAGING — Travels' omni-channel "live comms channel". ONE
 * registered view (travels/marketing) drives four workspaces from local pill
 * state (the module carries no config sub-routes; ctx.subId is honoured if the
 * router ever supplies one):
 *
 *   campaigns (default) → campaign blaster: KPIs (sent / delivery / open) +
 *                         filterable table + CSV + New Campaign + a real
 *                         "Send now" that counts recipients from live stores
 *                         (customers / leads / visa apps / ticket buyers),
 *                         marks the campaign Sent with believable delivered /
 *                         opened numbers, appends to the tv_messages send-log
 *                         and fires a success notification.
 *   templates          → message-template library (CRUD) with a live preview
 *                         that substitutes sample values into {{name}} /
 *                         {{destination}} / {{fare}} placeholders.
 *   bot                → an interactive WhatsApp booking-bot simulator. Quick
 *                         replies + free text; the bot answers from REAL data
 *                         (fares from air tickets / airlines, visa load from
 *                         visa apps) and can spin up a draft booking into
 *                         tv_bot_bookings. Transcript persists in tv_bot_chat.
 *   sendlog            → delivery ledger of every tv_messages row.
 *
 * All new stores (tv_campaigns / tv_templates / tv_messages / tv_bot_bookings /
 * tv_bot_chat) self-seed idempotently via EPAL.registerEngine. Persistence is
 * only ever through EPAL.store / EPAL.db.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, S = EPAL.store;

  var CHANNELS = ['WhatsApp', 'SMS', 'Email'];
  var AUDIENCES = ['All Customers', 'Leads', 'Visa Applicants', 'Ticket Buyers', 'Custom'];
  var CATEGORIES = ['Promotional', 'Reminder', 'Transactional', 'Greeting'];

  // Sample values used everywhere a template is previewed.
  var SAMPLE = { name: 'Rahim Uddin', destination: 'Dubai', agency: 'Epal Travels',
    date: '18 Aug 2026', fare: '৳58,500' };

  // Typical published round-trip fares (BDT) ex-DAC — the bot's fallback book of
  // knowledge; live issued fares (from airTickets) override the low end when present.
  var FARES = {
    DXB: { city: 'Dubai',          airlines: [['Emirates', 62000], ['flydubai', 54500], ['US-Bangla', 49500]] },
    DOH: { city: 'Doha',           airlines: [['Qatar Airways', 58000], ['Biman Bangladesh', 52000]] },
    JED: { city: 'Jeddah',         airlines: [['Saudia', 78000], ['Biman Bangladesh', 72500]] },
    SIN: { city: 'Singapore',      airlines: [['Singapore Airlines', 48000], ['Biman Bangladesh', 41500]] },
    KUL: { city: 'Kuala Lumpur',   airlines: [['Malaysia Airlines', 36000], ['AirAsia', 28500], ['Biman Bangladesh', 31000]] },
    IST: { city: 'Istanbul',       airlines: [['Turkish Airlines', 92000], ['Biman Bangladesh', 84500]] },
    LHR: { city: 'London',         airlines: [['British Airways', 108000], ['Biman Bangladesh', 95000]] },
    KWI: { city: 'Kuwait',         airlines: [['Kuwait Airways', 71000], ['Jazeera Airways', 66500]] },
    CXB: { city: "Cox's Bazar",    airlines: [['US-Bangla', 8500], ['Novoair', 9200]] }
  };

  /* ==========================================================================
   * SEED — all five stores, idempotent. Runs during db.seed + on db.reset.
   * ========================================================================*/
  EPAL.registerEngine({ name: 'travels-marketing-seed', seed: function () {
    S.seedOnce('tv_templates', seedTemplates());
    S.seedOnce('tv_campaigns', seedCampaigns());
    S.seedOnce('tv_messages', seedMessages());
    S.seedOnce('tv_bot_bookings', seedBookings());
    S.seedOnce('tv_bot_chat', seedChat());
  }});

  function seedTemplates() {
    var now = Date.now();
    var t = [
      ['Eid Umrah Offer', 'WhatsApp', 'Promotional',
        'As-salamu alaikum {{name}}! Epal Travels Eid Umrah package to {{destination}} from ৳1,65,000 per person — 12 nights, 4-star hotels near the Haram. Reply YES to reserve your seat. — {{agency}}'],
      ['Fare Drop Alert', 'SMS', 'Promotional',
        'Epal Travels: {{destination}} return fare just dropped to {{fare}}! Limited seats. Book today — call 09612-345678.'],
      ['Visa Document Reminder', 'WhatsApp', 'Reminder',
        'Hi {{name}}, your {{destination}} visa file is pending 2 documents (bank statement + hotel booking). Please submit by {{date}} to avoid delay. — {{agency}}'],
      ['Booking Confirmation', 'Email', 'Transactional',
        'Dear {{name}}, your booking to {{destination}} is confirmed. Your e-ticket is attached. Total fare: {{fare}}. Thank you for flying with {{agency}}.'],
      ['Eid Mubarak Greeting', 'WhatsApp', 'Greeting',
        'Eid Mubarak {{name}}! May your journeys ahead be blessed and safe. Warm wishes from all of us at {{agency}}.'],
      ['Payment Due Reminder', 'SMS', 'Reminder',
        'Dear {{name}}, a balance remains on your {{destination}} booking. Kindly clear it by {{date}} to secure your seats. — {{agency}}']
    ];
    return t.map(function (r, i) {
      return { id: 'TPL-' + (401 + i), name: r[0], channel: r[1], category: r[2], body: r[3],
        created: now - (i * 86400000) };
    });
  }

  function seedCampaigns() {
    var now = Date.now(), day = 86400000;
    var rows = [
      ['Eid Umrah Offer 2026',        'WhatsApp', 'Eid Umrah Offer',        'Custom',           'Sent',      1840, 1802, 1120, '2026-06-20'],
      ['Dhaka-Dubai Fare Drop',       'SMS',      'Fare Drop Alert',        'All Customers',    'Sent',      3200, 3156,  402, '2026-06-24'],
      ['Visa Document Reminder Batch','WhatsApp', 'Visa Document Reminder', 'Visa Applicants',  'Sent',       240,  236,  198, '2026-06-28'],
      ['Eid Mubarak Greeting',        'WhatsApp', 'Eid Mubarak Greeting',   'All Customers',    'Sent',      2100, 2058, 1444, '2026-06-16'],
      ["Cox's Bazar Weekend Getaway", 'SMS',      'Fare Drop Alert',        'Leads',            'Sent',       890,  872,   96, '2026-06-30'],
      ['Singapore Airlines Promo',    'Email',    'Booking Confirmation',   'All Customers',    'Scheduled', 2600,    0,    0, '2026-07-12'],
      ['Umrah Early Bird 2027',       'Email',    'Eid Umrah Offer',        'Custom',           'Draft',        0,    0,    0, ''],
      ['Kuala Lumpur Family Package', 'WhatsApp', 'Fare Drop Alert',        'Ticket Buyers',    'Draft',        0,    0,    0, '']
    ];
    return rows.map(function (r, i) {
      return { id: 'CMP-' + (901 + i), name: r[0], channel: r[1], template: r[2], audience: r[3],
        status: r[4], recipients: r[5], sent: r[6] > 0 ? r[5] : (r[4] === 'Sent' ? r[5] : 0),
        delivered: r[6], opened: r[7], scheduledFor: r[8], created: now - ((i + 2) * day) };
    });
  }

  function seedMessages() {
    var now = Date.now(), hr = 3600000;
    var rows = [
      ['CMP-901', 'Eid Umrah Offer 2026',         'WhatsApp', 'Custom',          1840, 1802, 1120, 8],
      ['CMP-902', 'Dhaka-Dubai Fare Drop',        'SMS',      'All Customers',   3200, 3156,  402, 20],
      ['CMP-903', 'Visa Document Reminder Batch', 'WhatsApp', 'Visa Applicants',  240,  236,  198, 34],
      ['CMP-904', 'Eid Mubarak Greeting',         'WhatsApp', 'All Customers',   2100, 2058, 1444, 60],
      ['CMP-905', "Cox's Bazar Weekend Getaway",  'SMS',      'Leads',            890,  872,   96, 78]
    ];
    return rows.map(function (r, i) {
      return { id: 'MSG-' + (7001 + i), campaignId: r[0], campaignName: r[1], channel: r[2],
        audience: r[3], recipients: r[4], delivered: r[5], opened: r[6], status: 'Delivered',
        at: now - (r[7] * hr) };
    });
  }

  function seedBookings() {
    var now = Date.now(), hr = 3600000;
    return [
      { id: 'BB-6601', kind: 'Ticket', route: 'DAC → DXB', city: 'Dubai', airline: 'flydubai',
        fare: 54500, passenger: 'WhatsApp Guest', query: 'Dubai fare?', status: 'Draft', created: now - (5 * hr) },
      { id: 'BB-6602', kind: 'Umrah', route: 'DAC → JED', city: 'Jeddah', airline: 'Biman Bangladesh',
        fare: 165000, passenger: 'WhatsApp Guest', query: 'Umrah package?', status: 'Draft', created: now - (28 * hr) }
    ];
  }

  function seedChat() {
    return [
      { id: 'BM-1', from: 'bot', at: Date.now() - 90000,
        text: 'Assalamu alaikum! I am the Epal Travels booking assistant. Ask me about fares, Umrah packages or your visa — or tap a quick reply below.' }
    ];
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  var TABS = [
    ['campaigns', 'Campaigns', 'megaphone-fill'],
    ['templates', 'Templates', 'file-earmark-text-fill'],
    ['bot',       'WhatsApp Bot', 'whatsapp'],
    ['sendlog',   'Send Log', 'send-check-fill']
  ];

  EPAL.view('travels/marketing', {
    render: function (ctx) {
      var page = el('div.page');
      var state = { tab: normalizeTab(ctx.subId) };

      page.appendChild(EPAL.pageHead({
        eyebrow: 'Epal Travels', icon: 'broadcast-pin', title: 'Marketing & Messaging',
        sub: 'Omni-channel campaigns, message templates and a live WhatsApp booking bot — the concern’s comms channel.'
      }));

      var pills = el('div.pill-tab.mb-3');
      var host = el('div');

      function drawPills() {
        pills.innerHTML = '';
        TABS.forEach(function (t) {
          pills.appendChild(el('button' + (state.tab === t[0] ? '.active' : ''),
            { html: ui.icon(t[2]) + ' ' + t[1], onclick: function () { setTab(t[0]); } }));
        });
      }
      function setTab(t) {
        state.tab = t; drawPills();
        host.innerHTML = '';
        RENDER[t](host);
      }

      drawPills();
      page.appendChild(pills);
      page.appendChild(host);
      ctx.mount.appendChild(page);
      setTab(state.tab);
    }
  });

  function normalizeTab(sub) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === sub) return sub;
    return 'campaigns';
  }

  var RENDER = {
    campaigns: renderCampaigns,
    templates: renderTemplates,
    bot: renderBot,
    sendlog: renderSendLog
  };

  /* ======================================================= CAMPAIGNS */
  function renderCampaigns(host) {
    function reload() { host.innerHTML = ''; renderCampaigns(host); }

    var list = campaigns();
    var totalSent = 0, totalDelivered = 0, totalOpened = 0;
    list.forEach(function (c) { totalSent += c.sent || 0; totalDelivered += c.delivered || 0; totalOpened += c.opened || 0; });
    var delivRate = totalSent ? Math.round(totalDelivered / totalSent * 100) : 0;
    var openRate = totalDelivered ? Math.round(totalOpened / totalDelivered * 100) : 0;

    host.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Campaigns', list.length, 'megaphone'),
      kpi('Messages Sent', ui.num ? ui.num(totalSent) : String(totalSent), 'send'),
      kpi('Delivery Rate', delivRate + '%', 'check2-circle'),
      kpi('Open Rate', openRate + '%', 'envelope-open')
    ]));

    host.appendChild(el('div.flex.justify-between.items-center.my-3', null, [
      el('div.section-label', { text: 'Campaigns', style: { margin: '0' } }),
      el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Campaign',
        onclick: function () { newCampaign(reload); } })
    ]));

    var t = EPAL.table({
      columns: [
        { key: 'name', label: 'Campaign', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'channel', label: 'Channel', badge: { WhatsApp: 'good', SMS: 'info', Email: 'accent' } },
        { key: 'audience', label: 'Audience' },
        { key: 'recipients', label: 'Recipients', num: true, render: function (r) { return num(r.recipients); } },
        { key: 'delivered', label: 'Delivered', num: true, render: function (r) { return num(r.delivered); } },
        { key: 'opened', label: 'Opened', num: true, render: function (r) { return num(r.opened); } },
        { key: 'openRate', label: 'Open %', num: true, sort: false,
          render: function (r) { var o = r.delivered ? Math.round(r.opened / r.delivered * 100) : 0; return '<span class="mono">' + o + '%</span>'; } },
        { key: 'status', label: 'Status', badge: { Draft: 'warn', Scheduled: 'info', Sent: 'good' } },
        { key: 'scheduledFor', label: 'Schedule', render: function (r) { return r.scheduledFor ? ui.date(r.scheduledFor) : '<span class="text-mute">—</span>'; } }
      ],
      rows: list,
      searchKeys: ['name', 'channel', 'audience', 'template', 'status'],
      searchPlaceholder: 'Search campaigns…',
      filters: [{ key: 'channel', label: 'Channel' }, { key: 'status', label: 'Status' }],
      exportName: 'travels-campaigns.csv',
      onRow: function (r) { campaignDetail(r, reload); },
      actions: [
        { icon: 'send-fill', title: 'Send now', onClick: function (r) { sendNow(r, reload); } }
      ],
      empty: { icon: 'megaphone', title: 'No campaigns yet', hint: 'Create your first campaign to start reaching customers.' }
    });
    host.appendChild(t.el); t.refresh();
  }

  function newCampaign(done) {
    var tplPairs = templates().map(function (t) { return [t.name, t.name + ' · ' + t.channel]; });
    if (!tplPairs.length) tplPairs = [['', '— No templates —']];
    EPAL.formModal({
      title: 'New Campaign', icon: 'megaphone', saveLabel: 'Create Campaign',
      fields: [
        { key: 'name', label: 'Campaign name', type: 'text', required: true, col2: true, placeholder: 'e.g. Eid Umrah Offer 2027' },
        { key: 'channel', label: 'Channel', type: 'select', options: CHANNELS, required: true },
        { key: 'audience', label: 'Audience', type: 'select', options: AUDIENCES, required: true },
        { key: 'template', label: 'Message template', type: 'select', options: tplPairs },
        { key: 'scheduledFor', label: 'Schedule for (optional)', type: 'date',
          hint: 'Leave empty to keep as Draft; set a date to schedule.' }
      ],
      record: {},
      onSave: function (v) {
        var reach = audienceCount(v.audience);
        var c = {
          id: ui.uid('CMP'), name: (v.name || '').trim(), channel: v.channel, audience: v.audience,
          template: v.template || '', status: v.scheduledFor ? 'Scheduled' : 'Draft',
          recipients: reach, sent: 0, delivered: 0, opened: 0,
          scheduledFor: v.scheduledFor || '', created: Date.now()
        };
        S.upsert('tv_campaigns', c);
        db.notify({ level: 'info', title: 'Campaign Created', text: c.name + ' · ~' + num(reach) + ' recipients',
          companyId: 'travels', icon: 'megaphone-fill' });
        ui.toast('Campaign created · reaches ' + num(reach) + ' recipients', 'success');
        done && done();
      }
    });
  }

  // Simulate a send: count recipients from live stores, mark Sent with believable
  // delivered/opened, append to the send-log, notify.
  function sendNow(c, done) {
    if (c.status === 'Sent') { ui.toast('This campaign has already been sent', 'info'); return; }
    ui.confirm({ title: 'Send "' + c.name + '" now?', icon: 'send',
      text: 'This will blast the campaign over ' + c.channel + ' to the "' + c.audience + '" audience.',
      confirmLabel: 'Send now' }).then(function (ok) {
      if (!ok) return;
      var reach = audienceCount(c.audience) || c.recipients || 0;
      if (reach < 1) reach = 50;
      var delivered = Math.round(reach * (0.90 + Math.random() * 0.08));
      var openBase = c.channel === 'Email' ? (0.28 + Math.random() * 0.28)
        : c.channel === 'SMS' ? (0.08 + Math.random() * 0.10)
        : (0.52 + Math.random() * 0.30);
      var opened = Math.round(delivered * openBase);

      c.recipients = reach; c.sent = reach; c.delivered = delivered; c.opened = opened;
      c.status = 'Sent'; c.scheduledFor = c.scheduledFor || today();
      S.upsert('tv_campaigns', c);

      S.upsert('tv_messages', {
        id: ui.uid('MSG'), campaignId: c.id, campaignName: c.name, channel: c.channel,
        audience: c.audience, recipients: reach, delivered: delivered, opened: opened,
        status: 'Delivered', at: Date.now()
      });

      db.notify({ level: 'success', title: 'Campaign Sent', text: c.name + ' · ' + num(reach) + ' recipients',
        companyId: 'travels', icon: 'send-check-fill' });
      ui.toast(c.name + ' sent · ' + num(delivered) + ' delivered, ' + num(opened) + ' opened', 'success');
      done && done();
    });
  }

  function audienceCount(aud) {
    if (aud === 'All Customers') return db.customers().length;
    if (aud === 'Leads') return db.leads().length;
    if (aud === 'Visa Applicants') return db.visaApps().length;
    if (aud === 'Ticket Buyers') {
      var seen = {}, n = 0;
      db.airTickets().forEach(function (t) { var k = (t.passenger || '').toLowerCase(); if (k && !seen[k]) { seen[k] = 1; n++; } });
      return n;
    }
    return 250; // Custom list — a representative uploaded segment
  }

  function campaignDetail(c, done) {
    var body = el('div');
    var m = ui.modal({ title: c.name, icon: 'megaphone', size: 'lg', body: body, footer: false });
    function redraw() {
      body.innerHTML = '';
      body.appendChild(el('div.flex.gap-1.flex-wrap.mb-3', null, [
        badge(c.channel, c.channel === 'WhatsApp' ? 'good' : c.channel === 'SMS' ? 'info' : 'accent'),
        badge(c.status, c.status === 'Sent' ? 'good' : c.status === 'Scheduled' ? 'info' : 'warn'),
        el('span.badge', { text: c.audience }), el('span.badge', { text: c.id })
      ]));
      body.appendChild(el('div.form-grid', null, [
        kv('Template', c.template || '—'),
        kv('Scheduled for', c.scheduledFor ? ui.date(c.scheduledFor) : '—'),
        kv('Created', c.created ? ui.date(c.created) : '—'),
        kv('Recipients', num(c.recipients))
      ]));

      body.appendChild(el('div.section-label', { text: 'Delivery Funnel' }));
      var deliv = c.sent ? Math.round(c.delivered / c.sent * 100) : 0;
      var open = c.delivered ? Math.round(c.opened / c.delivered * 100) : 0;
      body.appendChild(el('div', null, [
        funnelRow('Recipients', c.recipients, 100, '#2f6bff'),
        funnelRow('Delivered', c.delivered, c.recipients ? Math.round(c.delivered / c.recipients * 100) : 0, '#23c17e'),
        funnelRow('Opened', c.opened, c.recipients ? Math.round(c.opened / c.recipients * 100) : 0, '#1A43BF')
      ]));
      body.appendChild(el('div.flex.gap-3.mt-2', null, [
        el('div.text-mute.sm', { html: 'Delivery rate <strong class="text-good">' + deliv + '%</strong>' }),
        el('div.text-mute.sm', { html: 'Open rate <strong class="text-good">' + open + '%</strong>' })
      ]));

      // preview of the chosen template
      var tpl = templateByName(c.template);
      if (tpl) {
        body.appendChild(el('div.section-label', { text: 'Message Preview' }));
        body.appendChild(chatBubble(fillTemplate(tpl.body, SAMPLE), 'out'));
      }

      body.appendChild(el('div.divider'));
      body.appendChild(el('div.flex.gap-1.flex-wrap', null, [
        c.status !== 'Sent' ? el('button.btn.btn-sm.btn-primary', { html: ui.icon('send-fill') + ' Send now',
          onclick: function () { m.close(); sendNow(c, done); } }) : null,
        el('button.btn.btn-sm.btn-outline', { html: ui.icon('files') + ' Duplicate',
          onclick: function () {
            var copy = clone(c); copy.id = ui.uid('CMP'); copy.name = c.name + ' (copy)';
            copy.status = 'Draft'; copy.sent = 0; copy.delivered = 0; copy.opened = 0; copy.created = Date.now();
            S.upsert('tv_campaigns', copy); ui.toast('Campaign duplicated', 'success'); m.close(); done && done();
          } }),
        el('button.btn.btn-sm.btn-danger', { html: ui.icon('trash') + ' Delete',
          onclick: function () {
            ui.confirm({ title: 'Delete campaign?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
              if (ok) { S.removeFrom('tv_campaigns', c.id); m.close(); ui.toast('Campaign deleted', 'success'); done && done(); }
            });
          } })
      ]));
    }
    redraw();
  }

  function funnelRow(label, value, pct, color) {
    pct = Math.max(2, Math.min(100, pct || 0));
    return el('div', { style: { margin: '6px 0' } }, [
      el('div.flex.justify-between.sm', null, [ el('span.text-mute', { text: label }), el('span.mono', { text: num(value) }) ]),
      el('div', { style: { height: '8px', borderRadius: '6px', background: 'var(--surface-2)', overflow: 'hidden', marginTop: '3px' } }, [
        el('div', { style: { height: '100%', width: pct + '%', background: color, borderRadius: '6px' } })
      ])
    ]);
  }

  /* ======================================================= TEMPLATES */
  function renderTemplates(host) {
    function reload() { host.innerHTML = ''; renderTemplates(host); }
    var list = templates();

    host.appendChild(el('div.flex.justify-between.items-center.my-3', null, [
      el('div.section-label', { text: 'Message Templates', style: { margin: '0' } }),
      el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Template',
        onclick: function () { editTemplate(null, reload); } })
    ]));

    if (!list.length) {
      host.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('file-earmark-text')),
        el('h3', { text: 'No templates yet' }),
        el('p.text-muted', { text: 'Create reusable WhatsApp / SMS / Email templates with {{name}} and {{destination}} placeholders.' }) ]));
      return;
    }

    var selected = list[0];
    var preview = el('div');

    var two = el('div.two-col');
    var listCol = el('div');
    listCol.appendChild(el('div.section-label', { text: 'Library' }));
    var listWrap = el('div.stagger');
    list.forEach(function (t) {
      listWrap.appendChild(el('a.scaffold-card', {
        href: 'javascript:void(0)',
        onclick: function () { selected = t; drawPreview(); highlight(); }
      }, [
        el('div.scaffold-ico', { html: '<i class="bi bi-' + channelIcon(t.channel) + '"></i>' }),
        el('div', null, [
          el('h4', { text: t.name }),
          el('p', { html: '<span class="badge badge-' + channelTone(t.channel) + '">' + t.channel + '</span> <span class="badge">' + ui.escapeHtml(t.category || '') + '</span>' })
        ])
      ]));
    });
    listCol.appendChild(listWrap);

    function highlight() {
      var cards = listWrap.querySelectorAll('.scaffold-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].style.borderColor = list[i] === selected ? 'var(--border-accent)' : '';
      }
    }

    var previewCol = el('div');
    previewCol.appendChild(el('div.section-label', { text: 'Live Preview' }));
    previewCol.appendChild(preview);

    function drawPreview() {
      preview.innerHTML = '';
      var card = el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon(channelIcon(selected.channel)) + ' ' + ui.escapeHtml(selected.name) }) ]),
        el('div.card-body', null, [
          el('div.flex.gap-1.flex-wrap.mb-3', null, [
            badge(selected.channel, channelTone(selected.channel)),
            el('span.badge', { text: selected.category || '' })
          ]),
          el('div.text-mute.sm.mb-2', { text: 'Rendered with sample values (' + SAMPLE.name + ' · ' + SAMPLE.destination + '):' }),
          chatBubble(fillTemplate(selected.body, SAMPLE), 'out'),
          el('div.section-label', { text: 'Raw Template' }),
          el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12.5px', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '12px', borderRadius: 'var(--r-md)' }, text: selected.body }),
          el('div.flex.gap-1.mt-3', null, [
            el('button.btn.btn-sm.btn-outline', { html: ui.icon('pencil') + ' Edit', onclick: function () { editTemplate(selected, reload); } }),
            el('button.btn.btn-sm.btn-danger', { html: ui.icon('trash') + ' Delete', onclick: function () {
              ui.confirm({ title: 'Delete template?', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
                if (ok) { S.removeFrom('tv_templates', selected.id); ui.toast('Template deleted', 'success'); reload(); }
              });
            } })
          ])
        ])
      ]);
      preview.appendChild(card);
    }

    two.appendChild(listCol);
    two.appendChild(previewCol);
    host.appendChild(two);
    drawPreview(); highlight();
  }

  // Custom edit modal with a live preview that updates as you type.
  function editTemplate(t, done) {
    var isNew = !t;
    t = t || { id: ui.uid('TPL'), name: '', channel: 'WhatsApp', category: 'Promotional', body: '' };
    var body = el('div');

    var previewBubble = el('div');
    var fields = el('div.form-grid', null, [
      inp('Template name', 'name', t.name, 'col-2'),
      sel('Channel', 'channel', t.channel, CHANNELS),
      sel('Category', 'category', t.category, CATEGORIES),
      el('div.field.col-2', null, [
        el('label', { html: 'Message body <span class="req">*</span>' }),
        el('textarea.input', { id: 'f-body', rows: 5, placeholder: 'Use {{name}}, {{destination}}, {{fare}}, {{date}}, {{agency}} placeholders…' })
      ])
    ]);
    body.appendChild(fields);
    var ta = fields.querySelector('#f-body'); ta.value = t.body || '';

    body.appendChild(el('div.section-label', { text: 'Live Preview' }));
    body.appendChild(previewBubble);

    function drawPrev() {
      previewBubble.innerHTML = '';
      previewBubble.appendChild(chatBubble(fillTemplate(ta.value || '(empty message)', SAMPLE), 'out'));
    }
    ta.addEventListener('input', drawPrev);
    drawPrev();

    ui.modal({ title: isNew ? 'New Template' : 'Edit Template', icon: 'file-earmark-text', size: 'lg', body: body,
      actions: [ { label: 'Cancel', variant: 'ghost' }, { label: isNew ? 'Create' : 'Save', variant: 'primary', onClick: function (box) {
        var g = function (id) { return (box.querySelector('#f-' + id) || {}).value || ''; };
        if (!g('name').trim()) { ui.toast('Template name required', 'error'); return false; }
        if (!ta.value.trim()) { ui.toast('Message body required', 'error'); return false; }
        t.name = g('name').trim(); t.channel = g('channel'); t.category = g('category'); t.body = ta.value.trim();
        t.created = t.created || Date.now();
        S.upsert('tv_templates', t); ui.toast('Template saved', 'success'); done && done();
      } } ] });
  }

  /* ======================================================= WHATSAPP BOT */
  function renderBot(host) {
    var two = el('div.two-col');

    /* --- phone chat panel --- */
    var phone = el('div.card', { style: { overflow: 'hidden' } });
    var header = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
      background: 'linear-gradient(135deg,#075E54,#128C7E)', color: '#fff' } }, [
      el('div', { style: { width: '38px', height: '38px', borderRadius: '50%', background: 'rgba(255,255,255,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }, html: '<i class="bi bi-airplane-fill"></i>' }),
      el('div', { style: { flex: '1' } }, [
        el('div', { style: { fontWeight: '700', fontSize: '14px' }, text: 'Epal Travels Bot' }),
        el('div', { style: { fontSize: '11px', opacity: '.85' }, html: '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#25D366;margin-right:5px"></span>online · replies instantly' })
      ]),
      el('button.icon-btn', { title: 'Reset chat', style: { color: '#fff' }, html: ui.icon('arrow-counterclockwise'),
        onclick: function () {
          S.set('tv_bot_chat', seedChat()); drawMessages();
        } })
    ]);
    phone.appendChild(header);

    var scroll = el('div', { style: { height: '380px', overflowY: 'auto', padding: '14px',
      background: 'var(--surface-2)' } });
    phone.appendChild(scroll);

    // quick replies
    var quicks = ['Dubai fare?', 'Umrah package?', 'Visa status?', 'Cheapest to KL?', "Cox's Bazar?"];
    var chipRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 14px 0' } });
    quicks.forEach(function (q) {
      chipRow.appendChild(el('button.btn.btn-sm.btn-outline', { text: q, style: { borderRadius: '999px', fontSize: '12px' },
        onclick: function () { handleUser(q); } }));
    });
    phone.appendChild(chipRow);

    var input = el('input.input', { placeholder: 'Type a message…', style: { flex: '1' },
      onkeydown: function (e) { if (e.key === 'Enter') { fire(); } } });
    var inputRow = el('div', { style: { display: 'flex', gap: '8px', padding: '12px 14px' } }, [
      input,
      el('button.btn.btn-primary', { html: ui.icon('send-fill'), onclick: fire })
    ]);
    phone.appendChild(inputRow);

    function fire() { var v = input.value.trim(); if (!v) return; input.value = ''; handleUser(v); }

    function drawMessages() {
      scroll.innerHTML = '';
      chat().forEach(function (msg) {
        var b = chatBubble(msg.text, msg.from === 'user' ? 'in' : 'out');
        if (msg.from === 'bot' && msg.offer) {
          var offer = msg.offer;
          b.appendChild(el('div', { style: { marginTop: '8px' } }, [
            el('button.btn.btn-sm.btn-primary', { html: ui.icon('bookmark-plus') + ' Create draft booking',
              onclick: (function (of) { return function () { createDraft(of); }; })(offer) })
          ]));
        }
        scroll.appendChild(b);
      });
      scroll.scrollTop = scroll.scrollHeight;
    }

    function handleUser(text) {
      pushMsg({ from: 'user', text: text });
      drawMessages();
      // typing indicator then reply
      setTimeout(function () {
        var r = botReply(text);
        pushMsg({ from: 'bot', text: r.text, offer: r.offer || null });
        drawMessages();
      }, 300);
    }

    function createDraft(offer) {
      var b = { id: ui.uid('BB'), kind: offer.kind, route: offer.route, city: offer.city,
        airline: offer.airline, fare: offer.fare, passenger: 'WhatsApp Guest', query: offer.query || '',
        status: 'Draft', created: Date.now() };
      S.upsert('tv_bot_bookings', b);
      db.notify({ level: 'success', title: 'Draft Booking Created', text: offer.airline + ' · ' + offer.route,
        companyId: 'travels', icon: 'whatsapp' });
      ui.toast('Draft booking ' + b.id + ' created', 'success');
      pushMsg({ from: 'bot', text: 'Done! Draft booking created for ' + offer.route + ' on ' + offer.airline +
        ' at ' + ui.money(offer.fare) + '. Our agent will confirm your seat shortly. Reference ' + b.id + '.' });
      drawMessages();
      drawDrafts();
    }

    two.appendChild(phone);

    /* --- side info: draft bookings + tips --- */
    var side = el('div');
    var draftsHost = el('div');
    function drawDrafts() {
      draftsHost.innerHTML = '';
      draftsHost.appendChild(el('div.section-label', { text: 'Bot Draft Bookings' }));
      var rows = botBookings().slice().sort(function (a, b) { return b.created - a.created; });
      if (!rows.length) {
        draftsHost.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('chat-dots')),
          el('h3', { text: 'No draft bookings' }), el('p.text-muted', { text: 'Bot-generated drafts appear here.' }) ]));
        return;
      }
      var card = el('div.card', null, [ el('div.table-wrap', null, [ (function () {
        var table = el('table.tbl');
        table.innerHTML = '<thead><tr><th>Ref</th><th>Type</th><th>Route</th><th>Airline</th><th class="num">Fare</th><th>Status</th></tr></thead>';
        var tb = el('tbody');
        rows.forEach(function (r) {
          tb.appendChild(el('tr', null, [
            tdh('<span class="strong">' + r.id + '</span>'), tdh(ui.escapeHtml(r.kind || '—')),
            tdh('<span class="mono">' + ui.escapeHtml(r.route || '—') + '</span>'), tdh(ui.escapeHtml(r.airline || '—')),
            tdhN(ui.money(r.fare || 0)), tdh('<span class="badge badge-warn">' + ui.escapeHtml(r.status) + '</span>')
          ]));
        });
        table.appendChild(tb); return table;
      })() ]) ]);
      draftsHost.appendChild(card);
    }
    side.appendChild(draftsHost);
    side.appendChild(el('div.build-banner', { style: { marginTop: '18px' } }, [ ui.frag(ui.icon('lightbulb')),
      el('div', { html: 'Try: <strong>"Doha fare?"</strong>, <strong>"Umrah package?"</strong>, <strong>"visa to Dubai"</strong> or <strong>"cheapest to Singapore"</strong>. The bot quotes from live issued fares where available.' }) ]));

    two.appendChild(side);
    host.appendChild(two);

    drawMessages();
    drawDrafts();
  }

  /* --- the bot's brain: answers from real data --- */
  function botReply(query) {
    var s = (query || '').toLowerCase();

    if (/(umrah|hajj|pilgrim|makkah|madina|madinah)/.test(s)) {
      var f = liveFareFor('JED');
      var air = f ? 'Biman Bangladesh' : 'Saudia';
      var pkg = 165000;
      return { text: 'Our Eid Umrah package: DAC → JED → DAC (' + air + '), 12 nights in 4-star hotels near the Haram in Makkah & Madinah, ziyarah transport and guide included — from ' + ui.money(pkg) + ' per person. Flight-only fares start at ' + ui.money(f || 72500) + '. Would you like me to hold a package seat?',
        offer: { kind: 'Umrah', route: 'DAC → JED', city: 'Jeddah', airline: air, fare: pkg, query: query } };
    }

    if (/(visa)/.test(s)) {
      var dest = detectDest(s);
      var country = dest ? FARES[dest].city : 'the UAE';
      var apps = db.visaApps().length;
      return { text: 'Tourist visa to ' + country + ': agency service ৳6,500 + embassy fee, typical processing 3–5 working days. Required: passport (6m validity), photo, bank statement & confirmed ticket. We currently have ' + apps + ' applications in process. Want us to start your file?',
        offer: dest ? { kind: 'Visa', route: 'Visa · ' + country, city: country, airline: 'Embassy processing', fare: 6500, query: query } : null };
    }

    var code = detectDest(s);
    if (code) return fareReply(code, query);

    if (/(fare|ticket|flight|book|cheap|price|travel|going)/.test(s)) {
      return { text: 'I can quote fares to Dubai, Doha, Jeddah, Singapore, Kuala Lumpur, Istanbul, London, Kuwait and Cox’s Bazar. Which destination are you flying to?' };
    }

    return { text: 'Assalamu alaikum! I can help with air fares, Umrah packages and visa status. Try asking "Dubai fare?", "Umrah package?" or "visa to Singapore".' };
  }

  function fareReply(code, query) {
    var info = FARES[code];
    var opts = info.airlines.slice().sort(function (a, b) { return a[1] - b[1]; });
    var live = liveFareFor(code);
    var lines = opts.map(function (o, i) {
      return '• ' + o[0] + ' — ' + ui.money(o[1]) + (i === 0 ? ' (best)' : '');
    }).join('\n');
    var cheapest = opts[0];
    var liveNote = (live && live < cheapest[1]) ? '\nLive from our issued fares: ' + ui.money(live) + '.' : '';
    return {
      text: 'Return fares DAC → ' + info.city + ':\n' + lines + liveNote + '\nFares are per person, subject to availability. Tap below and I’ll create a draft booking on ' + cheapest[0] + '.',
      offer: { kind: 'Ticket', route: 'DAC → ' + code, city: info.city, airline: cheapest[0],
        fare: (live && live < cheapest[1]) ? live : cheapest[1], query: query }
    };
  }

  function detectDest(s) {
    var map = [
      ['dubai', 'DXB'], ['dxb', 'DXB'], ['doha', 'DOH'], ['doh', 'DOH'],
      ['jeddah', 'JED'], ['jed', 'JED'], ['saudi', 'JED'],
      ['singapore', 'SIN'], ['sin', 'SIN'], ['kuala', 'KUL'], ['lumpur', 'KUL'], ['malaysia', 'KUL'], ['kul', 'KUL'], [' kl', 'KUL'],
      ['istanbul', 'IST'], ['turkey', 'IST'], ['ist', 'IST'],
      ['london', 'LHR'], ['lhr', 'LHR'], [' uk', 'LHR'],
      ['kuwait', 'KWI'], ['kwi', 'KWI'], ['cox', 'CXB'], ['cxb', 'CXB'], ['bazar', 'CXB']
    ];
    for (var i = 0; i < map.length; i++) if (s.indexOf(map[i][0]) >= 0) return map[i][1];
    return null;
  }

  // Lowest live sale price to a destination code from issued air tickets, if any.
  function liveFareFor(code) {
    var arr = db.airTickets().filter(function (t) {
      return t.toCode === code || (t.route && t.route.indexOf(code) >= 0);
    });
    if (!arr.length) return null;
    var min = null;
    arr.forEach(function (t) { var v = t.sale || t.cost || 0; if (v > 0 && (min === null || v < min)) min = v; });
    return min;
  }

  /* ======================================================= SEND LOG */
  function renderSendLog(host) {
    var list = messages().slice().sort(function (a, b) { return b.at - a.at; });
    var totalDeliv = 0, totalOpen = 0;
    list.forEach(function (m) { totalDeliv += m.delivered || 0; totalOpen += m.opened || 0; });
    host.appendChild(el('div.kpi-grid', null, [
      kpi('Sends Logged', list.length, 'send-check'),
      kpi('Total Delivered', num(totalDeliv), 'check2-all'),
      kpi('Total Opened', num(totalOpen), 'envelope-open'),
      kpi('Avg Open Rate', (totalDeliv ? Math.round(totalOpen / totalDeliv * 100) : 0) + '%', 'graph-up-arrow')
    ]));

    var t = EPAL.table({
      columns: [
        { key: 'campaignName', label: 'Campaign', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.campaignName || '—') + '</span>'; } },
        { key: 'channel', label: 'Channel', badge: { WhatsApp: 'good', SMS: 'info', Email: 'accent' } },
        { key: 'audience', label: 'Audience' },
        { key: 'recipients', label: 'Recipients', num: true, render: function (r) { return num(r.recipients); } },
        { key: 'delivered', label: 'Delivered', num: true, render: function (r) { return num(r.delivered); } },
        { key: 'opened', label: 'Opened', num: true, render: function (r) { return num(r.opened); } },
        { key: 'at', label: 'Sent', render: function (r) { return ui.ago ? ui.ago(r.at) : ui.date(r.at); } },
        { key: 'status', label: 'Status', badge: { Delivered: 'good', Failed: 'bad', Queued: 'warn' } }
      ],
      rows: list,
      searchKeys: ['campaignName', 'channel', 'audience', 'status'],
      searchPlaceholder: 'Search send log…',
      filters: [{ key: 'channel', label: 'Channel' }],
      exportName: 'travels-send-log.csv',
      empty: { icon: 'send', title: 'No messages sent yet', hint: 'Send a campaign to populate the delivery log.' }
    });
    host.appendChild(t.el); t.refresh();
  }

  /* ---------------------------------------------------- data accessors */
  function campaigns() { return S.list('tv_campaigns'); }
  function templates() { return S.list('tv_templates'); }
  function messages() { return S.list('tv_messages'); }
  function botBookings() { return S.list('tv_bot_bookings'); }
  function chat() { return S.list('tv_bot_chat'); }
  function templateByName(name) { return templates().filter(function (t) { return t.name === name; })[0] || null; }
  function pushMsg(m) { m.id = m.id || ui.uid('BM'); m.at = m.at || Date.now(); var arr = chat(); arr.push(m); S.set('tv_bot_chat', arr); }

  /* ---------------------------------------------------- helpers */
  function fillTemplate(bodyStr, vals) {
    return String(bodyStr)
      .replace(/\{\{\s*name\s*\}\}/gi, vals.name)
      .replace(/\{\{\s*destination\s*\}\}/gi, vals.destination)
      .replace(/\{\{\s*agency\s*\}\}/gi, vals.agency)
      .replace(/\{\{\s*date\s*\}\}/gi, vals.date)
      .replace(/\{\{\s*fare\s*\}\}/gi, vals.fare);
  }

  // A WhatsApp-style bubble. dir 'out' = brand/bot (left), 'in' = user (right).
  function chatBubble(text, dir) {
    var isIn = dir === 'in';
    var wrap = el('div', { style: { display: 'flex', justifyContent: isIn ? 'flex-end' : 'flex-start', margin: '6px 0' } });
    var bubble = el('div', { style: {
      maxWidth: '82%', padding: '9px 13px', borderRadius: isIn ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      background: isIn ? 'var(--accent)' : 'var(--surface)', color: isIn ? '#fff' : 'var(--text)',
      border: isIn ? 'none' : '1px solid var(--border)', fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap',
      boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,.08))' } });
    bubble.textContent = text;
    wrap.appendChild(bubble);
    return wrap;
  }

  function kpi(label, value, icon) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }), el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) })
    ]);
  }
  function kv(k, v) { return el('div.field', null, [ el('label', { text: k }), el('div.fw-600', { text: String(v) }) ]); }
  function badge(text, tone) { return el('span.badge' + (tone ? '.badge-' + tone : ''), { text: text }); }
  function channelIcon(ch) { return ch === 'WhatsApp' ? 'whatsapp' : ch === 'SMS' ? 'chat-dots-fill' : 'envelope-fill'; }
  function channelTone(ch) { return ch === 'WhatsApp' ? 'good' : ch === 'SMS' ? 'info' : 'accent'; }
  function num(n) { n = +n || 0; return n.toLocaleString('en-US'); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function clone(o) { var c = {}; for (var k in o) if (o.hasOwnProperty(k)) c[k] = o[k]; return c; }
  function tdh(html) { var t = el('td'); t.innerHTML = html; return t; }
  function tdhN(html) { var t = el('td.num'); t.innerHTML = html; return t; }
  function inp(label, id, val, cls) { return el('div.field' + (cls ? '.' + cls : ''), null, [ el('label', { text: label }), el('input.input', { id: 'f-' + id, type: 'text', value: val == null ? '' : val }) ]); }
  function sel(label, id, val, opts) { var s = el('select.select', { id: 'f-' + id }); opts.forEach(function (o) { var op = el('option', { value: o, text: o }); if (o === val) op.selected = true; s.appendChild(op); }); return el('div.field', null, [ el('label', { text: label }), s ]); }

})(window.EPAL = window.EPAL || {});
