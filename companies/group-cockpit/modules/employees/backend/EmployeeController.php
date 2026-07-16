<?php

namespace Epal\Modules\GroupCockpit\Employees;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Employee Directory.
 * ----------------------------------------------------------------------------
 * Serves the REAL workforce — `users` (97 rows) LEFT JOINed to
 * `employee_profiles` (33 rows) — in the shape the frontend `db.employees()`
 * store expects (see companies/group-cockpit/modules/employees/view.js and
 * platform/data/database.js).
 *
 * This controller is a pure read/translate seam (owner rule: import the DATA,
 * keep the NEW system's shapes). The old relational schema and the flat
 * frontend record differ, so we map here:
 *   users.id / employee_id_no      -> id     (human label / lookup key)
 *   users.name                     -> name
 *   users.email                    -> email
 *   users.phone                    -> phone
 *   users.company_id (numeric)     -> companyId (frontend slug: 'it','travels'…)
 *   departments.name               -> dept / department
 *   designations.name              -> designation
 *   companies.name                 -> company
 *   employee_profiles.joining_date -> joinDate
 *   employee_profiles.salary       -> salary
 *   users.status                   -> status  ('active' drives the Active badge)
 *   users.is_super_admin           -> role    (admin | employee)
 *
 * Every user is returned (LEFT JOIN) so the directory headcount matches the
 * real user base; profile-only fields (salary, dept, joinDate) are null-safe.
 */
class EmployeeController
{
    /**
     * Numeric company_id (real `companies` table) -> frontend company slug
     * used throughout the SPA registry (platform/core/config.js COMPANIES).
     * Unmapped verticals (Manufacturing, Properties) fall back to 'group'.
     */
    private const COMPANY_SLUG = [
        1 => 'it',            // EPAL IT SOLUTIONS
        2 => 'travels',       // EPAL TRAVELS & CONSULTANCY
        3 => 'construction',  // EPAL CONSTRUCTIONS
        4 => 'group',         // EPAL GROUP
        5 => 'shop',          // EPAL ONLINE SHOP
        6 => 'woodart',       // WOOD ART INTERIORS
    ];

    public function index(): JsonResponse
    {
        $rows = DB::table('users as u')
            ->whereNull('u.deleted_at')
            ->leftJoin('employee_profiles as ep', 'ep.user_id', '=', 'u.id')
            ->leftJoin('departments as d', 'd.id', '=', 'ep.department_id')
            ->leftJoin('designations as g', 'g.id', '=', 'ep.designation_id')
            ->leftJoin('companies as c', 'c.id', '=', 'u.company_id')
            ->orderBy('u.name')
            ->get([
                'u.id',
                'u.employee_id_no',
                'u.name',
                'u.email',
                'u.phone',
                'u.company_id',
                'u.status',
                'u.is_super_admin',
                'ep.joining_date',
                'ep.salary',
                'd.name as dept_name',
                'g.name as designation_name',
                'c.name as company_name',
            ]);

        $employees = $rows->map(function ($e) {
            $companyId = self::COMPANY_SLUG[(int) $e->company_id] ?? 'group';
            $dept      = $e->dept_name ?: 'Unassigned';

            return [
                'id'          => $e->employee_id_no ?: ('U-' . $e->id),
                'name'        => $e->name,
                'email'       => $e->email,
                'phone'       => $e->phone,
                'designation' => $e->designation_name ?: '',
                'dept'        => $dept,
                'department'  => $dept,
                'companyId'   => $companyId,
                'company'     => $e->company_name ?: 'Epal Group',
                'role'        => ((int) $e->is_super_admin === 1) ? 'admin' : 'employee',
                'joinDate'    => $e->joining_date,
                'salary'      => (float) $e->salary,
                'status'      => $e->status ?: 'active',
                // Attendance/rating are live-workflow fields the SPA maintains
                // locally; seed defaults so cards/matrices render cleanly.
                'attendance'  => ['present' => 0, 'absent' => 0, 'late' => 0, 'leave' => 0],
                'rating'      => 0,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $employees->count(),
            'data'    => $employees,
        ]);
    }
}
