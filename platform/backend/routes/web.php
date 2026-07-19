<?php

use Illuminate\Support\Facades\Route;

/**
 * The SPA shell.
 * ----------------------------------------------------------------------------
 * The frontend is a single-page, hash-routed app (#/group/dashboard, etc.) —
 * the fragment after # is NEVER sent to the server, so the server only ever
 * needs to answer ONE route correctly: "/". Everything after that is handled
 * client-side by the SPA's own router.
 *
 * We deliberately do NOT rely on Apache's DirectoryIndex to pick between
 * index.php and a symlinked index.html — that's ambiguous across hosts and
 * configs. Instead this route reads the real repo-root index.html directly
 * and returns it, so "/" is unambiguous no matter how the server is set up.
 *
 * A catch-all is added too so any other server-side path (a bookmark to a
 * deep link, a stray reload) still lands on the same shell rather than a
 * Laravel 404 — the client router then resolves the real screen.
 */
Route::get('/{any?}', function () {
    return response()->file(base_path('../../index.html'));
})->where('any', '^(?!api).*$');
