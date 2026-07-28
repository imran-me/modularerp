<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * THE STANDARD CHART — and the ability to make a missing head exist.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS (a live failure, 2026-07-27): recording a Conveyance expense on
 * dev.epal.com.bd answered
 *
 *      Save failed: Unknown account code: 5600
 *
 * The SPA had already added 5600 to its OWN chart at boot — `ensureExtraAccounts()`
 * in ledger.js quietly tops up the heads the app needs (5500 Office & Admin, 5550
 * Food & Entertainment, 5600 Conveyance, 5800 Misc, 5350 Agent Commission, 4050
 * Contract, 2130 VAT, 2140 AIT/TDS). The DATABASE's `accounts` table is the imported
 * production chart and never got them, so the browser could post to 5600 while the
 * API refused it. Every expense on those heads failed, and the register showed
 * nothing at all because the failed save rolled the row back.
 *
 * So the server needs the same top-up the client has always done. ensure() INSERTS a
 * missing head — a definition, never a posting — and only for codes on the standard
 * chart below. An arbitrary code is still refused: silently inventing accounts because
 * a caller typo'd is how a chart of accounts turns to mush.
 *
 * Kept in step with ledger.js STANDARD_COA + ensureExtraAccounts(). If you add a head
 * to one, add it to the other.
 */
class ChartOfAccounts
{
    /** code => [name, type] — the chart the application assumes exists. */
    public const STANDARD = [
        // assets
        '1000' => ['Cash', 'asset'],
        '1010' => ['Bank', 'asset'],
        '1150' => ['Sub-Agent Receivable', 'asset'],
        // money prepaid to a GDS / booking portal is OURS until a booking spends it
        // — a prepayment asset, one sub-account per portal (SPA 2026-07-28)
        '1180' => ['Portal & GDS Wallets', 'asset'],
        '1200' => ['Accounts Receivable', 'asset'],
        '1250' => ['Employee Advances', 'asset'],
        '1260' => ['Staff Loans', 'asset'],
        '1300' => ['Inter-company Receivable', 'asset'],
        '1400' => ['Inventory', 'asset'],
        '1500' => ['Fixed Assets', 'asset'],
        // liabilities
        '2000' => ['Accounts Payable', 'liability'],
        '2050' => ['BSP Payable', 'liability'],
        '2100' => ['Salaries Payable', 'liability'],
        '2130' => ['VAT Payable', 'liability'],
        '2140' => ['AIT & TDS Payable', 'liability'],
        '2200' => ['VAT Payable', 'liability'],
        '2300' => ['Customer Advances', 'liability'],
        '2400' => ['Inter-company Payable', 'liability'],
        // equity
        '3000' => ['Owner Equity', 'equity'],
        '3100' => ['Retained Earnings', 'equity'],
        // income
        '4000' => ['Sales Revenue', 'income'],
        '4010' => ['Air Ticket Sales', 'income'],
        '4020' => ['Visa Services', 'income'],
        '4030' => ['Package & Tour', 'income'],
        '4040' => ['Hotel & Other Travel', 'income'],
        '4050' => ['Contract Flights & Files', 'income'],
        '4100' => ['Commission Income', 'income'],
        '4900' => ['Other Income', 'income'],
        // expenses
        '5000' => ['Cost of Sales', 'expense'],
        '5100' => ['Salaries', 'expense'],
        '5200' => ['Rent', 'expense'],
        '5300' => ['Utilities', 'expense'],
        '5350' => ['Agent Commission', 'expense'],
        '5400' => ['Marketing', 'expense'],
        '5500' => ['Office & Admin', 'expense'],
        '5550' => ['Food & Entertainment', 'expense'],
        '5600' => ['Conveyance & Travel', 'expense'],
        '5700' => ['IT & Software', 'expense'],
        '5800' => ['Miscellaneous Expenses', 'expense'],
        '5900' => ['Penalties & ADM', 'expense'],
        '6000' => ['Bank Charges & Fees', 'expense'],
    ];

    /** Codes present in `accounts`, cached for the request. */
    private ?array $have = null;

