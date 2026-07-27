<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use Epal\Modules\GroupCockpit\MasterAccounts\Http\Requests\StoreAccEntryRequest;
use Epal\Modules\GroupCockpit\MasterAccounts\Http\Resources\AccEntryResource;
use Epal\Modules\GroupCockpit\MasterAccounts\Services\AccEntryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Account Entries API — serves the frontend `acc_entries` income/expense register.
 * Thin controller over AccEntryService + AccEntryResource; a group-level list the
 * client filters by company. Schema::hasTable-guarded so it no-ops before migrate.
 *
 * NOTE: this persists the REGISTER row only. Its GL posting is a SEPARATE concern
 * — the client mirrors each entry to the ledger and that GL entry persists via
 * JournalController. Keeping the id stable (ext_id) is what keeps the two linked.
 */
class AccEntryController
{
    public function __construct(private AccEntryService $service) {}

    /**
     * Make the register table exist. NEVER throws.
     *
     * Why lazily and not only by migration (live failure, 2026-07-27): every expense
     * on dev.epal.com.bd answered "acc_entries table not migrated yet", the client
     * rolled its optimistic row back, and the whole register read "No entries yet" —
     * the money looked like it had vanished. The migration is still the proper route
     * (2026_07_26_000600), but a deploy that pulls code without running it must not
     * take the register down. Same self-healing pattern as BankTxnController.
     *
     * If the host denies DDL the CREATE fails, we report unavailable, and the caller
     * degrades — exactly as before, just never as an exception.
     */
    private function ensureTable(): bool
    {
        try {
            if (Schema::hasTable('acc_entries')) {
                return true;
            }
            Schema::create('acc_entries', function ($t) {
                $t->id();
                $t->string('ext_id')->unique();             // the frontend id ('JV-…')
                $t->string('company_id')->default('group')->index();
                $t->string('kind')->default('Expense');     // Income | Expense
                $t->decimal('amount', 14, 2)->default(0);
                $t->string('category')->nullable();
                $t->string('sub_category')->nullable();
                $t->string('head')->nullable();             // CoA code the mirror debits/credits
                $t->string('method')->nullable();
                $t->string('bank_id', 40)->nullable()->index();
                $t->string('bank_name')->nullable();
                $t->string('pay_acct', 20)->nullable();
                $t->date('date')->nullable();
                $t->string('party')->nullable();
                $t->string('ref')->nullable();
                $t->text('description')->nullable();
                $t->json('items')->nullable();
                $t->boolean('alloc')->default(false);
                $t->string('funded_by')->nullable();
                $t->string('created')->nullable();
                $t->timestamps();
            });

            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function index(Request $request): JsonResponse
    {
        if (! $this->ensureTable()) {
            return response()->json(['success' => true, 'provisioned' => false, 'count' => 0, 'data' => []]);
        }
        $rows = $this->service->list($request->query('companyId'));

        return response()->json([
            'success' => true,
            'provisioned' => true,
            'count'   => $rows->count(),
            'data'    => AccEntryResource::collection($rows),
        ]);
    }

    public function store(StoreAccEntryRequest $request): JsonResponse
    {
        if (! $this->ensureTable()) {
            // Accept SOFTLY: the entry is valid, the database just isn't ready. A 4xx/5xx
            // here makes the client roll the row back and the user watch their work
            // disappear. Returning success with provisioned:false keeps the register
            // usable browser-side and tells the client the truth.
            return response()->json(['success' => true, 'provisioned' => false,
                'message' => 'Saved in this browser only — the acc_entries table is not migrated yet. Run: php artisan migrate']);
        }
        $saved = $this->service->upsert($request->validated());

        return response()->json(['success' => true, 'data' => new AccEntryResource($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable('acc_entries')) {
            $this->service->delete($id);
        }

        return response()->json(['success' => true]);
    }
}
