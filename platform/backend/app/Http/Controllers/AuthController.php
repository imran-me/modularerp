<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Login — kernel-level auth (platform, not a company module).
 * ----------------------------------------------------------------------------
 * Token-based (Sanctum), the same model the old ERP used. Validates the real
 * bcrypt password in the imported `users` table and issues a bearer token the
 * SPA stores and sends on every call.
 *
 * The returned identity carries the SCOPE that drives Group-vs-company views:
 * a super-admin (or a user with no company) sees the whole Group; anyone else
 * is scoped to their own company_id.
 */
class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email'    => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $data['email'])->whereNull('deleted_at')->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['Wrong email or password.'],
            ]);
        }
        // status is a string enum in the real data ('active'/'inactive'), NOT 0/1.
        if (isset($user->status) && in_array((string) $user->status, ['inactive', 'disabled', 'blocked', '0'], true)) {
            throw ValidationException::withMessages([
                'email' => ['This account is disabled.'],
            ]);
        }

        $token = $user->createToken('epal-spa')->plainTextToken;

        return response()->json([
            'success' => true,
            'token'   => $token,
            'user'    => $this->identity($user),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'user'    => $this->identity($request->user()),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['success' => true]);
    }

    /** DB companies.id -> frontend company slug (matches platform/core/config.js
     *  and every module controller). company 4 IS the Group itself. */
    private const COMPANY_SLUG = [
        1 => 'it', 2 => 'travels', 3 => 'construction', 4 => 'group',
        5 => 'shop', 6 => 'woodart',
    ];

    /** The identity + scope the SPA needs to decide Group vs company visibility.
     *  companyId is the frontend SLUG (not the numeric DB id) — the SPA scopes
     *  by slug, so a company user's login lands them in THEIR company. */
    private function identity(User $u): array
    {
        $slug    = self::COMPANY_SLUG[(int) ($u->company_id ?? 0)] ?? null;
        $isGroup = (int) ($u->is_super_admin ?? 0) === 1 || empty($u->company_id) || $slug === 'group';

        return [
            'id'           => $u->id,
            'name'         => $u->name,
            'email'        => $u->email,
            'companyId'    => $isGroup ? 'group' : $slug,
            'isSuperAdmin' => (bool) ($u->is_super_admin ?? false),
            'scope'        => $isGroup ? 'group' : ('company:'.$slug),
        ];
    }
}
