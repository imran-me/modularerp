<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_requirements — what a phase needs: material, labour or contracted work.
 *
 * ONE TABLE, THREE KINDS, on purpose. The quotation builder, the material
 * listing, the labour estimate and the cost matrix then read one table with a
 * filter instead of three tables that can disagree about the same job.
 *
 *   material  a quantity of a real material     24 sheet × ৳3,610
 *   labour    man-days at a day rate            (2 men × 6 days) × ৳900
 *   contract  work bought whole, as a lump      1 lot × ৳3,41,000
 *
 * SHAPE NOTES:
 *  - `phase` is the parent; `project` and `space` are DERIVED from it on write,
 *    never trusted from the client, so a line can never claim to belong to a
 *    room it is not in.
 *  - `material_id` is set only for `material` lines whose `item` matches the
 *    register exactly. An unlisted item keeps a null here and is still counted
 *    — the house rule for anything unlisted: counted, never dropped.
 *  - Money is integer Taka (owner decision D10). `amount = qty × unit_cost`,
 *    `quote = qty × unit_sale`, and neither is stored: both are one
 *    multiplication away and a stored total is a total that drifts.
 *  - `status` is the LINE's life (Planned → Quoted → Ordered → Issued), not the
 *    phase's. A phase can be running while half its material is still on order,
 *    and the demand list depends on knowing the difference.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_requirements', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('project', 40);
            $table->string('space', 40);
            $table->string('phase', 40);
            $table->string('kind', 20)->default('material');   // material|labour|contract
            $table->string('code', 60)->nullable();            // wa_cost_codes.ext_id
            $table->string('item', 200);
            $table->string('material_id', 40)->nullable();     // wa_materials.ext_id
            $table->decimal('qty', 14, 2)->default(0);
            $table->string('unit', 30)->nullable();
            $table->unsignedBigInteger('unit_cost')->default(0);
            $table->unsignedBigInteger('unit_sale')->default(0);
            $table->string('status', 20)->default('Planned');  // Planned|Quoted|Ordered|Issued
            $table->text('note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'phase']);
            $table->index(['company_id', 'project', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_requirements');
    }
};
