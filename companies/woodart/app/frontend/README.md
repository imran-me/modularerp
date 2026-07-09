# Woodart Interiors — frontend

In the running SPA every screen is rendered by its module's `view.js`
(`companies/woodart/modules/<id>/view.js`) — the HTML is generated in JS, so
this company already has a full working frontend today.

Standalone HTML+Tailwind pages (like the Travels mini-app in
`companies/travels/app/frontend/`) can be added here later. Phase 4 of the
migration also folds `tw-` utility classes INTO each module's `view.js`,
screen by screen, with side-by-side visual diffs — pixel-identical to now.
