# Views Guide — how to add a module screen

Everything you need to turn a scaffolded nav item into a real screen. Copy, rename, ship.

## 1. Create the file

`assets/js/views/<company>/<module>.js`:

```js
(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, db = EPAL.db;

  // Route key = "<companyId>/<moduleId>". Handles all its sub-routes via ctx.subId.
  EPAL.view('shop/inventory', {
    render: function (ctx) {
      var page = el('div.page');

      // Standard premium header (eyebrow + title + actions)
      page.appendChild(EPAL.pageHead({
        eyebrow: ctx.company.name,
        icon: ctx.module.icon,
        title: ctx.module.label,
        sub: ctx.module.desc,
        actions: [
          el('button.btn.btn-primary', {
            html: ui.icon('plus-lg') + ' New Item',
            onclick: function () { /* open a modal, save via db… */ }
          })
        ]
      }));

      // Branch on sub-route if you like:
      //   ctx.subId === 'stock' | 'warehouses' | 'low-stock' | …

      // Build your content with el() and append to `page`, then:
      ctx.mount.appendChild(page);
    },

    // optional — clean up timers/listeners when the user navigates away
    teardown: function () {}
  });

})(window.EPAL = window.EPAL || {});
```

## 2. Register the script

Add one line to `index.html` (in the VIEWS block, **before** `core/app.js`):

```html
<script src="assets/js/views/shop/inventory.js"></script>
```

That's it. The nav item (already present from `config.js`) now renders your view
instead of the scaffold.

## 3. The toolkit you have

### DOM — `EPAL.ui.el(spec, attrs, children)`
```js
el('div.card.hover#main', { onclick: fn, style:{padding:'20px'} }, [
  el('h3', { text: 'Title' }),          // text: is auto-escaped
  ui.frag('<b>raw html</b>'),           // when you really need HTML
])
```
`spec` = `tag.class.class#id` (tag optional, defaults to div).

### Formatting
```js
ui.money(1250000, {compact:true})  // "৳ 12.5L"
ui.num(42000)                      // "42,000"
ui.pct(23.4)                       // "23.4%"
ui.date(ts, 'long'|'time'|'full')  // localized
ui.ago(ts)                         // "3h ago"
ui.dur(ms)                         // "2h 15m"
ui.initials(name) / ui.colorFor(str) / ui.uid('T')
```

### Feedback
```js
ui.toast('Saved', 'success'|'error'|'warning'|'info', { title });
ui.modal({ title, icon, size:'sm|lg|xl', body: elOrHtml, actions:[{label, variant, onClick}] });
ui.confirm({ title, text, danger:true }).then(ok => …);
```

### Data (always via db so events fire)
```js
db.employees({companyId}) · db.employee(id) · db.customers() · db.leads()
db.finance(companyId, months) · db.series(companyId) · db.groupSnapshot()
db.saveEmployee(e) · db.saveVisaApp(a) · db.saveTask(empId, t) · db.notify({…})
db.log(actor, text, companyId)     // audit trail
```

### Charts (theme-aware; auto-destroyed on route change)
```js
// canvas must be in the document first (use requestAnimationFrame)
EPAL.charts.area(canvas, { labels, datasets:[{label,data,color}] });
EPAL.charts.bar(canvas,  { labels, datasets:[{data,colors}], horizontal, money });
EPAL.charts.doughnut(canvas, { labels, data, colors, legend:'bottom' });
EPAL.charts.spark(canvas, [1,2,3], '#23c17e');
```

## 4. Sub-routes

You don't need one file per sub-module. Register `company/module` and switch on
`ctx.subId` (see `views/travels/visa-processing.js` for the full pattern — one view
serves categories / new-application / board / sales / rates / tracking / docs / analysis).

## 5. Wildcards

Register `'*/moduleId'` to serve a module that behaves identically across companies
(e.g. the task board is registered as `'*/tasks'` so `it/tasks`, `shop/tasks`, … all
work). The router falls back company-specific → wildcard → scaffold.

## 6. Conventions checklist

- [ ] Start the file with a banner comment (what/why).
- [ ] Never put a literal `*` `/` pair inside a block comment.
- [ ] Escape user data (`text:` or `ui.escapeHtml`).
- [ ] Mutate only through `EPAL.db.*`.
- [ ] Clean up timers/listeners in `teardown()`.
- [ ] Keep it responsive — use the existing grid helpers (`.grid-auto`, `.two-col`).
