<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * wa_phase_templates — the default phase list for a kind of room.
 *
 * DATA, NOT CODE. Adding "Smart Home" to the bedroom sequence is a row here,
 * not a deploy — the same principle the cost-code list already follows. The
 * phases themselves are a JSON list of {name, code} because they are read and
 * written as a whole, are never queried individually, and a second table for
 * five rows a template would be structure for its own sake.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wa_phase_templates', function (Blueprint $table) {
            $table->id();
            $table->string('ext_id', 40);
            $table->string('company_id', 50)->default('woodart');
            $table->string('kind', 40);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->json('phases');
            $table->timestamps();

            $table->unique(['company_id', 'ext_id']);
            $table->unique(['company_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wa_phase_templates');
    }
};
