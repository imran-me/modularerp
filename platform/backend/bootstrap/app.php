<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // This app is JSON-API-only — there is no Laravel-rendered login page
        // (the SPA has its own login screen, served as static HTML via
        // routes/web.php). Without this, Laravel's default auth middleware
        // tries to redirect an unauthenticated request to a route named
        // 'login' — which doesn't exist here — and CRASHES with a 500
        // "Route [login] not defined" instead of a clean 401. Telling it
        // there is no redirect destination makes it always throw
        // AuthenticationException, which IS correctly rendered as JSON by
        // the shouldRenderJsonWhen() rule below.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
