<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Party types — module-owned lookup for Master Accounts (Customer / Vendor /
 * Sub-Agent / Officer / Staff / Bank / Other, per company). Serves the frontend
 * `party_types` store. company_id is the frontend company SLUG ('group', 'travels'
 * …) because this lookup is scoped/filtered by slug on the client. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('party_types')) {
            return;
        }
        Schema::create('party_types', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->nullable();
            $table->string('company_id')->default('group')->index();  // frontend slug
            $table->string('maps_to')->nullable();                    // '', 'Customer', 'Supplier'
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('party_types');
    }
};
