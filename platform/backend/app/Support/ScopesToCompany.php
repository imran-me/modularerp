<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * Per-company data isolation for module controllers.
 * ----------------------------------------------------------------------------
 * A company-scoped user (e.g. a Travels manager) must not receive OTHER
 * companies' rows from the API — the SPA hydrates everything at boot, so
 * without this a company login could read every concern's financials off the
 * network tab even though the UI hides them. This trait answers: "which
 * company_id is THIS request limited to?" — null means no limit (a Group user
 * or a super-admin sees everything, unchanged).
 *
 * Companies are the real `companies` rows; id 4 IS the Group itself, so a
 * company_id of 4 (or none) is treated as Group-wide.
 *
 * Usage in a module controller:
 *   use App\Support\ScopesToCompany;   // import
 *   class XController { use ScopesToCompany;
 *     public function index(Request $r) {
 *       $cid = $this->requesterCompanyId($r);
 *       DB::table('x')->when($cid, fn ($q) => $q->where('company_id', $cid))->get();
 *   } }
 */
trait ScopesToCompany
{
    /** DB companies.id the requester is limited to, or null = sees everything. */
    protected function requesterCompanyId(Request $request): ?int
    {
        $u = $request->user();
        if (! $u) {
            return null;
        }
        if ((int) ($u->is_super_admin ?? 0) === 1) {
            return null;                       // super-admin sees all
        }
        $cid = (int) ($u->company_id ?? 0);

        return ($cid === 0 || $cid === 4) ? null : $cid;   // no company / Group = all
    }

    /** True when the requester may act on rows belonging to $companyId. Used by
     *  write paths so a company user can't create/edit another company's data. */
    protected function requesterMayTouch(Request $request, $companyId): bool
    {
        $scope = $this->requesterCompanyId($request);

        return $scope === null || (int) $companyId === $scope;
    }
}