    public function exists(string $code): bool
    {
        return in_array($code, $this->codes(), true);
    }

    /**
     * Is this code a SUB-ACCOUNT of a standard head — '1010-4', '1180-PRT-2'?
     *
     * Only a code whose prefix (up to the first dash) is itself a standard account
     * qualifies, and only when the remainder looks like an id rather than prose.
     * Returns [parentCode, name, type] or null.
     */
    private function subAccountOf(string $code): ?array
    {
        $dash = strpos($code, '-');
        if ($dash === false || $dash === 0) {
            return null;
        }
        $parent = substr($code, 0, $dash);
        $suffix = substr($code, $dash + 1);
        if (! isset(self::STANDARD[$parent]) || $suffix === '') {
            return null;
        }
        if (! preg_match('/^[A-Za-z0-9_-]{1,40}$/', $suffix)) {
            return null;                         // not an id — do not invent it
        }
        [$parentName, $type] = self::STANDARD[$parent];

        return [$parent, $parentName . ' · ' . $suffix, $type];
    }

    /** The row id of a code, or null. */
    private function idOf(string $code): ?int
    {
        try {
            $id = DB::table('accounts')->where('code', $code)->whereNull('deleted_at')->value('id');

            return $id ? (int) $id : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Make sure this head exists, and say whether it does now.
     * Only tops up codes on the STANDARD chart; anything else is left to fail loudly.
     * INSERT only — no DDL — so it works on a host that denies schema changes at
     * request time, which is exactly the host this was written for.
     */
    public function ensure(string $code): bool
    {
        $code = trim($code);
        if ($this->exists($code)) {
            return true;
        }

        $parentCode = null;
        if (isset(self::STANDARD[$code])) {
            [$name, $type] = self::STANDARD[$code];
        } elseif ($sub = $this->subAccountOf($code)) {
            // A SUB-ACCOUNT OF A STANDARD HEAD — '1010-4' is bank account 4 under
            // 1010 Bank, '1180-PRT-2' is one portal wallet under 1180. The SPA gives
            // every real bank, cash box and portal wallet its own code so the ledger
            // says WHICH account holds the money; those codes are derived, not typed,
            // so topping them up is safe in a way inventing an arbitrary code is not.
            // (Live 2026-07-28: every save failed with "Unknown account code: 1010-4"
            // until this existed.) The name is a placeholder — the SPA pushes the real
            // account name through the chart-of-accounts endpoint.
            [$parentCode, $name, $type] = $sub;
        } else {
            return false;                       // not ours to invent
        }

        try {
            if (! Schema::hasTable('accounts')) {
                return false;
            }
            $row = ['code' => $code, 'name' => $name, 'type' => $type];
            // the live `accounts` table is the imported production one; fill only the
            // columns it actually has, and satisfy the NOT NULL ones it is known to
            // carry (status, opening_balance) rather than guessing a full schema
            foreach ([
                'status' => 1,
                'opening_balance' => 0,
                // a derived sub-account hangs under its control account, so the
                // production chart carries the same tree the SPA shows
                'parent_id' => $parentCode ? $this->idOf($parentCode) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ] as $col => $val) {
                if (Schema::hasColumn('accounts', $col)) {
                    $row[$col] = $val;
                }
            }
            DB::table('accounts')->insert($row);
            $this->have = null;                 // re-read next time

            return true;
        } catch (\Throwable $e) {
            return false;                       // stay refused, with the clear message
        }
    }

    /** Top the whole standard chart up at once. Returns the codes it added. */
    public function ensureAll(): array
    {
        $added = [];
        foreach (array_keys(self::STANDARD) as $code) {
            if (! $this->exists($code) && $this->ensure($code)) {
                $added[] = $code;
            }
        }

        return $added;
    }

    private function codes(): array
    {
        if ($this->have === null) {
            try {
                $this->have = Schema::hasTable('accounts')
                    ? DB::table('accounts')->whereNull('deleted_at')->pluck('code')->map(fn ($c) => (string) $c)->all()
                    : [];
            } catch (\Throwable $e) {
                $this->have = [];
            }
        }

        return $this->have;
    }
}
