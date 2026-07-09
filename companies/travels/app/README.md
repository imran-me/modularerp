# Epal Travels & Consultancy — company app shell

The self-contained frontend + backend shell for this company. Same shape for
every company (see companies/README.md).

```
app/
├── frontend/    the standalone HTML+Tailwind pages (this company's mini-app)
├── theme/       per-company Tailwind accent overrides on top of the shared design system
├── atmosphere/  the ambient animation scene — airport (app/atmosphere/travels-scene.{css,js})
└── backend/     COMPANY-BACKEND-BLUEPRINT.md — the company shell/API spec for the Laravel rebuild
```

Company accent: `#2f6bff` · route prefix: `/travels` · 18 modules.
