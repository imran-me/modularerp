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

      // KPIs
      var visaRevenue = apps.reduce(function (a, x){ return a + (x.sale||0); }, 0);
      var visaProfit = apps.reduce(function (a, x){ return a + ((x.sale||0) - (x.cost||0)); }, 0);
      var approved = apps.filter(function (x){ return x.stage==='Approved'; }).length;
      var pending = apps.filter(function (x){ return ['New','Documents','Submitted','Under Process'].indexOf(x.stage)>=0; }).length;
      page.appendChild(el('div.kpi-grid.stagger', null, [
        kpi('Revenue (12M)', ui.money(f.revenue,{compact:true}), 'graph-up-arrow', 'up', ui.pct(db.momRevenue('travels'))),
        kpi('Net Profit', ui.money(f.profit,{compact:true}), 'cash-stack', f.profit>=0?'up':'down', ui.pct(f.margin)+' margin'),
        kpi('Visa Pipeline', String(pending), 'passport', 'flat', pending+' in process'),
        kpi('Approved Visas', String(approved), 'patch-check-fill', 'up', ''),
        kpi('Visa Sales Value', ui.money(visaRevenue,{compact:true}), 'cash-coin', 'up', ui.money(visaProfit,{compact:true})+' profit')
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
        held.length      ? { icon:'pause-circle-fill', tone:'warning', n:held.length,        text:'held tickets awaiting issue',            route:'travels/air-ticketing/manage-sales' } : null,
        ttlDue.length    ? { icon:'alarm-fill',        tone:'error',   n:ttlDue.length,       text:'ticketing deadlines within 3 days',      route:'travels/air-ticketing/ttl' } : null,
        visaOverdue.length ? { icon:'hourglass-bottom', tone:'error',  n:visaOverdue.length,  text:'visa decisions overdue',                 route:'travels/visa-processing/embassy-tracking' } : null,
        pxSoon.length    ? { icon:'person-vcard',      tone:'warning', n:pxSoon.length,       text:'customer passports expiring ≤6 months',  route:'travels/vendor-agent/customers' } : null
      ].filter(Boolean);
      if (alerts.length) {
        page.appendChild(el('div.section-label',{text:'Action Center — needs attention'}));
        page.appendChild(el('div.card', null, [ el('div.card-body', null, alerts.map(function(a){
          return el('div.data-row', { style:{cursor:'pointer'}, onclick:(function(rt){ return function(){ EPAL.router.navigate(rt); }; })(a.route) }, [
            ui.frag('<span class="notif-ico notif-'+a.tone+'">'+ui.icon(a.icon)+'</span>'),
            el('div.flex-1', null, [ el('span.strong',{text:a.n+' '}), el('span.text-dim',{text:a.text}) ]),
            ui.frag('<span class="text-mute">'+ui.icon('chevron-right')+'</span>')
          ]);
        })) ]));
      }

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

  function kpi(label, value, icon, dir, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label',{text:label}), el('span.kpi-ico',{html:'<i class="bi bi-'+icon+'"></i>'}) ]),
      el('div.kpi-value',{text:value}),
      el('div.kpi-foot', null, [ foot?el('span.kpi-trend.'+(dir||'flat'),{html:(dir==='up'?ui.icon('arrow-up-right'):dir==='down'?ui.icon('arrow-down-right'):ui.icon('dash'))+' '+foot}):null ])
    ]);
  }
  function stageBadge(stage) {
    var map = { 'Approved':'good','Rejected':'bad','Under Process':'warn','Submitted':'info','Documents':'','New':'' };
    return el('span.badge'+(map[stage]?'.badge-'+map[stage]:''), { text: stage });
  }
  EPAL.travelStageBadge = stageBadge;

})(window.EPAL = window.EPAL || {});
