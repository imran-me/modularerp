<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_materials — Woodart's material inventory (boards, laminates, hardware,
 * adhesives, finishes, fabric).
 *
 * SHAPE NOTES a developer needs:
 *  - `ext_id` is the FRONTEND id ('MAT-001'). It is the key the SPA upserts on,
 *    so a re-post of the same record updates instead of duplicating. Unique per
 *    company, not globally — two companies may both use 'MAT-001'.
 *  - `company_id` holds the frontend company SLUG ('woodart'), matching every
 *    other module backend in this repo. It is not a foreign key on purpose: a
 *    company folder can be dropped in or out and its rows must survive.
 *  - Money is stored as an INTEGER number of Taka (owner decision D10 — money
 *    never floats). unsigned, because a negative unit cost is not a thing.
 *  - `stock` is SIGNED: a stock count can legitimately go negative when issues
 *    are recorded before receipts, and hiding that behind an unsigned column
 *    would turn a data problem into a 500.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_materials', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('name', 160);
            $table->string('category', 60)->default('Board');
            $table->string('unit', 20)->default('pcs');
            $table->integer('stock')->default(0);
            $table->unsignedInteger('reorder')->default(0);
            $table->unsignedBigInteger('unit_cost')->default(0);
            $table->string('supplier', 160)->nullable();
            $table->date('created_on')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['company_id', 'ext_id']);
            $table->index(['company_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_materials');
    }
};
