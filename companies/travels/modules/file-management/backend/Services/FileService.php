<?php

namespace Epal\Modules\Travels\FileManagement\Services;

use Epal\Modules\Travels\FileManagement\Models\VisaFile;
use Illuminate\Support\Collection;

/**
 * FileService — business logic for embassy File Management: company-scoped list,
 * upsert-by-frontend-id, soft delete. `total` is derived (embassy + service) so
 * it can never drift from its parts.
 */
class FileService
{
    public function list(?int $companyId): Collection
    {
        return VisaFile::query()
            ->when($companyId, fn ($q) => $q->where('company_id', $companyId))
            ->orderByDesc('submit_date')
            ->get();
    }

    public function upsert(array $data, ?int $companyId): VisaFile
    {
        $id = null;
        if (! empty($data['id']) && preg_match('/(\d+)$/', $data['id'], $m)) {
            $id = (int) $m[1];
        }

        $file = ($id && VisaFile::whereKey($id)->exists())
            ? VisaFile::findOrFail($id)
            : new VisaFile();

        $embassy = (float) ($data['embassyFee'] ?? 0);
        $service = (float) ($data['serviceFee'] ?? 0);

        $file->fill([
            'applicant'      => $data['applicant'],
            'passport'       => $data['passport'] ?? null,
            'country'        => $data['country'] ?? null,
            'agent'          => $data['agent'] ?? null,
            'submit_date'    => $data['submitDate'] ?? null,
            'decision_due'   => $data['decisionDue'] ?? null,
            'embassy_status' => $data['embassyStatus'] ?? 'Slot Booked',
            'embassy_fee'    => $embassy,
            'service_fee'    => $service,
            'total'          => $embassy + $service,
            'pay_status'     => $data['payStatus'] ?? 'Due',
        ]);

        if (! $file->exists) {
            $file->company_id = $companyId ?? 2;   // travels
        }

        $file->save();

        return $file;
    }

    public function delete(string $frontendId): void
    {
        if (preg_match('/(\d+)$/', $frontendId, $m)) {
            VisaFile::whereKey((int) $m[1])->delete();
        }
    }
}
