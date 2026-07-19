<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Performance reviews — the real source for an employee's rating (owner chose a
 * real feature over the demo's invented star score). Module-owned: this file
 * lives beside the employees module and is auto-discovered by
 * ModuleServiceProvider; delete the module folder and the table's migration
 * goes with it. Run once on the server: `php artisan migrate`.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('performance_reviews')) {
            return;
        }
        Schema::create('performance_reviews', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();   // the employee (users.id)
            $table->string('period')->nullable();             // e.g. '2026-07' or 'Q2 2026'
            $table->decimal('score', 2, 1)->default(0);        // 0.0 – 5.0
            $table->text('strengths')->nullable();
            $table->text('improvements')->nullable();
            $table->string('reviewer')->nullable();            // who reviewed (name)
            $table->date('reviewed_on')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('performance_reviews');
    }
};
