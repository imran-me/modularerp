<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A POSTED JOURNAL, as the API returns it — one definition, every endpoint.
 * ----------------------------------------------------------------------------
 * Expenses, sales, receipts and inter-company flows all hand back journals, and
 * before this each controller leaked whatever array its service happened to build.
 * That is how response shapes drift: three endpoints, three slightly different
 * "journal" objects, and a client that has to special-case each one.
 *
 * The shape is deliberately the SAME one the SPA's `gl_entries` store reads
 * (see platform/engines-library/ledger.js), so a client can drop a posted journal
 * straight into its cache without translating:
 *
 *   { id, date, companyId, ref, memo, source, sourceId, party,
 *     lines: [ { account: '<code>', dr: number, cr: number, party } ] }
 *
 * `lines` carries account CODES, never database ids — the ledger keys everything by
 * code, and an id would be meaningless to the client.
 *
 * `sourceId` names the DOCUMENT behind the journal, and a line may carry its OWN
 * party so one entry can span several counterparties (2026-07-28). Both are
 * emitted as empty strings when absent, which is what the SPA already treats as
 * "not set" — so a host that has not run the migration reads the same as before.
 */
class JournalResource extends JsonResource
{
    public function toArray($request): array
    {
        $j = is_array($this->resource) ? $this->resource : (array) $this->resource;

        return [
            'id'        => (string) ($j['id'] ?? ''),
            'date'      => $j['date'] ?? null,
            'companyId' => $j['companyId'] ?? null,
            'ref'       => (string) ($j['ref'] ?? ''),
            'memo'      => (string) ($j['memo'] ?? ''),
            'source'    => (string) ($j['source'] ?? 'manual'),
            'sourceId'  => (string) ($j['sourceId'] ?? ''),
            'party'     => (string) ($j['party'] ?? ''),
            'lines'     => array_map(fn ($l) => [
                'account' => (string) ($l['account'] ?? ''),
                'dr'      => round((float) ($l['dr'] ?? 0), 2),
                'cr'      => round((float) ($l['cr'] ?? 0), 2),
                'party'   => (string) ($l['party'] ?? ''),
            ], $j['lines'] ?? []),
        ];
    }
}
