<?php

namespace Epal\Modules\Woodart\Accounts;

use Epal\Modules\Woodart\Accounts\Http\Requests\StoreRecurringRequest;
use Epal\Modules\Woodart\Accounts\Models\Recurring;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/**
 * Standing monthly costs — serves the frontend `wa_recurring` store.
 *
 * THIN BY DESIGN: validate -> delegate -> shape. Schema::hasTable-guarded,
 * because the live host pulls code before anyone runs migrations.
 *
 * Separate from AccountsController on purpose: that one is a desk over SHARED
 * books and owns no table, while this is ordinary CRUD over the one table this
 * module does own. Mixing them would blur the distinction that matters most
 * about this module.
 *
 * @see backend/endpoints.md
 */
class RecurringController
{
    private const TABLE = 'wa_recurring';
    private const COMPANY = 'woodart';

    /** The demo clock — injected everywhere rather than read from now(). */
    private const TODAY = '2026-07-05';

    /** GET /api/woodart/accounts/recurring — biggest commitment first. */
    public function index(): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => true, 'provisioned' => false, 'count' => 0,
                'summary' => $this->emptySummary(), 'data' => [],
            ]);
        }

        $rows = Recurring::query()
            ->where('company_id', self::COMPANY)
            ->orderByDesc('amount')
            ->get();

        $active = $rows->filter(fn (Recurring $r) => $r->isActive());

        return response()->json([
            'success'     => true,
            'provisioned' => true,
            'count'       => $rows->count(),
            'summary'     => [
                'active'  => $active->count(),
                'monthly' => (int) $active->sum('amount'),
                'due'     => $rows->filter(fn (Recurring $r) => $r->isDueThisMonth(self::TODAY))->count(),
                'paused'  => $rows->count() - $active->count(),
            ],
            'data' => $rows->map(fn (Recurring $r) => [
                'id'         => $r->ext_id,
                'companyId'  => $r->company_id,
                'name'       => $r->name,
                'category'   => $r->category,
                'amount'     => (int) $r->amount,
                'party'      => $r->party,
                'dayOfMonth' => $r->day_of_month,
                'method'     => $r->method,
                'status'     => $r->status,
                'created'    => $r->created_on?->toDateString(),
            ])->values(),
        ]);
    }

    /** POST /api/woodart/accounts/recurring — create or update, keyed on `id`. */
    public function store(StoreRecurringRequest $request): JsonResponse
    {
        if (! Schema::hasTable(self::TABLE)) {
            return response()->json([
                'success' => false,
                'message' => 'wa_recurring table not migrated yet. Run: php artisan migrate',
            ], 503);
        }

        $in = $request->validated();
        $extId = $in['id'] ?? ('REC-WA' . strtoupper(substr(md5((string) mt_rand()), 0, 5)));

        $row = Recurring::updateOrCreate(
            ['company_id' => self::COMPANY, 'ext_id' => $extId],
            [
                'name'         => $in['name'],
                'category'     => $in['category'] ?? null,
                'amount'       => (int) round((float) $in['amount']),
                'party'        => $in['party'] ?? null,
                'day_of_month' => $in['dayOfMonth'] ?? null,
                'method'       => $in['method'] ?? null,
                'status'       => $in['status'] ?? Recurring::ACTIVE,
                'created_on'   => $in['created'] ?? self::TODAY,
            ]
        );

        return response()->json(['success' => true, 'data' => ['id' => $row->ext_id]], 201);
    }

    /**
     * DELETE /api/woodart/accounts/recurring/{id} — soft delete, idempotent.
     *
     * A real delete here is safe in a way voiding a register entry is not: this
     * table holds no money, only the intention to spend it. Entries already
     * posted against the cost stay in the register untouched.
     */
    public function destroy(string $id): JsonResponse
    {
        if (Schema::hasTable(self::TABLE)) {
            Recurring::query()
                ->where('company_id', self::COMPANY)
                ->where('ext_id', $id)
                ->delete();
        }

        return response()->json(['success' => true]);
    }

    private function emptySummary(): array
    {
        return ['active' => 0, 'monthly' => 0, 'due' => 0, 'paused' => 0];
    }
}
