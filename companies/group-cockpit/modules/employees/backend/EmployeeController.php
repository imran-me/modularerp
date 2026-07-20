<?php

namespace Epal\Modules\GroupCockpit\Employees;

use App\Support\ScopesToCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

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
    use ScopesToCompany;

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

    /** Standard working hours in a day — overtime is time worked BEYOND this. */
    private const STANDARD_DAY_HOURS = 9;

    /**
     * Per-user attendance for the LATEST month that has data, keyed by user_id.
     * Each entry carries the status tallies (present/absent/leave) AND the real
     * worked hours: 'hours' (Σ check_out−check_in over the month) and 'overtime'
     * (Σ of each day's hours beyond the 9h standard). One calendar month matches
     * what the cards show; all-time totals would misrepresent them. `late` has
     * no value in the real status enum (present|absent|leave|holiday) so it
     * stays 0.
     */
    private function attendanceByUser(): array
    {
        $latest = DB::table('attendances')->max('date');
        if (! $latest) {
            return [];
        }
        $ym = substr((string) $latest, 0, 7);   // 'YYYY-MM'
        $out = [];

        // Status counts (present / absent / leave / holiday).
        $counts = DB::table('attendances')
            ->whereRaw("DATE_FORMAT(date, '%Y-%m') = ?", [$ym])
            ->select('user_id', 'status', DB::raw('count(*) as cnt'))
            ->groupBy('user_id', 'status')
            ->get();
        foreach ($counts as $r) {
            $out[(int) $r->user_id][$r->status] = (int) $r->cnt;
        }

        // Worked hours + overtime from the real check_in/check_out times.
        // TIMEDIFF handles same-day shifts; only rows with both punches count.
        $std = self::STANDARD_DAY_HOURS;
        $hours = DB::table('attendances')
            ->whereRaw("DATE_FORMAT(date, '%Y-%m') = ?", [$ym])
            ->whereNotNull('check_in')
            ->whereNotNull('check_out')
            ->select(
                'user_id',
                DB::raw('SUM(TIME_TO_SEC(TIMEDIFF(check_out, check_in)))/3600 AS total_hours'),
                DB::raw("SUM(GREATEST(0, TIME_TO_SEC(TIMEDIFF(check_out, check_in))/3600 - {$std})) AS overtime_hours")
            )
            ->groupBy('user_id')
            ->get();
        foreach ($hours as $r) {
            $out[(int) $r->user_id]['hours'] = round((float) $r->total_hours, 1);
            $out[(int) $r->user_id]['overtime'] = round((float) $r->overtime_hours, 1);
        }

        return $out;
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->requesterCompanyId($request);
        $rows = DB::table('users as u')
            ->whereNull('u.deleted_at')
            ->when($cid, fn ($q) => $q->where('u.company_id', $cid))   // company user: only their own people
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

        $att = $this->attendanceByUser();

        $employees = $rows->map(function ($e) use ($att) {
            $companyId = self::COMPANY_SLUG[(int) $e->company_id] ?? 'group';
            $dept      = $e->dept_name ?: 'Unassigned';
            $a         = $att[(int) $e->id] ?? [];

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
                // Present/Absent/Leave + worked hours are REAL, from the
                // `attendances` table (latest month). `late` and `rating` have
                // no source column (the demo invented them) — left 0 until a
                // real late-tracking / performance-review source exists.
                'attendance'  => [
                    'present' => $a['present'] ?? 0,
                    'absent'  => $a['absent'] ?? 0,
                    'late'    => 0,
                    'leave'   => $a['leave'] ?? 0,
                ],
                // Monthly worked hours and overtime (>9h/day), REAL from punches.
                'hours'       => $a['hours'] ?? 0,
                'overtime'    => $a['overtime'] ?? 0,
                'rating'      => 0,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'count'   => $employees->count(),
            'data'    => $employees,
        ]);
    }

    /**
     * DAY-BASIS attendance totals for the KPI strip (Present / Absent / Late /
     * On Leave) — one calendar date, across the requester's visible workforce.
     * The real `attendances` status enum is present|absent|leave|holiday (no
     * 'late'), so Late is DERIVED: a present punch whose check-in is after the
     * grace cutoff (default 09:15) is a late arrival (still counted present).
     *   GET group/employees/attendance?date=YYYY-MM-DD   (date defaults to today)
     */
    public function attendanceByDate(Request $request): JsonResponse
    {
        $date   = $request->query('date') ?: now()->toDateString();
        $cutoff = $request->query('lateAfter') ?: '09:15:00';
        $cid    = $this->requesterCompanyId($request);

        $rows = DB::table('attendances as a')
            ->join('users as u', 'u.id', '=', 'a.user_id')
            ->whereNull('u.deleted_at')
            ->when($cid, fn ($q) => $q->where('u.company_id', $cid))
            ->whereDate('a.date', $date)
            ->get(['a.status', 'a.check_in']);

        $present = 0; $absent = 0; $leave = 0; $late = 0;
        foreach ($rows as $r) {
            if ($r->status === 'present') {
                $present++;
                $t = $r->check_in ? date('H:i:s', strtotime((string) $r->check_in)) : null;
                if ($t && $t > $cutoff) {
                    $late++;
                }
            } elseif ($r->status === 'absent') {
                $absent++;
            } elseif ($r->status === 'leave') {
                $leave++;
            }
        }

        return response()->json([
            'success' => true,
            'date'    => $date,
            'totals'  => ['present' => $present, 'absent' => $absent, 'late' => $late, 'leave' => $leave],
        ]);
    }

    private function present(object $e): array
    {
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
            'attendance'  => ['present' => 0, 'absent' => 0, 'late' => 0, 'leave' => 0],
            'rating'      => 0,
        ];
    }

    /** Find a departments/designations row by name, or create one — the
     *  frontend form collects both as free text but the real schema requires
     *  a foreign key, so this is the translation. Small lookup tables, no
     *  fan-out risk. */
    private function lookupId(string $table, ?string $name): ?int
    {
        $name = trim((string) $name);
        if ($name === '') {
            return null;
        }
        $row = DB::table($table)->where('name', $name)->first('id');
        if ($row) {
            return $row->id;
        }

        return DB::table($table)->insertGetId([
            'name' => $name, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function selfRow(Request $request): ?object
    {
        $id = $request->user()?->id;

        return $id ? DB::table('users')->where('id', $id)->first(['id', 'company_id', 'is_super_admin']) : null;
    }

    /** Create OR update. `users` is ALSO the login table (Sanctum auth reads
     *  it directly), so writes here are deliberately narrow:
     *  - a create gets a generated username + an unusable random password
     *    (Str::random hashed) — the row exists but cannot log in; real
     *    employee login is separate, later work (see CONTEXT.md Phase D).
     *  - an update NEVER touches username/password/email_verified_at for an
     *    EXISTING row, only the profile-ish fields the form actually edits.
     *  - `role` (admin vs employee -> is_super_admin) can only be escalated
     *    by a requester who is ALREADY an admin (company_id IS NULL or
     *    is_super_admin=1) — the frontend already hides this control from
     *    non-admins, but that is a client-side-only guard and this endpoint
     *    must not trust it; a non-admin's role field is silently ignored. */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'id'          => 'nullable|string',
            'name'        => 'required|string|max:255',
            'email'       => 'nullable|email|max:255',
            'phone'       => 'nullable|string|max:50',
            'companyId'   => 'nullable|string',
            'dept'        => 'nullable|string|max:255',
            'designation' => 'nullable|string|max:255',
            'role'        => 'nullable|string|max:50',
            'joinDate'    => 'nullable|date',
            'salary'      => 'nullable|numeric',
            'status'      => 'nullable|string|max:50',
        ]);

        $existingId = null;
        if (!empty($v['id'])) {
            if (preg_match('/^U-(\d+)$/', $v['id'], $m)) {
                $existingId = DB::table('users')->where('id', (int) $m[1])->whereNull('deleted_at')->exists() ? (int) $m[1] : null;
            } else {
                $row = DB::table('users')->where('employee_id_no', $v['id'])->whereNull('deleted_at')->first('id');
                $existingId = $row?->id;
            }
        }

        $self       = $this->selfRow($request);
        $requesterIsAdmin = $self && ((int) $self->is_super_admin === 1 || $self->company_id === null);
        $companyId  = array_search($v['companyId'] ?? null, self::COMPANY_SLUG, true) ?: null;

        // Company-scoped writer: force their own company, refuse editing
        // another company's employee (super-admin / Group user is unrestricted).
        $scope = $this->requesterCompanyId($request);
        if ($scope) {
            $companyId = $scope;
            if ($existingId && (int) DB::table('users')->where('id', $existingId)->value('company_id') !== $scope) {
                return response()->json(['success' => false, 'message' => 'Forbidden — not your company.'], 403);
            }
        }

        if ($existingId) {
            $row = ['name' => $v['name']];
            // Only overwrite email when the form actually carries one — `email` is
            // NOT NULL, so writing a blank/null would break the update (and you
            // cannot "clear" a login email anyway).
            if (! empty($v['email'])) $row['email'] = $v['email'];
            if (array_key_exists('phone', $v)) $row['phone'] = $v['phone'];
            if ($companyId) $row['company_id'] = $companyId;
            if (!empty($v['status'])) $row['status'] = $v['status'];
            if ($requesterIsAdmin && !empty($v['role'])) {
                $row['is_super_admin'] = in_array($v['role'], ['owner', 'admin'], true) ? 1 : 0;
            }
            $row['updated_at'] = now();
            DB::table('users')->where('id', $existingId)->update($row);

            $profile = [];
            $deptId = $this->lookupId('departments', $v['dept'] ?? null);
            $desigId = $this->lookupId('designations', $v['designation'] ?? null);
            if ($deptId) $profile['department_id'] = $deptId;
            if ($desigId) $profile['designation_id'] = $desigId;
            if (array_key_exists('salary', $v)) $profile['salary'] = $v['salary'];
            if (!empty($profile)) {
                $profile['updated_at'] = now();
                $exists = DB::table('employee_profiles')->where('user_id', $existingId)->exists();
                if ($exists) {
                    DB::table('employee_profiles')->where('user_id', $existingId)->update($profile);
                } else {
                    // department_id/designation_id are NOT NULL — an existing
                    // user with no profile row yet still needs both filled.
                    DB::table('employee_profiles')->insert($profile + [
                        'user_id' => $existingId, 'joining_date' => $v['joinDate'] ?? now()->toDateString(),
                        'department_id' => $deptId ?? $this->lookupId('departments', 'Unassigned'),
                        'designation_id' => $desigId ?? $this->lookupId('designations', 'Staff'),
                        'employment_type' => 'full_time', 'created_at' => now(),
                    ]);
                }
            }
            $id = $existingId;
        } else {
            // department_id/designation_id are NOT NULL on employee_profiles —
            // fall back to a generic bucket when the caller doesn't send one
            // (find-or-create keeps this a single shared row, not one per hire).
            $deptId = $this->lookupId('departments', $v['dept'] ?? null) ?? $this->lookupId('departments', 'Unassigned');
            $desigId = $this->lookupId('designations', $v['designation'] ?? null) ?? $this->lookupId('designations', 'Staff');

            // Two inserts (users + employee_profiles) must succeed together —
            // a profile-insert failure must not leave an orphaned login-table
            // row behind (caught by testing: it did, before this transaction).
            $id = DB::transaction(function () use ($v, $companyId, $requesterIsAdmin, $deptId, $desigId) {
                $username = Str::slug($v['name']) . '-' . substr(uniqid(), -6);
                // `users.email` is UNIQUE and NOT NULL (it is the login table). The
                // Add-Employee form allows a blank email, so synthesise a unique
                // placeholder when it is empty — otherwise MySQL rejects the insert
                // ("Column 'email' cannot be null") and the whole add silently rolls
                // back client-side. Mirrors the unusable-password approach: the row
                // exists but cannot log in until real credentials are set later.
                $email = ! empty($v['email']) ? $v['email'] : $username . '@no-email.epal.local';
                $newId = DB::table('users')->insertGetId([
                    'name'           => $v['name'],
                    'email'          => $email,
                    'phone'          => $v['phone'] ?? null,
                    'company_id'     => $companyId,
                    'status'         => $v['status'] ?? 'active',
                    'username'       => $username,
                    'password'       => Hash::make(Str::random(40)),   // unusable placeholder — real login is separate, later work
                    'is_super_admin' => ($requesterIsAdmin && in_array($v['role'] ?? '', ['owner', 'admin'], true)) ? 1 : 0,
                    'employee_id_no' => 'EPL-' . $username,
                    'created_at'     => now(), 'updated_at' => now(),
                ]);

                DB::table('employee_profiles')->insert([
                    'user_id'         => $newId,
                    'joining_date'    => $v['joinDate'] ?? now()->toDateString(),
                    'salary'          => $v['salary'] ?? 0,
                    'department_id'   => $deptId,
                    'designation_id'  => $desigId,
                    'employment_type' => 'full_time',
                    'created_at'      => now(), 'updated_at' => now(),
                ]);

                return $newId;
            });
        }

        $saved = DB::table('users as u')
            ->whereNull('u.deleted_at')
            ->leftJoin('employee_profiles as ep', 'ep.user_id', '=', 'u.id')
            ->leftJoin('departments as d', 'd.id', '=', 'ep.department_id')
            ->leftJoin('designations as g', 'g.id', '=', 'ep.designation_id')
            ->leftJoin('companies as c', 'c.id', '=', 'u.company_id')
            ->where('u.id', $id)
            ->first(['u.id', 'u.employee_id_no', 'u.name', 'u.email', 'u.phone', 'u.company_id', 'u.status',
                'u.is_super_admin', 'ep.joining_date', 'ep.salary', 'd.name as dept_name',
                'g.name as designation_name', 'c.name as company_name']);

        return response()->json(['success' => true, 'data' => $this->present($saved)]);
    }

    /** Soft-delete only (this is the login table — a hard delete of a `users`
     *  row would cascade oddly against anything still referencing it).
     *  GUARDED: a super-admin is a LOGIN account, and so is the requester —
     *  deleting the super-admin from the workforce soft-deleted the login row
     *  and locked everyone out (real incident 2026-07-20). Both are refused. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $userId = null;
        if (preg_match('/^U-(\d+)$/', $id, $m)) {
            $userId = (int) $m[1];
        } else {
            $row = DB::table('users')->where('employee_id_no', $id)->first('id');
            $userId = $row?->id;
        }
        if ($userId) {
            $target = DB::table('users')->where('id', $userId)->first(['is_super_admin']);
            if ($target && (int) $target->is_super_admin === 1) {
                return response()->json(['success' => false, 'message' => 'A super-admin is a login account and cannot be deleted from the workforce.'], 403);
            }
            if ((int) $userId === (int) ($request->user()->id ?? 0)) {
                return response()->json(['success' => false, 'message' => 'You cannot delete your own account.'], 403);
            }
            DB::table('users')->where('id', $userId)->update(['deleted_at' => now()]);
        }

        return response()->json(['success' => true]);
    }
}
