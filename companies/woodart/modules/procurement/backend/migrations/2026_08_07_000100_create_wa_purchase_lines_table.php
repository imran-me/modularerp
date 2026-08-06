<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_purchase_lines — what a purchase order actually orders.
 *
 * A purchase order stored a supplier, a total and an item COUNT, so "ordered
 * 500 bricks" was not a fact this system held — and a part-delivery of 100 had
 * nothing to be part of (owner, 2026-08-06). A line carries the material and
 * the quantity; the deliveries against it are receipts in the movement ledger,
 * each with its own date. Ordered, received and still-to-come then all read off
 * records instead of being assumed.
 *
 *  - `order` references wa_purchases.ext_id by VALUE, like every other join here
 *  - `material` is wa_materials.ext_id where the item is stocked, null otherwise
 *    (an unlisted item is counted, never dropped)
 *  - money is integer Taka (D10); qty is decimal because sand is bought in
 *    fractions of a truck and rod in fractions of a tonne
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_purchase_lines', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('order', 40);
            $table->string('project', 40)->nullable();
            $table->string('material', 40)->nullable();
            $table->string('item', 200);
            $table->decimal('qty', 14, 2)->default(0);
            $table->string('unit', 30)->nullable();
            $table->unsignedBigInteger('unit_cost')->default(0);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'order']);
            $table->index(['company_id', 'project']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_purchase_lines');
    }
};
