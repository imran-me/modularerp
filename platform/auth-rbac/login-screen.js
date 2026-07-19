/* ============================================================================
 * EPAL GROUP ERP  ·  platform/auth-rbac/login-screen.js
 * ----------------------------------------------------------------------------
 * WHAT: THE FRONT DOOR — the pre-boot sign-in gate, shown only in API mode
 *   when no bearer token is stored (or the stored one has gone stale).
 *
 * The app shell never renders behind it: core/app.js checks the token BEFORE
 * booting, so an unauthenticated visitor sees exactly one thing — this card.
 * On success the page reloads; boot then finds the token and hydrates real
 * data. In DEMO mode this file is never invoked at all.
 *
 * Styling uses the existing design-system classes (.input/.btn/tokens) — the
 * stylesheet is already loaded in <head> before any script runs.
 *
 * ==> LARAVEL MAPPING: POST /api/login (kernel AuthController -> Sanctum PAT).
 * ==========================================================================*/
(function (EPAL) {
  'use strict';

  EPAL.loginScreen = {
    show: function () {
      var splash = document.getElementById('boot-splash');
      if (splash) splash.remove();

      var host = document.createElement('div');
      host.id = 'login-gate';
      host.innerHTML =
        '<style>' +
        /* Scoped to the gate; brand values come from the design tokens. */
        '#login-gate{position:fixed;inset:0;display:grid;place-items:center;z-index:999;' +
          'background:radial-gradient(120% 120% at 50% 0%, var(--epal-royal,#123499), var(--epal-abyss,#00072D));}' +
        '#login-gate .lg-card{width:min(400px,92vw);background:var(--surface,#0a1330);border:1px solid var(--border,rgba(142,168,240,.12));' +
          'border-radius:var(--r-lg,18px);padding:34px 30px 28px;box-shadow:0 2px 6px rgba(0,0,0,.5),0 44px 84px -28px rgba(0,4,24,.78);}' +
        '#login-gate .lg-mark{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;margin:0 auto 14px;' +
          'font-family:var(--font-display,Sora,sans-serif);font-weight:800;font-size:26px;color:#dbe4f8;' +
          'background:linear-gradient(135deg,var(--gold,#1A43BF),#0A2472);box-shadow:0 14px 40px -10px var(--gold,#1A43BF);}' +
        '#login-gate h1{font-family:var(--font-display,Sora,sans-serif);font-size:20px;font-weight:700;text-align:center;' +
          'color:var(--text,#eaeefb);margin:0 0 4px;}' +
        '#login-gate .lg-sub{font-size:13px;color:var(--text-dim,#aeb8d0);text-align:center;margin:0 0 22px;}' +
        '#login-gate label{display:block;font-size:12px;font-weight:600;color:var(--text-dim,#aeb8d0);margin:0 0 6px;}' +
        '#login-gate .lg-field{margin-bottom:14px;}' +
        '#login-gate .lg-err{display:none;font-size:12.5px;color:var(--bad,#f0506e);background:rgba(240,80,110,.1);' +
          'border-radius:8px;padding:8px 12px;margin-bottom:14px;}' +
        '#login-gate .btn{width:100%;justify-content:center;}' +
        '#login-gate .lg-foot{font-size:11px;color:var(--text-mute,#808aa2);text-align:center;margin-top:18px;}' +
        '</style>' +
        '<form class="lg-card">' +
          '<div class="lg-mark">E</div>' +
          '<h1>Epal Group ERP</h1>' +
          '<p class="lg-sub">Sign in to your command center</p>' +
          '<div class="lg-err" id="lg-err"></div>' +
          '<div class="lg-field"><label for="lg-email">Email</label>' +
            '<input class="input" id="lg-email" type="email" autocomplete="username" required autofocus /></div>' +
          '<div class="lg-field"><label for="lg-pass">Password</label>' +
            '<input class="input" id="lg-pass" type="password" autocomplete="current-password" required /></div>' +
          '<button class="btn btn-primary" id="lg-go" type="submit">Sign In</button>' +
          '<div class="lg-foot">Connected to the live Epal database</div>' +
        '</form>';
      document.body.appendChild(host);

      var err = host.querySelector('#lg-err'), btn = host.querySelector('#lg-go');
      host.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        err.style.display = 'none';
        btn.disabled = true; btn.textContent = 'Signing in…';
        EPAL.api.login(
          host.querySelector('#lg-email').value.trim(),
          host.querySelector('#lg-pass').value
        ).then(function () {
          btn.textContent = 'Welcome!';
          location.reload();               // boot again — this time with a token
        }, function (ex) {
          btn.disabled = false; btn.textContent = 'Sign In';
          err.textContent = (ex && ex.message === 'unauthenticated')
            ? 'Wrong email or password.'
            : ((ex && ex.body && ex.body.message) || ex.message || 'Could not sign in.');
          err.style.display = 'block';
        });
      });
    }
  };
})(window.EPAL);
