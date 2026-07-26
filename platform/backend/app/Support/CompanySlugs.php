<?php

namespace App\Support;

/**
 * THE ONE company-slug ↔ companies.id map.
 * ----------------------------------------------------------------------------
 * The SPA keys every record by a company SLUG ('travels', 'group', …) — that is
 * what `platform/core/config.js` registers and what every frontend store carries.
 * The database keys by `companies.id`. Controllers were each carrying their own
 * private copy of this translation (BankController, JournalController, …), which
 * is exactly the kind of duplication that drifts the day a company is added.
 *
 * Add a concern in ONE place: here (and in platform/core/config.js on the
 * frontend side). Group HQ is id 4 — see App\Support\ScopesToCompany, where a
 * company_id of 4 means "sees everything".
 */
final class CompanySlugs
{
    /** companies.id => frontend slug. */
    public const MAP = [
        1 => 'it',
        2 => 'travels',
        3 => 'construction',
        4 => 'group',
        5 => 'shop',
        6 => 'woodart',
    ];

    public const GROUP_ID = 4;

    /** companies.id -> frontend slug (unknown ids fall back to the Group). */
    public static function slug($id): string
    {
        return self::MAP[(int) $id] ?? 'group';
    }

    /** frontend slug -> companies.id (unknown slugs fall back to the Group). */
    public static function dbId(?string $slug): int
    {
        $flipped = array_flip(self::MAP);

        return $flipped[(string) $slug] ?? self::GROUP_ID;
    }

    /** frontend slug -> companies.id, or NULL when the slug is not a real concern. */
    public static function dbIdOrNull(?string $slug): ?int
    {
        $flipped = array_flip(self::MAP);

        return $flipped[(string) $slug] ?? null;
    }
}
