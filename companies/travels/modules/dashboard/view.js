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
