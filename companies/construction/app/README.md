# Epal Construction — company app shell

The self-contained frontend + backend shell for this company. Same shape for
every company (see companies/README.md).

```
app/
├── frontend/    HTML+Tailwind screens (module screens render via modules/<id>/view.js today)
├── theme/       per-company Tailwind accent overrides on top of the shared design system
├── atmosphere/  ambient scene not yet created (a future creative build, like the Travels airport / Woodart interior)
└── backend/     COMPANY-BACKEND-BLUEPRINT.md — the company shell/API spec for the Laravel rebuild
```

Company accent: `#e2721b` · route prefix: `/construction` · 17 modules.
