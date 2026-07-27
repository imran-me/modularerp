#!/usr/bin/env bash
# ==============================================================================
# EPAL GROUP ERP — deploy.sh
# ------------------------------------------------------------------------------
# Run this ON THE SERVER (Hostinger SSH), from inside platform/backend/, after
# every `git pull` that touches the backend. It is IDEMPOTENT — safe to run
# every time, changes nothing that's already correct.
#
# WHAT IT DOES, and why each piece is shaped the way it is:
#
#   1. Symlinks the SPA's static assets into public/ so the same Laravel app
#      serves both the frontend and /api on ONE origin (the owner's directive:
#      "same subdomain for both, like the old ERP" — no CORS, no second host).
#
#      SECURITY-CRITICAL DECISION: platform/backend/ (this folder, containing
#      .env with the real DB password) is NEVER symlinked as a whole. Only
#      platform/'s FRONTEND subfolders are linked individually. Symlinking
#      platform/ wholesale would make platform/backend/.env downloadable at
#      a plain URL — one folder, one leak. companies/ IS safe to link whole
#      (no secrets live there; only frontend view.js + module.json + a
#      backend/ subfolder that Laravel reads via PHP `require`, never HTTP).
#
#   2. Hardens public/.htaccess: denies dotfiles (.env, .git) and denies
#      direct .php access/execution outside Laravel's own front controller —
#      defense in depth on top of (1), not a substitute for it.
#
#   3. composer install --no-dev (vendor/ is gitignored — never committed).
#
#   4. .env: created from .env.example ONLY if missing (never overwrites a
#      live .env with real credentials). You still edit DB_* by hand once.
#
#   5. php artisan key:generate — ONLY if APP_KEY is still empty.
#
#   6. Deliberately NEVER runs `route:cache`. This app discovers module
#      routes live by scanning companies/*/modules/*/backend/ on every
#      request (ModuleServiceProvider) — that's what makes "delete a module
#      folder, its API vanishes immediately" work. route:cache freezes the
#      route table at cache time, which would silently break live
#      drop-in/drop-out until someone remembered to re-cache. Config caching
#      is fine and IS run; route caching is not.
#
#   7. REPORTS pending migrations, and runs them only when you pass --migrate
#      (or MIGRATE=1). Schema ships with the code; a silent mismatch is what
#      made a working expense form answer "Save failed" on the live host.
# ==============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "== 1/7  Frontend asset symlinks into public/ =="
REPO_ROOT="$(realpath ../..)"
declare -A LINKS=(
  [companies]="$REPO_ROOT/companies"
  [favicon.svg]="$REPO_ROOT/favicon.svg"
)
# platform/ subfolders EXCEPT backend — see the security note above.
for d in "$REPO_ROOT"/platform/*/; do
  name="$(basename "$d")"
  [ "$name" = "backend" ] && continue
  LINKS["platform/$name"]="$d"
done

for link in "${!LINKS[@]}"; do
  target="${LINKS[$link]}"
  dest="public/$link"
  mkdir -p "$(dirname "$dest")"
  if [ -L "$dest" ]; then
    # Already a symlink — leave it unless it points somewhere stale.
    [ "$(readlink -f "$dest")" = "$(realpath "$target")" ] && continue
    rm -f "$dest"
  elif [ -e "$dest" ]; then
    echo "  !! public/$link already exists and is NOT a symlink — skipping (remove it by hand if it's stale)"
    continue
  fi
  ln -s "$target" "$dest"
  echo "  linked  public/$link -> $target"
done

echo "== 2/7  Hardening public/.htaccess (dotfiles + stray .php) =="
GUARD_MARK="# EPAL-HARDENING (deploy.sh — do not remove)"
if ! grep -q "$GUARD_MARK" public/.htaccess 2>/dev/null; then
  cat >> public/.htaccess <<'HTACCESS'

# EPAL-HARDENING (deploy.sh — do not remove)
# Defense in depth on top of the symlink boundary in deploy.sh: even though
# platform/backend/ is never linked into public/, block dotfiles and any
# direct .php hit outside Laravel's own front controller (this file's folder).
<FilesMatch "^\.">
    Require all denied
</FilesMatch>
<FilesMatch "\.php$">
    Require all denied
</FilesMatch>
# Laravel's own front controller must stay reachable.
<Files "index.php">
    Require all granted
</Files>
HTACCESS
  echo "  hardening rules appended"
else
  echo "  already hardened"
fi

echo "== 3/7  composer install (production) =="
composer install --no-dev --optimize-autoloader --no-interaction

echo "== 4/7  .env =="
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  !! .env created from .env.example — EDIT DB_DATABASE / DB_USERNAME / DB_PASSWORD now, then re-run this script."
else
  echo "  .env already present — left untouched"
fi

echo "== 5/7  APP_KEY =="
if ! grep -q '^APP_KEY=base64' .env 2>/dev/null; then
  php artisan key:generate --force
else
  echo "  APP_KEY already set"
fi

echo "== 6/7  config cache (route cache is deliberately skipped — see header) =="
php artisan config:clear
php artisan config:cache

# ------------------------------------------------------------------------------
# 7. MIGRATIONS — pending ones are REPORTED always, and run when you ask.
#
#    Why this step exists: the code and the schema ship in the same `git pull`,
#    but this script used to stop at step 6 — so a deploy could leave new columns
#    unmigrated while the new code expected them. That bit us twice (the
#    bank_transactions log, then acc_entries' payment-source columns, where every
#    expense save answered "Save failed" on a feature that worked fine locally).
#    The app degrades gracefully now (it writes those columns only when they
#    exist), but degraded is not the same as done.
#
#    Why it is not automatic: `migrate` alters a LIVE financial database. That is
#    a decision, not a side effect of copying files. So the default only TELLS you
#    what is pending; run it with the flag when you mean it:
#
#        ./deploy.sh --migrate        (or:  MIGRATE=1 ./deploy.sh)
# ------------------------------------------------------------------------------
echo "== 7/7  migrations =="
WANT_MIGRATE="${MIGRATE:-}"
case " $* " in *" --migrate "*) WANT_MIGRATE=1 ;; esac

if [ -n "$WANT_MIGRATE" ]; then
  php artisan migrate --force
else
  PENDING="$(php artisan migrate:status 2>/dev/null | grep -ci 'pending' || true)"
  if [ "${PENDING:-0}" -gt 0 ]; then
    echo "  !! $PENDING migration(s) PENDING — the DB is behind this code."
    echo "     Run:  ./deploy.sh --migrate      (alters the live database — your call)"
  else
    echo "  nothing pending — schema is up to date"
  fi
fi

echo
echo "Done. Verify: curl -s https://THIS_DOMAIN/api/health  should print {\"ok\":true,\"service\":\"epal-kernel\"}"
