<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE STOCK LEDGER — the server half of what the SPA gained on 2026-07-27.
 *
 *   wa_locations  where stock sits: workshop, finishing bay, site store
 *   wa_movements  every change: Receipt · Issue · Adjustment · Wastage
 *
 * Created together because they are one feature: a movement without a location
 * is half a record.
 *
 * WHY `wa_materials.stock` STAYS A STORED COLUMN rather than becoming a view
 * over this table: 500+ call sites across the SPA read it synchronously, and
 * the register, the reorder rule and the valuation all lean on it. Deriving it
 * would be a rewrite. Instead MaterialService::applyMovement() writes the row
 * and updates the column inside ONE DB transaction — which is strictly better
 * than the browser can manage — and reconcile() proves the two agree.
 *
 * `qty` is SIGNED: a Receipt is positive, an Issue or Wastage negative, an
 * Adjustment either. The sign is derived from the kind by the service, never
 * trusted from the caller, so a client that got it backwards cannot double
 * stock instead of consuming it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_locations', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 120);
            $table->string('kind', 40)->default('Workshop');
            $table->string('area', 120)->nullable();
            $table->boolean('primary')->default(false);
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
        });

        Schema::create('wa_movements', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('material', 40);              // material EXT id
            $table->string('kind', 30)->default('Receipt');
            $table->integer('qty');                      // SIGNED — see the note above
            $table->string('location', 40)->nullable();  // location EXT id
            $table->string('ref', 60)->nullable();       // the PO / project it moved against
            $table->string('note', 400)->nullable();
            $table->string('by', 160)->nullable();
            $table->date('date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'material']);   // one material's history
            $table->index(['company_id', 'location']);   // the warehouse roll-up
            $table->index(['company_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_movements');
        Schema::dropIfExists('wa_locations');
    }
};
