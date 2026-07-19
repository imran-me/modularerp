<?php

namespace Epal\Modules\GroupCockpit\MasterAccounts;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Bank Accounts (Manage Banks).
 * ----------------------------------------------------------------------------
 * Serves the REAL `banks` table in the shape the frontend `banks` store reads
 * (see banksView() in view.js):
 *   old.name            -> name
 *   old.branch_name     -> branch
 *   old.account_name    -> accountName
 *   old.account_type    -> accType   (savings|current|fixed -> Savings/Current/Fixed)
 *   old.type            -> type      (cash -> "Cash Box" so GL 1000 logic fires; else "Bank")
 *   old.routing_number  -> routing
 *   old.account_number  -> account
 *   old.balance         -> balance
 *   old.status(1|0)     -> status    (Active|Inactive)
 *   old.company_id      -> companyId (mapped to the frontend company slug)
 *
 * index() is pure read/translate. store()/destroy() are the write side —
 * `balance` IS a directly user-editable field here (matches the existing
 * frontend form, view.js editBank(): "Current Balance (৳)" is a plain input,
 * not computed), so it is written as given, same as every other field.
 * Soft-deleted (`deleted_at`), matching index()'s whereNull filter.
 */
class BankController
{
    use ScopesToCompany;

    /** DB companies.id -> frontend company slug (matches platform/core/config.js). */
    private function companySlug($id): string
    {
        $map = [
            1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
            5 => 'shop', 6 => 'woodart',
        ];
        return $map[(int) $id] ?? 'group';
    }

    /** Frontend slug -> DB companies.id (inverse of companySlug()). */
    private function companyId(?string $slug): ?int
    {
        $map = [
            'it' => 1, 'travels' => 2, 'construction' => 3, 'group' => 4,
            'shop' => 5, 'woodart' => 6,
        ];
        return $map[$slug] ?? null;
    }

    private function present(object $b): array
    {
        return [
            'id'          => (string) $b->id,
            'name'        => $b->name,
            'branch'      => $b->branch_name,
            'accountName' => $b->account_name,
            'accType'     => ucfirst((string) $b->account_type),
            'type'        => $b->type === 'cash' ? 'Cash Box'
                                : ($b->type === 'bank' ? 'Bank'
                                    : ucwords(str_replace('_', ' ', (string) $b->type))),
            'routing'     => $b->routing_number,
            'account'     => $b->account_number,
            'balance'     => (float) $b->balance,
            'status'      => (int) $b->status === 1 ? 'Active' : 'Inactive',
            'companyId'   => $this->companySlug($b->company_id),
        ];
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('banks')
            ->whereNull('deleted_at')
            ->when($cid, fn ($q) => $q->where('company_id', $cid))   // company user: only their own
            ->orderBy('name')
            ->get();

        return response()->json([
            'success' => true,
            'count'   => $rows->count(),
            'data'    => $rows->map(fn ($b) => $this->present($b))->values(),
        ]);
    }

    /** Create OR update. Frontend ids are inconsistent by design (existing
     *  banks hydrate with the bare numeric DB id; a brand-new one gets a
     *  client-generated 'BNK-<timestamp>' temp id) — pull the trailing digit
     *  run out of whatever id was sent and check if THAT exists. */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'          => 'nullable|string',
            'name'        => 'required|string|max:255',
            'branch'      => 'nullable|string|max:255',
            'accountName' => 'nullable|string|max:255',
            'accType'     => 'nullable|string|max:50',
            'type'        => 'nullable|string|max:50',
            'routing'     => 'nullable|string|max:50',
            'account'     => 'nullable|string|max:50',
            'balance'     => 'nullable|numeric',
            'status'      => 'nullable|in:Active,Inactive',
            'companyId'   => 'nullable|string',
        ]);

        $existingId = null;
        if (!empty($v['id']) && preg_match('/(\d+)$/', $v['id'], $m)) {
            $n = (int) $m[1];
            if ($n > 0 && DB::table('banks')->where('id', $n)->whereNull('deleted_at')->exists()) {
                $existingId = $n;
            }
        }

        // Company-scoped writer: force their own company, refuse another's.
        $scope     = $this->requesterCompanyId($request);
        $companyId = $scope ?: $this->companyId($v['companyId'] ?? null);
        if ($scope && $existingId && (int) DB::table('banks')->where('id', $existingId)->value('company_id') !== $scope) {
            return response()->json(['success' => false, 'message' => 'Forbidden — not your company.'], 403);
        }

        // `type` is a 4-value DB enum; the frontend form offers 5 payment-type
        // options (Bank/bKash/Nagad/Cash Box/Card) — bKash and Nagad are both
        // mobile banking, Card is the closest fit to "digital wallet" in this
        // schema.
        $typeMap = ['Bank' => 'bank', 'bKash' => 'mobile_banking', 'Nagad' => 'mobile_banking',
            'Cash Box' => 'cash', 'Card' => 'digital_wallet'];
        $type = $typeMap[$v['type'] ?? 'Bank'] ?? 'bank';

        // account_number is NOT NULL + UNIQUE in the real table — a Cash Box
        // (which has no real account number) needs a generated placeholder
        // per row, not a fixed one, or a second cash box would collide.
        $accountNumber = $v['account'] ?? ('CASH-' . substr(uniqid(), -8));

        $row = [
            'name'            => $v['name'],
            'branch_name'     => $v['branch'] ?? null,
            'account_name'    => ($v['accountName'] ?? null) ?: $v['name'],   // NOT NULL in the DB (key may be absent)
            'account_type'    => strtolower($v['accType'] ?? 'current'),
            'type'            => $type,
            'routing_number'  => $v['routing'] ?? null,
            'account_number'  => $accountNumber,
            'currency'        => 'BDT',                              // NOT NULL, no frontend field for it — group's only currency today
            'balance'         => $v['balance'] ?? 0,
            'status'          => ($v['status'] ?? 'Active') === 'Active' ? 1 : 0,
            'company_id'      => $companyId,
            'updated_at'      => now(),
        ];

        if ($existingId) {
            DB::table('banks')->where('id', $existingId)->update($row);
            $id = $existingId;
        } else {
            $row['created_at'] = now();
            $id = DB::table('banks')->insertGetId($row);
        }

        $saved = DB::table('banks')->where('id', $id)->first();

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    public function destroy(string $id): JsonResponse
    {
        preg_match('/(\d+)$/', $id, $m);
        $n = (int) ($m[1] ?? 0);
        if ($n > 0) {
            DB::table('banks')->where('id', $n)->update(['deleted_at' => now()]);
        }

        return response()->json(['success' => true]);
    }
}
