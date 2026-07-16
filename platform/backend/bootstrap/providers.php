<?php

use App\Providers\AppServiceProvider;
use App\Providers\ModuleServiceProvider;

return [
    AppServiceProvider::class,
    // The modular kernel: auto-discovers every companies/**/backend/ folder.
    ModuleServiceProvider::class,
];
