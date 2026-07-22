<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bank Transaction log — the "Recent Bank Transactions" list (deposits,
 * withdrawals, transfers). Persists the frontend `bank_txns` store so a bank's
 * movement history survives a reload and appears on every device — not just in
 * the browser that made it.
 *
 * Frontend `bank_txns` shape (bankTxnApply in view.js):
 *   { id:'BTX-…', bankId, bankName, type, amount, date, desc, ref, glId }
 *
 * Self-contained: this log table isn't in the base migrations, so the module
 * CREATEs it on first use (guarded by hasTable) — it works whether or not the
 * deploy runs `artisan migrate`. The frontend's stable id lives in `client_id`
 * and is returned AS the id, so a re-post updates in place (never duplicates)
 * and the client keeps its own id (no swap needed).
 */
class BankTxnController
{
    use ScopesToCompany;

    private function ensureTable(): void
    {
        if (Schema::hasTable('bank_transactions')) {
            return;
        }
        Schema::create('bank_transactions', function ($t) {
            $t->id();
            $t->string('client_id', 40)->nullable()->index();
            $t->string('bank_ref', 64)->nullable()->index();   // the frontend bank id
            $t->string('bank_name', 255)->nullable();
            $t->string('type', 30);
            $t->decimal('amount', 15, 2)->default(0);
            $t->date('date')->nullable();
            $t->string('reference', 255)->nullable();
            $t->text('description')->nullable();
            $t->string('gl_id', 64)->nullable();
            $t->softDeletes();
            $t->timestamps();
        });
    }

    private function shape($r): array
    {
        return [
            'id'       => $r->client_id ?: (string) $r->id,
            'bankId'   => $r->bank_ref,
            'bankName' => $r->bank_name,
            'type'     => $r->type,
            'amount'   => (float) $r->amount,
            'date'     => $r->date,
            'desc'     => $r->description ?: '',
            'ref'      => $r->reference ?: '',
            'glId'     => $r->gl_id ?: '',
        ];
    }

    public function index(Request $request): JsonResponse
    {
        $this->ensureTable();
        $rows = DB::table('bank_transactions')->whereNull('deleted_at')
            ->orderBy('date')->orderBy('id')->get();
        $data = $rows->map(fn ($r) => $this->shape($r))->values();

        return response()->json(['success' => true, 'count' => $data->count(), 'data' => $data]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->ensureTable();
        $v = $request->all();
        $clientId = trim((string) ($v['id'] ?? ''));
        $now = now();

        $row = [
            'client_id'   => $clientId !== '' ? $clientId : null,
            'bank_ref'    => (string) ($v['bankId'] ?? ''),
            'bank_name'   => (string) ($v['bankName'] ?? ''),
            'type'        => (string) ($v['type'] ?? ''),
            'amount'      => (float) ($v['amount'] ?? 0),
            'date'        => substr((string) ($v['date'] ?? $now->toDateString()), 0, 10),
            'reference'   => (string) ($v['ref'] ?? ''),
            'description' => (string) ($v['desc'] ?? ''),
            'gl_id'       => (string) ($v['glId'] ?? ''),
            'updated_at'  => $now,
        ];

        // idempotent by the frontend client id — a re-post updates in place
        $existing = $clientId !== ''
            ? DB::table('bank_transactions')->whereNull('deleted_at')->where('client_id', $clientId)->value('id')
            : null;
        if ($existing) {
            DB::table('bank_transactions')->where('id', $existing)->update($row);
            $dbId = (int) $existing;
        } else {
            $dbId = DB::table('bank_transactions')->insertGetId($row + ['created_at' => $now]);
        }

        return response()->json(['success' => true, 'data' => $this->shape((object) ($row + [
            'id'         => $dbId,
            'client_id'  => $row['client_id'],
        ]))]);
    }

    public function destroy(string $id): JsonResponse
    {
        $this->ensureTable();
        DB::table('bank_transactions')
            ->where(fn ($q) => $q->where('client_id', $id)->orWhere('id', is_numeric($id) ? (int) $id : -1))
            ->update(['deleted_at' => now()]);

        return response()->json(['success' => true]);
    }
}
