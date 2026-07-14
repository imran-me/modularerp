/* ============================================================================
 * EPAL GROUP ERP  ·  views/travels/dashboard.js
 * ----------------------------------------------------------------------------
 * TRAVELS DASHBOARD — the company-level command view for Epal Travels.
 * Mirrors the Group Command Center pattern but scoped to one concern, and
 * surfaces travel-specific signals (visa pipeline, sales, top destinations).
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db, charts = EPAL.charts;

  EPAL.view('travels/dashboard', {
    render: function (ctx) {
      var f = db.finance('travels', 12), s = db.series('travels');
      var apps = db.visaApps(), cats = db.visaCats();
      var page = el('div.page');

      page.appendChild(EPAL.pageHead({
        eyebrow:'Epal Travels & Consultancy', icon:'airplane-fill', title:'Travels Dashboard',
        sub:'Air ticketing, visa processing and consultancy — live operational health.',
        actions: [
          el('button.btn.btn-ghost', { html: ui.icon('passport') + ' Visa Board', onclick: function(){ EPAL.router.navigate('travels/visa-processing/application-board'); } }),
          el('button.btn.btn-primary', { html: ui.icon('plus-lg') + ' New Visa Application', onclick: function(){ EPAL.router.navigate('travels/visa-processing/new-application'); } })
        ]
      }));

      // KPIs — the money cockpit. EVERY box is a door (checklist 05): office cash,
      // income, expense and the net result each open their detail screen.
      var visaRevenue = apps.reduce(function (a, x){ return a + (x.sale||0); }, 0);
      var visaProfit = apps.reduce(function (a, x){ return a + ((x.sale||0) - (x.cost||0)); }, 0);
      var approved = apps.filter(function (x){ return x.stage==='Approved'; }).length;
      var pending = apps.filter(function (x){ return ['New','Documents','Submitted','Under Process'].indexOf(x.stage)>=0; }).length;
      // ONE SOURCE OF TRUTH (audit fix): the headline money tiles read the
      // double-entry LEDGER — the same book Accounts, Ledgers and the Group
      // consolidation read — never the operational financials series (which
      // stays for trends only). Before this, dashboard vs books diverged 7-21%.
      var officeCash = 0, glIncome = 0, glExpense = 0;
      try {
        officeCash = Math.round(EPAL.ledger.balance('1000',{companyId:'travels'}) + EPAL.ledger.balance('1010',{companyId:'travels'}));
        EPAL.ledger.accounts().forEach(function (a) {
          if (a.type === 'income') glIncome += EPAL.ledger.balance(a.code, { companyId: 'travels' });
          else if (a.type === 'expense') glExpense += EPAL.ledger.balance(a.code, { companyId: 'travels' });
        });
      } catch (x) {}
      glIncome = Math.round(glIncome); glExpense = Math.round(glExpense);
      var netResult = glIncome - glExpense;
      var marginPct = glIncome ? (netResult / glIncome * 100) : 0;
      page.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Office Cash & Bank', ui.money(officeCash,{compact:true}), 'bank', officeCash>=0?'up':'down', 'cash book', 'travels/accounts/cashbook'),
        kpi('Income', ui.money(glIncome,{compact:true}), 'graph-up-arrow', 'up', 'per the books', 'travels/accounts/income'),
        kpi('Expense', ui.money(glExpense,{compact:true}), 'wallet2', 'flat', 'per the books', 'travels/accounts/expenses'),
        kpi(netResult>=0?'Net Profit':'Net Loss', ui.money(Math.abs(netResult),{compact:true}), 'cash-stack', netResult>=0?'up':'down', ui.pct(marginPct)+' margin', 'travels/accounts'),
        kpi('Visa Pipeline', String(pending), 'passport', 'flat', pending+' in process', 'travels/visa-processing/application-board'),
        kpi('Visa Sales Value', ui.money(visaRevenue,{compact:true}), 'cash-coin', 'up', ui.money(visaProfit,{compact:true})+' profit', 'travels/visa-processing/manage-sales')
      ]));

      // --- Action Center: what needs attention today (each row navigates) ---
      var tickets = db.col ? db.col('airTickets') : [];
      var ttls    = db.col ? db.col('air_ttl') : [];
      var customers = db.customers ? db.customers('travels') : [];
      var now = Date.now();
      function daysLeft(d){ return d ? Math.round((new Date(d).getTime()-now)/86400000) : null; }
      function monthsLeft(d){ return d ? Math.round((new Date(d).getTime()-now)/(86400000*30.4)) : null; }
      var held = tickets.filter(function(t){ return t.status==='Hold'; });
      var ttlDue = ttls.filter(function(r){ var dl=daysLeft(r.ttl||r.deadline||r.due); return dl!=null && dl<=3 && r.status!=='Ticketed'; });
      var visaOverdue = apps.filter(function(a){ if(a.stage!=='Under Process')return false; var cat=cats.filter(function(c){return c.id===a.catId;})[0]||{days:14}; return new Date(new Date(a.created).getTime()+cat.days*86400000) < new Date(); });
      var pxSoon = customers.filter(function(c,i){ var exp=c.passportExpiry; if(!exp){ var d=new Date(2026,6,15); d.setMonth(d.getMonth()+(((i*7)%16)-2)); exp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-15'; } var m=monthsLeft(exp); return m!=null && m>=0 && m<=6; });
      var alerts = [
        held.length      ? { icon:'pause-circle-fill', tone:'warning', n:held.length,        text:'held tickets awaiting issue',            route:'travels/air-ticketing/manage-sales', match: held[0].passenger || held[0].pnr } : null,
        ttlDue.length    ? { icon:'alarm-fill',        tone:'error',   n:ttlDue.length,       text:'ticketing deadlines within 3 days',      route:'travels/air-ticketing/ttl', match: ttlDue[0].pnr || ttlDue[0].passenger || ttlDue[0].id } : null,
        visaOverdue.length ? { icon:'hourglass-bottom', tone:'error',  n:visaOverdue.length,  text:'visa decisions overdue',                 route:'travels/visa-processing/embassy-tracking', match: visaOverdue[0].applicant } : null,
        pxSoon.length    ? { icon:'person-vcard',      tone:'warning', n:pxSoon.length,       text:'customer passports expiring ≤6 months',  route:'travels/vendor-agent/customers', match: pxSoon[0].name } : null
      ].filter(Boolean);
      if (alerts.length) {
        page.appendChild(el('div.section-label',{text:'Action Center — needs attention'}));
        page.appendChild(el('div.card', null, [ el('div.card-body', null, alerts.map(function(a){
          return el('div.data-row', { style:{cursor:'pointer'}, onclick:(function(rt, mt){ return function(){ jumpTo(rt, mt); }; })(a.route, a.match) }, [
            ui.frag('<span class="notif-ico notif-'+a.tone+'">'+ui.icon(a.icon)+'</span>'),
            el('div.flex-1', null, [ el('span.strong',{text:a.n+' '}), el('span.text-dim',{text:a.text}) ]),
            ui.frag('<span class="text-mute">'+ui.icon('chevron-right')+'</span>')
          ]);
        })) ]));
      }

      // --- Payment Schedule widget (checklist 05/06): upcoming 7 & 15 days, with
      // Add Schedule + a custom Print Sheet, directly from the dashboard. --------
      (function () {
        var scheds = (db.col ? db.col('acc_schedules') : []).filter(function (s) { return s.companyId === 'travels' && s.status !== 'Paid'; });
        function dTo(s) { var d = new Date(s.due); return isNaN(d) ? 9999 : Math.round((d.getTime() - now) / 86400000); }
        var in7 = scheds.filter(function (s) { var d = dTo(s); return d >= 0 && d <= 7; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
        var in15 = scheds.filter(function (s) { var d = dTo(s); return d >= 0 && d <= 15; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
        var sum7 = in7.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
        var sum15 = in15.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
        function printSheet() {
          EPAL.formModal({ title: 'Print Schedule Sheet', icon: 'printer', size: 'sm', record: { days: '15' },
            fields: [{ key: 'days', label: 'Horizon (days)', type: 'select', options: ['7', '15', '30', '60'], default: '15' }],
            saveLabel: 'Print',
            onSave: function (v) {
              var n = +v.days, list = scheds.filter(function (s) { var d = dTo(s); return d >= -365 && d <= n; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
              var rows = list.map(function (s) { return '<tr><td>' + ui.escapeHtml(s.party || '') + '</td><td>' + ui.escapeHtml(s.kind || '') + '</td><td>' + ui.date(s.due) + '</td><td>' + ui.escapeHtml(s.status || '') + '</td><td style="text-align:right">' + ui.money(s.amount) + '</td></tr>'; }).join('');
              var tot = list.reduce(function (a, s) { return a + (+s.amount || 0); }, 0);
              ui.printDoc({ title: 'Payment Schedule — next ' + n + ' days', subtitle: 'Epal Travels & Consultancy · Accounts', meta: list.length + ' schedules · total ' + ui.money(tot), footer: 'System-generated schedule sheet',
                bodyHtml: '<table><tr><th>Party</th><th>Kind</th><th>Due</th><th>Status</th><th>Amount</th></tr>' + rows + '<tr><th colspan="4">Total</th><th style="text-align:right">' + ui.money(tot) + '</th></tr></table>' });
              return true;
            } });
        }
        function addSchedule() {
          EPAL.formModal({ title: 'Add Payment Schedule', icon: 'calendar2-plus', size: 'md', record: { kind: 'Payable', status: 'Pending' },
            fields: [
              { key: 'party', label: 'Party', type: 'text', required: true, placeholder: 'Vendor / customer / staff' },
              { key: 'kind', label: 'Kind', type: 'select', options: ['Payable', 'Receivable'], default: 'Payable' },
              { key: 'amount', label: 'Amount (৳)', type: 'money', required: true, min: 1 },
              { key: 'due', label: 'Due date', type: 'date', required: true },
              { key: 'desc', label: 'Note', type: 'textarea', col2: true }
            ],
            saveLabel: 'Add Schedule',
            onSave: function (v) {
              db.save('acc_schedules', { id: 'SCH-' + ui.uid('').slice(-5).toUpperCase(), companyId: 'travels', party: v.party, kind: v.kind, amount: +v.amount || 0, due: v.due, status: 'Pending', desc: v.desc || '' });
              ui.toast('Schedule added', 'success'); EPAL.router.render(); return true;
            } });
        }
        var head = el('div.card-head', null, [
          el('h3', { html: ui.icon('calendar-week') + ' Payment Schedule' }),
          el('div.flex.gap-1', { style: { marginLeft: 'auto' } }, [
            el('button.btn.btn-sm.btn-ghost', { html: ui.icon('printer') + ' Print Sheet', onclick: printSheet }),
            el('button.btn.btn-sm.btn-primary', { html: ui.icon('plus-lg') + ' Add Schedule', onclick: addSchedule })
          ])
        ]);
        var bodyEl = el('div.card-body');
        bodyEl.appendChild(el('div.stat-row.mb-2', null, [
          el('div.stat', null, [el('div.stat-label', { text: 'Next 7 days' }), el('div.stat-value', { text: in7.length + ' · ' + ui.money(sum7, { compact: true }) })]),
          el('div.stat', null, [el('div.stat-label', { text: 'Next 15 days' }), el('div.stat-value', { text: in15.length + ' · ' + ui.money(sum15, { compact: true }) })])
        ]));
        if (!in15.length) bodyEl.appendChild(el('div.text-mute.sm', { text: 'Nothing due in the next 15 days.' }));
        in15.slice(0, 6).forEach(function (s) {
          var d = dTo(s);
          bodyEl.appendChild(el('div.data-row', { style: { cursor: 'pointer' }, onclick: function () { jumpTo('travels/accounts/schedules', s.party); } }, [
            ui.frag('<span class="notif-ico notif-' + (d <= 3 ? 'error' : 'warning') + '">' + ui.icon(s.kind === 'Payable' ? 'arrow-up-right-circle' : 'arrow-down-left-circle') + '</span>'),
            el('div.flex-1', null, [el('div.fw-600.sm', { text: s.party || '—' }), el('div.text-mute.xs', { text: s.kind + ' · due ' + ui.date(s.due) + (d === 0 ? ' (today)' : d > 0 ? ' (in ' + d + 'd)' : '') })]),
            el('div.strong', { text: ui.money(s.amount) })
          ]));
        });
        page.appendChild(el('div.card.mb-3', null, [head, bodyEl]));
      })();

      // trend + visa stage funnel
      var row = el('div.two-col');
      row.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('activity')+' Sales & Profit Trend' }), el('span.card-sub',{text:'monthly'}) ]),
        el('div.card-body', null, [ el('div',{style:{height:'260px',position:'relative'}},[ el('canvas#tv-trend') ]) ])
      ]));
      // visa stage distribution
      var stages = ['New','Documents','Submitted','Under Process','Approved','Rejected'];
      var stageCounts = stages.map(function (st){ return apps.filter(function(x){return x.stage===st;}).length; });
      row.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('diagram-2')+' Visa Pipeline' }) ]),
        el('div.card-body', null, [ el('div',{style:{height:'260px',position:'relative'}},[ el('canvas#tv-stages') ]) ])
      ]));
      page.appendChild(row);

      // top destinations + recent applications
      var row2 = el('div.two-col');
      var byCountry = {};
      apps.forEach(function (a){ byCountry[a.country] = (byCountry[a.country]||0)+1; });
      var top = Object.keys(byCountry).map(function (k){ return { country:k, n:byCountry[k], flag:(cats.filter(function(c){return c.country===k;})[0]||{}).flag||'🌍' }; })
        .sort(function (a,b){ return b.n-a.n; }).slice(0,6);
      row2.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('geo-alt-fill')+' Top Destinations' }) ]),
        el('div.card-body', null, [ el('div.data-list', null, top.map(function (d){
          return el('div.data-row', null, [ el('span',{style:{fontSize:'20px'},text:d.flag}),
            el('div.flex-1.fw-600',{text:d.country}),
            el('div.progress',{style:{width:'90px'}},[ el('div.progress-bar',{style:{width:(d.n/top[0].n*100)+'%'}}) ]),
            el('span.badge.badge-accent',{text:d.n+' apps'}) ]);
        })) ])
      ]));
      row2.appendChild(el('div.card', null, [
        el('div.card-head', null, [ el('h3', { html: ui.icon('clock-history')+' Recent Applications' }),
          el('a.link-btn',{href:'#/travels/visa-processing/application-board',text:'View board'}) ]),
        el('div.card-body', null, [ el('div.data-list', null, apps.slice(0,6).map(function (a){
          return el('div.data-row', { style:{cursor:'pointer'}, onclick:function(){ EPAL.router.navigate('travels/visa-processing/application-board'); } }, [
            el('span',{style:{fontSize:'18px'},text:a.flag}),
            el('div.flex-1', null, [ el('div.fw-600.sm',{text:a.applicant}), el('div.text-mute.xs',{text:a.country+' · '+a.visaType}) ]),
            stageBadge(a.stage) ]);
        })) ])
      ]));
      page.appendChild(row2);

      ctx.mount.appendChild(page);

      requestAnimationFrame(function () {
        charts.area(ui.$('#tv-trend'), { labels:s.labels, datasets:[
          { label:'Revenue', data:s.revenue, color:'#2f6bff' },
          { label:'Profit', data:s.profit, color:'#23c17e' } ] });
        charts.bar(ui.$('#tv-stages'), { labels:stages, datasets:[{ label:'Applications', data:stageCounts,
          colors:['#8b93a7','#7b5cff','#2f6bff','#f4b740','#23c17e','#f0506e'] }], money:false });
      });
    }
  });

  function kpi(label, value, icon, dir, foot, route) {
    return el('div.kpi-card' + (route ? '.drill' : ''), route ? { onclick: function () { EPAL.router.navigate(route); }, title: 'Open ' + label } : null, [
      el('div.kpi-top', null, [ el('span.kpi-label',{text:label}), el('span.kpi-ico',{html:'<i class="bi bi-'+icon+'"></i>'}) ]),
      el('div.kpi-value',{text:value}),
      el('div.kpi-foot', null, [ foot?el('span.kpi-trend.'+(dir||'flat'),{html:(dir==='up'?ui.icon('arrow-up-right'):dir==='down'?ui.icon('arrow-down-right'):ui.icon('dash'))+' '+foot}):null ])
    ]);
  }
  /* Navigate to a route, then land the user DIRECTLY on the matching row —
   * scrolled to centre and flashed — so nobody hunts through a table (checklist:
   * "click korle direct fixed position-e show korbe, scroll jeno na lage"). */
  function jumpTo(route, match) {
    EPAL.router.navigate(route);
    if (!match) return;
    var tries = 0;
    (function seek() {
      if (++tries > 25) return;                      // give up quietly after ~2.5s
      var view = document.getElementById('view');
      var rows = view ? view.querySelectorAll('.tbl tbody tr, .data-row, .kb-card') : [];
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].textContent || '').indexOf(match) >= 0) {
          rows[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
          rows[i].classList.add('row-flash');
          setTimeout((function (r) { return function () { r.classList.remove('row-flash'); }; })(rows[i]), 2600);
          return;
        }
      }
      setTimeout(seek, 100);
    })();
  }
  function stageBadge(stage) {
    var map = { 'Approved':'good','Rejected':'bad','Under Process':'warn','Submitted':'info','Documents':'','New':'' };
    return el('span.badge'+(map[stage]?'.badge-'+map[stage]:''), { text: stage });
  }
  EPAL.travelStageBadge = stageBadge;

})(window.EPAL = window.EPAL || {});
