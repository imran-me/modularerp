<?php
namespace Epal\Modules\Travels\VisaProcessing;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * VisaCategoryController — real `visa_categories` rows mapped onto the
 * frontend `visaCats` store shape read by view.js (categories / visa-rates).
 *
 * Frontend category shape (view.js editCategory / categories table):
 *   { id, country, flag, type, cost, sale, days, status }
 *   margin is derived on the client as round((sale-cost)/sale*100).
 */
class VisaCategoryController
{
    public function index(): JsonResponse
    {
        $rows = DB::table('visa_categories as vc')
            ->leftJoin('countries as c', 'c.id', '=', 'vc.country_id')
            ->whereNull('vc.deleted_at')
            ->orderBy('vc.name')
            ->get([
                'vc.id',
                'vc.name',
                'vc.visa_type',
                'vc.description',
                'vc.costing_price',
                'vc.sale_price',
                'vc.avg_processing_days',
                'vc.is_active',
                'c.name as country_name',
            ]);

        $cats = $rows->map(function ($r) {
            // Country label: prefer the linked country name, then the free-text
            // description, then the row name as a last-resort human label.
            $country = $r->country_name ?: ($r->description ?: $r->name);
            // avg_processing_days is free text ("3-5", "20-25", "1") — take the
            // leading integer for the numeric `days` the frontend expects.
            $days = 0;
            if ($r->avg_processing_days !== null && preg_match('/\d+/', $r->avg_processing_days, $m)) {
                $days = (int) $m[0];
            }
            return [
                'id'      => 'VC-' . $r->id,
                'country' => $country,
                'name'    => $r->name,
                'flag'    => '🌍',
                'type'    => $r->visa_type ?: 'Tourist',
                'cost'    => (float) $r->costing_price,
                'sale'    => (float) $r->sale_price,
                'days'    => $days,
                'status'  => ((int) $r->is_active === 1) ? 'active' : 'inactive',
            ];
        })->values();

        return response()->json(['success' => true, 'count' => $cats->count(), 'data' => $cats]);
    }
}
