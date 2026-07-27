/* ============================================================================
 * EPAL GROUP ERP  ·  platform/design-system/tailwind.config.js
 * ----------------------------------------------------------------------------
 * PHASE 1 OF THE MIGRATION — the design LOCK. Every value here is copied
 * verbatim from the live token sheet `assets/css/tokens.css` (the single source
 * of truth) so Tailwind utilities produce exactly today's pixels. Nothing in
 * this file invents a value. See MIGRATION_BRIEF_for_Claude_Code.md §3.
 *
 * ENGINEERING DECISIONS (recorded in MIGRATION_STATUS.md "Decisions"):
 *  · prefix 'tw-'  — base.css already ships utilities NAMED like Tailwind's
 *    (.flex, .hidden, .gap-2=12px vs Tailwind's 0.5rem…). Bare names would let
 *    a converted screen silently restyle unconverted ones. The prefix makes
 *    coexistence safe for the whole screen-by-screen Phase 4; base.css's own
 *    utility block is deleted only after ALL screens are converted (R4).
 *  · preflight OFF — base.css owns the reset; Tailwind's would change pixels.
 *  · THEME-AWARE COLORS AS var() REFERENCES — the app themes via [data-theme]
 *    and the router injects a per-company --accent at runtime. Utilities like
 *    tw-bg-surface therefore reference the CSS variable, not a frozen hex, so
 *    they stay pixel-identical in both themes and under any company accent.
 *    Literal brand hexes are exposed under `epal`/`brand` for places that use
 *    them literally today.
 *
 * BUILD (dev machine only — the OUTPUT is committed, the site stays no-build):
 *   npm run tw:build          # regenerate platform/design-system/css/tailwind.built.css
 *   npm run verify:tw         # PROVE it is safe — run this before committing
 *
 * ⚠️ THE COMMITTED CSS IS THE DEPLOYED CSS. Production is a static git-pull and
 * node never runs there, so a class that is missing from the built file renders
 * unstyled on the live site. `npm run verify:tw` (tools/verify/tailwind.mjs) is
 * the gate that makes this impossible to get wrong. It checks two things:
 *   A. REPRODUCIBLE — a fresh build is byte-identical to the committed file.
 *   B. NO ORPHANS   — every `tw-` class used anywhere in the app has a rule in
 *                     the committed file.
 * Both pass as of 2026-07-27 (17 classes used, 577 bytes, md5 matched on both
 * tailwindcss 3.4.17 and 3.4.19). The version is now pinned EXACTLY (no caret)
 * in package.json so the output cannot drift underneath us.
 * ==========================================================================*/

/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: 'tw-',
  corePlugins: { preflight: false },
  content: [
    './index.html',
    './platform/core/**/*.js', './platform/views/**/*.js', './platform/kit/**/*.js', './platform/auth-rbac/**/*.js', './platform/engines-library/**/*.js',
    './companies/**/*.{html,js}',   // Phase 2+ target folders (empty today)
    // NOTE: platform/design-system/ is deliberately NOT scanned — utility names
    // in these config comments would otherwise generate themselves. Add
    // './platform/<area>/**' globs as real shell files appear in Phase 2.
    // KEEP IN SYNC with the SCAN list in tools/verify/tailwind.mjs — a folder
    // scanned by one and not the other is exactly how an orphan class hides.
  ],

  /* ---- SAFELIST — classes the scanner provably CANNOT see ----------------
   * Tailwind finds classes by scanning source text for literals. A class that
   * JS ASSEMBLES at runtime — `'tw-max-w-[' + w + 'px]'` — never appears as a
   * literal, so it is never generated, and the element ships unstyled.
   *
   * THE RULE, in order of preference:
   *   1. DON'T compose class names. Write the literal and switch between whole
   *      literals: `wide ? 'tw-max-w-[320px]' : 'tw-max-w-[180px]'`. Both are
   *      visible to the scanner and nothing needs to be listed here.
   *   2. If a value is genuinely computed (a percentage width, a derived hue),
   *      it is NOT a utility — set it as an inline style. That is the sanctioned
   *      carve-out in the UI contract for computed values.
   *   3. Only if neither works, add the class here — with a comment naming the
   *      file that builds it, so the entry can be removed when that code changes.
   *
   * EMPTY IS THE HEALTHY STATE. Today the app composes no class names at all
   * (verified 2026-07-27: all 17 `tw-` literals are static), so this list is
   * empty on purpose — an entry here is a small debt, not a feature. */
  safelist: [],
  theme: {
    extend: {
      /* ---- colors: literal brand values (tokens.css:22-42, verbatim) ---- */
      colors: {
        epal: {
          abyss:  '#00072D',
          navy:   '#051650',
          deep:   '#0A2472',
          royal:  '#123499',
          accent: '#1A43BF',
          soft:   '#7E9AE8',
        },
        gold:      '#1A43BF',        // --gold (the brand accent alias)
        goldsoft:  '#7E9AE8',        // --gold-soft
        brand: {
          travels:      '#2f6bff',
          woodart:      '#6f9c1c',
          it:           '#7b5cff',
          shop:         '#e0356e',
          construction: '#e2721b',
        },
        good: '#23c17e',
        warn: '#f4b740',
        bad:  '#f0506e',
        info: '#3b82f6',

        /* ---- theme-aware roles: LIVE var() references (never freeze these —
                they flip with [data-theme] and the runtime --accent) -------- */
        accent:        'var(--accent)',
        bg:            'var(--bg)',
        'bg-2':        'var(--bg-2)',
        surface:       'var(--surface)',
        'surface-2':   'var(--surface-2)',
        'surface-3':   'var(--surface-3)',
        'surface-hi':  'var(--surface-hi)',
        ink:           'var(--text)',
        'ink-dim':     'var(--text-dim)',
        'ink-mute':    'var(--text-mute)',
        line:          'var(--border)',
        'line-strong': 'var(--border-strong)',
        'line-accent': 'var(--border-accent)',
      },

      /* ---- typography (tokens.css:17-19, verbatim stacks) --------------- */
      fontFamily: {
        sans:    ["Inter", "'Plus Jakarta Sans'", 'system-ui', '-apple-system', "'Segoe UI'", 'sans-serif'],
        display: ['Sora', "'Plus Jakarta Sans'", "Inter", 'system-ui', 'sans-serif'],
        mono:    ["'JetBrains Mono'", "'DM Mono'", 'ui-monospace', "'SF Mono'", 'monospace'],
      },

      /* ---- radii (tokens.css:48) ---------------------------------------- */
      borderRadius: {
        xs: '7px', sm: '10px', md: '14px', lg: '18px', xl: '24px', pill: '999px',
      },

      /* ---- motion (tokens.css:51-53) ------------------------------------ */
      transitionTimingFunction: {
        out:   'cubic-bezier(.16,.84,.44,1)',
        inout: 'cubic-bezier(.65,.05,.36,1)',
      },
      transitionDuration: { fast: '140ms', DEFAULT: '240ms', slow: '400ms' },

      /* ---- shadows: theme-aware via the live tokens ---------------------- */
      boxShadow: {
        sm:   'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg:   'var(--shadow-lg)',
        card: 'var(--shadow-card)',
        glow: 'var(--glow)',
      },

      /* ---- layout metrics (tokens.css:56-59) ----------------------------- */
      spacing: {
        rail:    '68px',
        sidebar: '268px',
        topbar:  '62px',
      },
      maxWidth: { content: '1600px' },
    },
  },
  plugins: [],
};
