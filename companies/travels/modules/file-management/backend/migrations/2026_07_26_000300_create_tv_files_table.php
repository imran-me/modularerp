<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Visa files — module-owned table for Travels File Management (embassy file
 * tracking). Serves the frontend `tv_files` store. Auto-discovered by
 * ModuleServiceProvider. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tv_files')) {
            return;
        }
        Schema::create('tv_files', function (Blueprint $table) {
            $table->id();
            $table->string('applicant');
            $table->string('passport')->nullable();
            $table->string('country')->nullable();
            $table->string('agent')->nullable();
            $table->date('submit_date')->nullable();
            $table->date('decision_due')->nullable();
            $table->string('embassy_status')->default('Slot Booked');
            $table->decimal('embassy_fee', 14, 2)->default(0);
            $table->decimal('service_fee', 14, 2)->default(0);
            $table->decimal('total', 14, 2)->default(0);
            $table->string('pay_status')->default('Due');
            $table->unsignedBigInteger('company_id')->nullable()->index();
            $table->softDeletes();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tv_files');
    }
};
