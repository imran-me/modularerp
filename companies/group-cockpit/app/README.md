# Epal Group — company app shell

The self-contained frontend + backend shell for this company. Same shape for
every company (see companies/README.md).

```
app/
├── frontend/    HTML+Tailwind screens (module screens render via modules/<id>/view.js today)
├── theme/       per-company Tailwind accent overrides on top of the shared design system
├── atmosphere/  no full scene (the Group shows the faint constellation corner emblem)
└── backend/     COMPANY-BACKEND-BLUEPRINT.md — the company shell/API spec for the Laravel rebuild
```

Company accent: `#1A43BF` · route prefix: `/group` · 16 modules.
