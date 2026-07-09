# Woodart Interiors — company app shell

The self-contained frontend + backend shell for this company. Same shape for
every company (see companies/README.md).

```
app/
├── frontend/    HTML+Tailwind screens (module screens render via modules/<id>/view.js today)
├── theme/       per-company Tailwind accent overrides on top of the shared design system
├── atmosphere/  the ambient animation scene — interior room (app/atmosphere/interior-scene.{css,js})
└── backend/     COMPANY-BACKEND-BLUEPRINT.md — the company shell/API spec for the Laravel rebuild
```

Company accent: `#6f9c1c` · route prefix: `/woodart` · 16 modules.
