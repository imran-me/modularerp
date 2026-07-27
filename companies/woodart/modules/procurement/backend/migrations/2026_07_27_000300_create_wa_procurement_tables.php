<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Procurement owns TWO tables, created together because they are one feature
 * and must arrive or leave as a unit (drop the module folder → both go).
 *
 *   wa_vendors   — who Woodart buys from
 *   wa_purchases — the purchase orders raised on them
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('VEN-001' / 'WPO-001') and the upsert key,
 *    unique PER COMPANY.
 *  - `company_id` holds the frontend company SLUG ('woodart'). Not a foreign
 *    key on purpose — a company folder must be droppable.
 *  - **A purchase order stores the vendor by NAME (`supplier`), not by id.**
 *    That is how the existing `wa_purchases` store was already built and this
 *    module does not get to rewrite it (R2). The column is INDEXED because the
 *    spend roll-up joins on it. See LARAVEL-BLUEPRINT § Known gaps for the
 *    migration path to a real foreign key.
 *  - Money is an INTEGER number of Taka (owner decision D10). `amount` is
 *    unsigned — a negative purchase order is a credit note, which is a
 *    different document, not a negative order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_vendors', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 160);
            $table->string('category', 60)->default('General');
            $table->string('contact', 160)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('email', 160)->nullable();
            $table->string('area', 120)->nullable();
            $table->string('terms', 40)->nullable();
            $table->date('since')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'name']);       // the order→vendor join
            $table->index(['company_id', 'category']);   // the spend roll-up
        });

        Schema::create('wa_purchases', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('supplier', 160);             // vendor NAME — see the note above
            $table->unsignedInteger('items')->default(0);
            $table->unsignedBigInteger('amount')->default(0);
            $table->string('status', 30)->default('Ordered');
            $table->date('date')->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'supplier']);
            $table->index(['company_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_purchases');
        Schema::dropIfExists('wa_vendors');
    }
};
