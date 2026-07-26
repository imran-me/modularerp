<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marketing — module-owned stores for the Marketing & Messaging desk:
 * tv_campaigns (broadcast campaigns + delivery stats), tv_templates (message
 * templates), tv_messages (the send-log delivery ledger), tv_bot_bookings (bot-
 * captured bookings), tv_bot_chat (the demo chat transcript). Document-style
 * (ext_id / company_id / status columns + full record in `data` JSON) so the
 * exact store shape round-trips. Run: php artisan migrate
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['tv_campaigns', 'tv_templates', 'tv_messages', 'tv_bot_bookings', 'tv_bot_chat'] as $t) {
            if (Schema::hasTable($t)) {
                continue;
            }
            Schema::create($t, function (Blueprint $table) {
                $table->id();
                $table->string('ext_id')->unique();
                $table->string('company_id')->nullable()->index();
                $table->string('status')->nullable();
                $table->json('data');
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        foreach (['tv_bot_chat', 'tv_bot_bookings', 'tv_messages', 'tv_templates', 'tv_campaigns'] as $t) {
            Schema::dropIfExists($t);
        }
    }
};
