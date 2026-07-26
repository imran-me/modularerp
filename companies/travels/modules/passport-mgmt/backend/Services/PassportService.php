<?php

namespace Epal\Modules\Travels\PassportMgmt\Services;

use Epal\Modules\Travels\PassportMgmt\Models\Passport;
use Illuminate\Support\Collection;

/**
 * PassportService — the business logic for Passport Management, kept OUT of the
 * controller (owner's enterprise-architecture spec: MVC + Service layer). Owns
 * the company-scoped list, the upsert-by-frontend-id, and the soft delete.
 */
class PassportService
{
    /** Passports for a company scope (null = all), ordered by holder name. */
    public function list(?int $companyId): Collection
    {
        return Passport::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderBy('holder')
            ->get();
    }

    /** Create OR update by the frontend id ('PP-<n>'); returns the saved model. */
    public function upsert(array $data, ?int $companyId): Passport
    {
        $id = null;
        if (! empty($data['id']) && preg_match('/(\d+)$/', $data['id'], $m)) {
            $id = (int) $m[1];
        }

        $passport = ($id && Passport::whereKey($id)->exists())
            ? Passport::findOrFail($id)
            : new Passport();

        $passport->fill([
            'holder'      => $data['holder'],
            'passport_no' => $data['passportNo'],
            'type'        => $data['type'] ?? 'E-Passport',
            'nationality' => $data['nationality'] ?? null,
            'dob'         => $data['dob'] ?? null,
            'issue_date'  => $data['issueDate'] ?? null,
            'expiry'      => $data['expiry'] ?? null,
            'phone'       => $data['phone'] ?? null,
        ]);

        if (! $passport->exists) {
            $passport->company_id = $companyId ?? 2;   // 2 = travels (config.js slug map)
        }

        $passport->save();

        return $passport;
    }

    /** Soft-delete by the frontend id ('PP-<n>'). */
    public function delete(string $frontendId): void
    {
        if (preg_match('/(\d+)$/', $frontendId, $m)) {
            Passport::whereKey((int) $m[1])->delete();
        }
    }
}
