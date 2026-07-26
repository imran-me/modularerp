<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts\Database\Seeders;

use Epal\Modules\GroupCockpit\MasterAccounts\Models\PartyType;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Seeds the default group party types (mirrors master-accounts.js seed). Idempotent.
 */
class PartyTypeSeeder extends Seeder
{
    public function run(): void
    {
        if (PartyType::query()->exists()) {
            return;
        }

        foreach (['Customer', 'Vendor', 'Sub-Agent', 'Officer', 'Staff', 'Bank', 'Other'] as $name) {
            PartyType::create([
                'name'       => $name,
                'slug'       => Str::slug($name),
                'company_id' => 'group',
                'maps_to'    => in_array($name, ['Customer'], true) ? 'Customer'
                    : (in_array($name, ['Vendor', 'Sub-Agent'], true) ? 'Supplier' : ''),
            ]);
        }
    }
}
