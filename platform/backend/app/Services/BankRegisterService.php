<?php

namespace App\Services;

use App\Exceptions\LedgerException;
use App\Support\CompanySlugs;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * THE BANK REGISTER — an account's own balance and movement history.
 * ----------------------------------------------------------------------------
 * The ledger says "cash went down by 1,250". The register says WHICH account it
 * left, what it now holds, and shows the movement in that account's transaction
 * list. Both books have to move together or Manage Banks stops reconciling with
 * the trial balance (the frontend's reconciliation card measures exactly that
 * gap: GL 1000+1010 minus the sum of the registered account balances).
 *
 * This is the server-side twin of `bankTxnApply()` in the Master Accounts view —
 * ONE implementation per side, used by every desk that moves money:
 *   · balance += / -= the amount (deposit & transfer-in are IN, the rest OUT)
 *   · one row in `bank_transactions` (the "Recent Bank Transactions" log)
 *
 * The log table is created by platform/backend/database/migrations
 * (2026_07_22_100000). Shared hosting denies DDL at request time, so if it is
 * not there yet we still move the balance and skip the log row rather than
 * failing the whole posting — the same soft behaviour BankTxnController has.
 *
 * A cash box IS hard cash on the books: its GL side is 1000, every other kind of
 * account (bank, wallet, card) is 1010. glAccountFor() is the only place that
 * decision is made.
 */
class BankRegisterService
{
    public const IN_TYPES = ['deposit', 'transfer-in', 'opening'];

    /** GL account behind a register account: cash box -> 1000 Cash, else 1010 Bank. */
    public function glAccountFor(object $bank): string
    {
        return ((string) $bank->type === 'cash') ? '1000' : '1010';
    }

    /** The `banks` row for a frontend bank id, or null. Frontend ids are the DB
     *  id (possibly wrapped, e.g. 'BNK-12') — pull the trailing digits, exactly
     *  as BankController does on its write path. */
    public function find(?string $bankRef): ?object
    {
        if (! $bankRef || ! preg_match('/(\d+)$/', $bankRef, $m)) {
            return null;
        }

        return DB::table('banks')->whereNull('deleted_at')->where('id', (int) $m[1])->first() ?: null;
    }

    /** Same, but refuses instead of returning null — and refuses an account that
     *  belongs to another concern than the one paying (a Travels expense cannot
     *  quietly drain a Woodart account). */
    public function requireAccount(?string $bankRef, ?string $ownerSlug = null): object
    {
        $bank = $this->find($bankRef);
        if (! $bank) {
            throw new LedgerException('Unknown payment account: ' . $bankRef);
        }
        if ((int) $bank->status !== 1 || $bank->deleted_at !== null) {
            throw new LedgerException('Payment account "' . $bank->name . '" is not active.');
        }
        if ($ownerSlug !== null && CompanySlugs::slug($bank->company_id) !== $ownerSlug) {
            throw new LedgerException('Account "' . $bank->name . '" belongs to '
                . CompanySlugs::slug($bank->company_id) . ', not to ' . $ownerSlug . '.');
        }

        return $bank;
    }

    /**
     * Move an account's money and log it.
     *
     * @param  object  $bank    a `banks` row (from find()/require())
     * @param  string  $type    deposit | withdraw | transfer-in | transfer-out | opening
     * @param  array   $extra   entryRef (the acc_entries voucher), reversed, clientId
     * @return array            the log row in the frontend `bank_txns` shape
     */
    public function apply(object $bank, string $type, float $amount, string $date,
        string $description = '', string $reference = '', string $glId = '', array $extra = []): array
    {
        if ($amount <= 0) {
            throw new LedgerException('A register movement needs a positive amount.');
        }
        $isIn = in_array($type, self::IN_TYPES, true);
        $now  = now();

        // increment/decrement, not read-modify-write: the balance moves inside the
        // database, so two spends recorded at the same moment can't lose one.
        $account = DB::table('banks')->where('id', $bank->id);
        $isIn ? $account->increment('balance', $amount, ['updated_at' => $now])
              : $account->decrement('balance', $amount, ['updated_at' => $now]);

        $row = [
            'client_id'   => $extra['clientId'] ?? null,
            'bank_ref'    => (string) $bank->id,
            'bank_name'   => $bank->name,
            'type'        => $type,
            'amount'      => $amount,
            'date'        => substr($date ?: $now->toDateString(), 0, 10),
            'reference'   => $reference,
            'description' => $description,
            'gl_id'       => $glId,
            'updated_at'  => $now,
        ];
        // entry_ref / reversed arrived with a later migration — only write them
        // when the columns are there, so an un-migrated host still logs the row.
        if ($this->hasTrailColumns()) {
            $row['entry_ref'] = $extra['entryRef'] ?? null;
            $row['reversed']  = ! empty($extra['reversed']);
        }

        if (Schema::hasTable('bank_transactions')) {
            DB::table('bank_transactions')->insert($row + ['created_at' => $now]);
        }

        return [
            'bankId'   => (string) $bank->id,
            'bankName' => $bank->name,
            'type'     => $type,
            'amount'   => $amount,
            'date'     => $row['date'],
            'desc'     => $description,
            'ref'      => $reference,
            'glId'     => $glId,
            'balance'  => (float) DB::table('banks')->where('id', $bank->id)->value('balance'),
        ];
    }

    /**
     * Give an account its money back for a voucher that was deleted: the
     * opposite movement, logged as its own "Reversal of:" row, and the original
     * row flagged so it cannot be reversed twice. Balances are never silently
     * rewritten — every change to an account's balance has a row explaining it.
     */
    public function reverseFor(string $entryRef, string $note = ''): ?array
    {
        if (! $this->hasTrailColumns()) {
            return null;                       // no entry_ref column -> nothing to find
        }
        $txn = DB::table('bank_transactions')->whereNull('deleted_at')
            ->where('entry_ref', $entryRef)->where('reversed', false)
            ->orderBy('id')->first();
        if (! $txn) {
            return null;
        }
        $bank = $this->find($txn->bank_ref);
        if (! $bank) {
            return null;
        }

        $opposite = in_array($txn->type, self::IN_TYPES, true) ? 'withdraw' : 'deposit';
        $out = $this->apply($bank, $opposite, (float) $txn->amount, now()->toDateString(),
            'Reversal of: ' . ($txn->description ?: $txn->type) . ($note ? ' — ' . $note : ''),
            'REV-' . ($txn->reference ?: $txn->id), $txn->gl_id ?: '',
            ['entryRef' => $entryRef, 'reversed' => true]);

        DB::table('bank_transactions')->where('id', $txn->id)->update(['reversed' => true, 'updated_at' => now()]);

        return $out;
    }

    private function hasTrailColumns(): bool
    {
        try {
            return Schema::hasTable('bank_transactions') && Schema::hasColumn('bank_transactions', 'entry_ref');
        } catch (\Throwable $e) {
            return false;
        }
    }
}
