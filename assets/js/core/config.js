/* ============================================================================
 * EPAL GROUP ERP  ·  core/config.js
 * ----------------------------------------------------------------------------
 * THE MODULE REGISTRY — the single source of truth for the whole system.
 *
 * Everything in this ERP is DATA-DRIVEN from this file:
 *   - The sidebar navigation is generated from here.
 *   - The router resolves routes declared here.
 *   - The admin "Module Manager" flips the `enabled` flags stored on top of
 *     this registry (persisted in localStorage) so companies / modules /
 *     sub-modules can be switched on and off live, with ZERO code changes.
 *
 * MENTAL MODEL
 *   Group  ──has many──▶  Companies (sister concerns)
 *   Company ──has many──▶ Modules (Dashboard, CRM, Visa Processing, ...)
 *   Module  ──has many──▶ Sub-modules (Visa Category, New Application, ...)
 *
 * A route looks like:  #/<companyId>/<moduleId>[/<submoduleId>]
 *   e.g. #/travels/visa-processing/new-application
 *
 * HOW TO ADD SOMETHING NEW (future development):
 *   1. Add a company / module / submodule object below.
 *   2. (Optional) register a view renderer in assets/js/views/registry.js.
 *      If you don't, the generic placeholder scaffold renders automatically,
 *      so the nav item is live immediately.
 *   That's it. No wiring in three places like the old monolith.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';

  /* --------------------------------------------------------------------------
   * Small helper so every module can be declared tersely.
   * `m('visa-processing','Visa Processing','passport', {subs:[...]})`
   * ------------------------------------------------------------------------*/
  function m(id, label, icon, opts) {
    opts = opts || {};
    return {
      id: id,
      label: label,
      icon: icon,                         // Bootstrap Icons name (bi-<icon>)
      desc: opts.desc || '',              // shown on placeholder / tooltips
      enabled: opts.enabled !== false,    // default ON unless explicitly false
      admin: !!opts.admin,                // admin/owner-only module
      badge: opts.badge || null,          // e.g. 'New', or a count
      roles: opts.roles || null,          // null = inherit company access rules
      subs: (opts.subs || []).map(function (s) {
        // A submodule may be a bare string id, [id,label] or [id,label,icon]
        if (typeof s === 'string') return { id: s, label: titleize(s), icon: 'dot' };
        return { id: s[0], label: s[1] || titleize(s[0]), icon: s[2] || 'dot',
                 desc: s[3] || '', enabled: s[4] !== false };
      })
    };
  }

  function titleize(slug) {
    return String(slug).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ==========================================================================
   * GROUP-WIDE MODULES  (the "Epal Group" command layer)
   * ========================================================================*/
  var GROUP_MODULES = [
    m('dashboard',      'Command Center',       'grid-1x2-fill', { desc:'Consolidated group health, KPIs, intelligence.' }),
    m('companies',      'Sister Concerns',      'diagram-3-fill',{ desc:'All companies at a glance — revenue, margin, risk.' }),
    m('finance',        'Consolidated Finance', 'cash-coin',     { desc:'Group P&L, cash position, receivables, payables.',
        subs:[['pnl','Profit & Loss'],['cashflow','Cash Flow'],['balance-sheet','Balance Sheet'],
              ['receivables','Receivables'],['payables','Payables'],['banks','Bank Positions']] }),
    m('analytics',      'Business Intelligence','graph-up-arrow',{ desc:'Cross-company trends, forecasts, comparisons.',
        subs:[['trends','Trends'],['forecast','Forecast'],['compare','Company Comparison'],['heatmap','Activity Heatmap']] }),
    m('crm',            'Group CRM',            'people-fill',   { desc:'Unified customer graph shared across all concerns.',
        subs:[['leads','Leads'],['pipeline','Pipeline'],['customers','Customers 360'],['activities','Activities']] }),
    m('employees',      'Workforce',            'person-badge-fill',{ admin:true, desc:'Every employee of the whole group.',
        subs:[['directory','Directory'],['attendance','Attendance'],['leaves','Leaves'],['payroll','Payroll'],
              ['performance','Performance'],['org-chart','Org Chart']] }),
    m('tasks',          'Task Oversight',       'kanban-fill',   { admin:true, desc:'Open any employee task board, assign & audit.' }),
    m('reports',        'Reports',              'file-earmark-bar-graph-fill',{ desc:'Downloadable, documentation-grade reports.' }),
    m('automation',     'Automation',           'robot',         { desc:'Rules, triggers & workflows across the group.' }),
    m('notifications',  'Notifications',        'bell-fill',     { desc:'System-wide alerts, mentions & approvals.' }),
    m('module-manager', 'Module Control',       'toggles2',      { admin:true, desc:'Turn companies, modules & features on/off live.' }),
    m('settings',       'Settings',             'gear-fill',     { admin:true, desc:'Group profile, branding, security, backups.' })
  ];

  /* ==========================================================================
   * TRAVELS — the deepest concern (mirrors real world-class travel agencies).
   * Field-level realism is documented in docs/travels-visa.md.
   * ========================================================================*/
  var TRAVELS_MODULES = [
    m('dashboard',       'Dashboard',        'speedometer2', { desc:'Travels performance, sales, pipeline, alerts.' }),
    m('crm',             'CRM',              'person-lines-fill', { desc:'Leads, follow-ups, communication hub.',
        subs:[['leads','Leads'],['pipeline','Sales Pipeline'],['follow-ups','Follow-ups'],['comm-hub','Communication Hub']] }),
    m('vendor-agent',    'Vendor & Agent',   'people', { desc:'Vendors, agents, portals, commission & party ledgers.',
        subs:[['vendors','Manage Vendors'],['agents','Manage Agents'],['portals','Portals / GDS'],
              ['accounts','Party Accounts'],['commission','Commission']] }),
    m('air-ticketing',   'Air Ticketing',    'airplane-fill', { desc:'Issue, re-issue, refund, void, EMD + BSP recon.',
        subs:[['ticketing','Direct Sale'],['manage-sales','Manage Sales'],['airlines','Airlines'],
              ['airports','Airports'],['bsp','BSP / ADM Recon'],['refunds','Refund Tracker']] }),
    m('contract-flight', 'Contract Flight',  'airplane-engines', { desc:'Group/charter seat blocks (Umrah, Hajj, worker).',
        subs:[['schedule','Flight Schedule'],['add-flight','Add Flight'],['category','Category'],['manage-sales','Manage Sales']] }),
    m('visa-processing', 'Visa Processing',  'passport-fill', { badge:'Core', desc:'End-to-end visa lifecycle.',
        subs:[['categories','Visa Categories'],['new-application','New Application'],['application-board','Application Board'],
              ['manage-sales','Manage Sales'],['visa-rates','Visa Rates'],['embassy-tracking','Embassy Tracking'],
              ['documents','Required Documents'],['analysis','Analysis']] }),
    m('file-management', 'File Management',  'folder-fill', { desc:'Embassy files, submission slots, decision tracking.',
        subs:[['files','All Files'],['add-file','Add File'],['slot-tracker','Slot Tracker']] }),
    m('passport-mgmt',   'Passport Mgmt',    'person-vcard', { desc:'Passport holders, categories, expiry radar.',
        subs:[['holders','Holders'],['categories','Categories'],['expiry','Expiry Radar']] }),
    m('customers',       'Customers',        'person-hearts', { desc:'Traveller 360 — shared with Group CRM.' }),
    m('accounts',        'Accounts',         'cash-stack', { desc:'Income, expenses, journals, payment schedules.',
        subs:[['income','Income'],['expenses','Expenses'],['journals','Journals'],['schedules','Payment Schedules']] }),
    m('ledgers',         'Ledgers',          'journal-text', { desc:'General & party ledgers, trial balance.' }),
    m('hrm',             'HRM',              'people-fill', { desc:'Travels team — attendance, leaves, payroll.' }),
    m('reports',         'Reports',          'file-earmark-spreadsheet', { desc:'Sales, visa, ticketing, financial reports.' }),
    m('analytics',       'Analytics',        'graph-up', { desc:'Profit leak, fraud sentinel, travel-DNA.' }),
    m('marketing',       'Marketing',        'megaphone-fill', { desc:'Email / SMS / WhatsApp campaigns.' }),
    m('automation',      'Automation',       'robot', { desc:'Doc-expiry radar, markup engine, bots.' }),
    m('tasks',           'My Tasks',         'kanban', { desc:'Personal Kanban board with phase timers.' }),
    m('settings',        'Settings',         'gear-fill', { admin:true, desc:'Travels-specific configuration.' })
  ];

  /* ==========================================================================
   * WOODART INTERIORS — design-build interior projects.
   * ========================================================================*/
  var WOODART_MODULES = [
    m('dashboard',    'Dashboard',        'speedometer2', { desc:'Projects, pipeline, workshop load, margins.' }),
    m('crm',          'Leads & CRM',      'person-lines-fill', { desc:'Design enquiries → site visits → deals.' }),
    m('projects',     'Projects',         'easel2-fill', { desc:'Design-build projects, phases & milestones.',
        subs:[['active','Active Projects'],['design','Design Studio'],['milestones','Milestones'],['gallery','Gallery']] }),
    m('estimates',    'Estimates & BOQ',  'calculator-fill', { desc:'Quotations, bill of materials, costing.',
        subs:[['quotations','Quotations'],['boq','Bill of Materials'],['costing','Costing']] }),
    m('clients',      'Clients',          'person-hearts', { desc:'Homeowners, developers, corporates.' }),
    m('materials',    'Materials',        'boxes', { desc:'Wood, laminates, hardware, finishes inventory.' }),
    m('production',   'Workshop',         'hammer', { desc:'Fabrication jobs, machine & labour scheduling.' }),
    m('installation', 'Site & Install',   'truck', { desc:'Delivery, installation, site handover & snags.' }),
    m('procurement',  'Procurement',      'cart-fill', { desc:'Vendors, purchase orders, GRN.' }),
    m('accounts',     'Accounts',         'cash-stack', { desc:'Income, expenses, project P&L.' }),
    m('ledgers',      'Ledgers',          'journal-text', { desc:'General & client ledgers.' }),
    m('hrm',          'HRM',              'people-fill', { desc:'Designers, carpenters, site crew.' }),
    m('reports',      'Reports',          'file-earmark-bar-graph', { desc:'Project, material & financial reports.' }),
    m('analytics',    'Analytics',        'graph-up', { desc:'Margin analysis, wastage, on-time delivery.' }),
    m('tasks',        'My Tasks',         'kanban', { desc:'Personal Kanban board with phase timers.' }),
    m('settings',     'Settings',         'gear-fill', { admin:true, desc:'Woodart configuration.' })
  ];

  /* ==========================================================================
   * EPAL IT SOLUTIONS — software / services house.
   * ========================================================================*/
  var IT_MODULES = [
    m('dashboard',   'Dashboard',    'speedometer2', { desc:'Projects, MRR, utilisation, support SLA.' }),
    m('crm',         'Leads & CRM',  'person-lines-fill', { desc:'Sales pipeline for software & services.' }),
    m('projects',    'Projects',     'kanban', { desc:'Delivery projects, sprints, phases.',
        subs:[['active','Active Projects'],['sprints','Sprints'],['roadmap','Roadmap']] }),
    m('services',    'Products & SaaS','box-seam', { desc:'Recurring products, subscriptions, MRR.',
        subs:[['catalog','Catalog'],['subscriptions','Subscriptions'],['mrr','MRR / Churn']] }),
    m('clients',     'Clients',      'person-hearts', { desc:'Client accounts & contacts.' }),
    m('support',     'Support Desk', 'headset', { desc:'Tickets, SLAs, knowledge base.',
        subs:[['tickets','Tickets'],['sla','SLA Monitor'],['kb','Knowledge Base']] }),
    m('contracts',   'Contracts',    'file-earmark-medical', { desc:'AMС, SLAs, renewals.' }),
    m('timesheets',  'Timesheets',   'clock-history', { desc:'Billable hours, utilisation.' }),
    m('accounts',    'Accounts',     'cash-stack', { desc:'Invoicing, expenses, project P&L.' }),
    m('ledgers',     'Ledgers',      'journal-text', { desc:'General & client ledgers.' }),
    m('hrm',         'HRM',          'people-fill', { desc:'Developers, QA, design, ops.' }),
    m('reports',     'Reports',      'file-earmark-bar-graph', { desc:'Delivery & financial reports.' }),
    m('analytics',   'Analytics',    'graph-up', { desc:'Velocity, margin, churn, forecasts.' }),
    m('tasks',       'My Tasks',     'kanban', { desc:'Personal Kanban board with phase timers.' }),
    m('settings',    'Settings',     'gear-fill', { admin:true, desc:'IT Solutions configuration.' })
  ];

  /* ==========================================================================
   * EPAL SHOP — retail / e-commerce with POS.
   * ========================================================================*/
  var SHOP_MODULES = [
    m('dashboard',   'Dashboard',   'speedometer2', { desc:'Sales, best-sellers, stock health, margins.' }),
    m('pos',         'Point of Sale','upc-scan', { badge:'Live', desc:'Fast checkout terminal.' }),
    m('products',    'Products',    'box-seam', { desc:'Catalog, variants, pricing, barcodes.',
        subs:[['catalog','Catalog'],['categories','Categories'],['brands','Brands'],['units','Units'],['discounts','Discounts']] }),
    m('inventory',   'Inventory',   'boxes', { desc:'Stock, warehouses, transfers, adjustments.',
        subs:[['stock','Stock'],['warehouses','Warehouses'],['transfers','Transfers'],['adjustments','Adjustments'],['low-stock','Low Stock']] }),
    m('orders',      'Orders',      'bag-check', { desc:'Online & counter orders, fulfilment.' }),
    m('purchases',   'Purchases',   'cart-plus', { desc:'Suppliers, purchase orders, returns.' }),
    m('customers',   'Customers',   'person-hearts', { desc:'Loyalty, history — shared with Group CRM.' }),
    m('suppliers',   'Suppliers',   'truck', { desc:'Supplier accounts & terms.' }),
    m('accounts',    'Accounts',    'cash-stack', { desc:'Sales, expenses, daily closing.' }),
    m('ledgers',     'Ledgers',     'journal-text', { desc:'General, customer & supplier ledgers.' }),
    m('hrm',         'HRM',         'people-fill', { desc:'Cashiers, floor staff, managers.' }),
    m('reports',     'Reports',     'file-earmark-bar-graph', { desc:'Sales, stock, tax, profit reports.' }),
    m('analytics',   'Analytics',   'graph-up', { desc:'Basket analysis, ABC, seasonality.' }),
    m('tasks',       'My Tasks',    'kanban', { desc:'Personal Kanban board with phase timers.' }),
    m('settings',    'Settings',    'gear-fill', { admin:true, desc:'Shop configuration & tax.' })
  ];

  /* ==========================================================================
   * EPAL CONSTRUCTION — projects, BOQ, procurement, site.
   * ========================================================================*/
  var CONSTRUCTION_MODULES = [
    m('dashboard',    'Dashboard',      'speedometer2', { desc:'Project progress, cost vs budget, cash.' }),
    m('projects',     'Projects / Sites','buildings-fill', { desc:'Sites, WBS, progress, milestones.',
        subs:[['active','Active Sites'],['wbs','Work Breakdown'],['progress','Progress'],['milestones','Milestones']] }),
    m('tenders',      'Tenders',        'clipboard-check', { desc:'Bids, prequalification, awards.' }),
    m('boq',          'BOQ & Estimation','calculator-fill', { desc:'Bill of quantities, rate analysis.' }),
    m('materials',    'Materials',      'bricks', { desc:'Cement, steel, aggregates — stock & issue.' }),
    m('procurement',  'Procurement',    'cart-fill', { desc:'Vendors, PO, GRN, comparative statements.' }),
    m('equipment',    'Plant & Assets', 'gear-wide-connected', { desc:'Machinery, utilisation, maintenance.' }),
    m('subcontractors','Subcontractors','person-workspace', { desc:'Nominated & labour subcontracts.' }),
    m('labor',        'Workforce',      'people', { desc:'Site labour, muster, wages.' }),
    m('quality',      'Quality & Safety','shield-check', { desc:'QA/QC checklists, HSE incidents.' }),
    m('accounts',     'Accounts',       'cash-stack', { desc:'IPCs, expenses, project cost control.' }),
    m('ledgers',      'Ledgers',        'journal-text', { desc:'General & vendor ledgers.' }),
    m('hrm',          'HRM',            'people-fill', { desc:'Engineers, supervisors, admin.' }),
    m('reports',      'Reports',        'file-earmark-bar-graph', { desc:'Progress, cost, material reports.' }),
    m('analytics',    'Analytics',      'graph-up', { desc:'EVM, cost overrun risk, cash forecast.' }),
    m('tasks',        'My Tasks',       'kanban', { desc:'Personal Kanban board with phase timers.' }),
    m('settings',     'Settings',       'gear-fill', { admin:true, desc:'Construction configuration.' })
  ];

  /* ==========================================================================
   * COMPANIES (sister concerns) — each with its accent identity & module set.
   * `type:'group'` is the special aggregation layer (Epal Group itself).
   * ========================================================================*/
  var COMPANIES = [
    { id:'group', name:'Epal Group', short:'Group', type:'group', enabled:true,
      icon:'hexagon-fill', accent:'#c8a24a', /* platinum-gold */ tagline:'Command Layer',
      modules: GROUP_MODULES },

    { id:'travels', name:'Epal Travels & Consultancy', short:'Travels', type:'company', enabled:true,
      icon:'airplane-fill', accent:'#2f6bff', tagline:'Air · Visa · Consultancy',
      modules: TRAVELS_MODULES },

    { id:'woodart', name:'Woodart Interiors', short:'Woodart', type:'company', enabled:true,
      icon:'tree-fill', accent:'#6f9c1c', tagline:'Design · Build · Fit-out',
      modules: WOODART_MODULES },

    { id:'it', name:'Epal IT Solutions', short:'IT Solutions', type:'company', enabled:true,
      icon:'cpu-fill', accent:'#7b5cff', tagline:'Software · Cloud · Support',
      modules: IT_MODULES },

    { id:'shop', name:'Epal Shop', short:'Shop', type:'company', enabled:true,
      icon:'shop', accent:'#e0356e', tagline:'Retail · POS · E-commerce',
      modules: SHOP_MODULES },

    { id:'construction', name:'Epal Construction', short:'Construction', type:'company', enabled:true,
      icon:'buildings-fill', accent:'#e2721b', tagline:'Build · Infra · Projects',
      modules: CONSTRUCTION_MODULES }
  ];

  /* ==========================================================================
   * GROUP-LEVEL META
   * ========================================================================*/
  EPAL.config = {
    group: {
      name: 'Epal Group',
      legalName: 'Epal Group of Companies',
      tagline: 'One Group. One Operating System.',
      currency: 'BDT',
      currencySymbol: '৳',
      locale: 'en-BD',
      fiscalYearStart: 7,               // July (Bangladesh fiscal year)
      established: 2011
    },
    companies: COMPANIES,

    /* Convenience lookups (rebuilt after overrides are applied) --------------*/
    company: function (id) { return COMPANIES.filter(function (c) { return c.id === id; })[0] || null; },
    module: function (companyId, moduleId) {
      var c = this.company(companyId); if (!c) return null;
      return c.modules.filter(function (mm) { return mm.id === moduleId; })[0] || null;
    },

    /* Version + build stamp (bumped as the system grows) -------------------*/
    version: '0.1.0',
    codename: 'Aurora'
  };

  // expose the tiny helpers too (used by the module manager & scaffolds)
  EPAL.config._m = m;
  EPAL.config._titleize = titleize;

})(window.EPAL = window.EPAL || {});
