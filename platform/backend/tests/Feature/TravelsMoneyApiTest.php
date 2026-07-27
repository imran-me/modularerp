<?php

namespace Tests\Feature;

use App\Models\User;
use Tests\Support\BuildsMoneySchema;
use Tests\TestCase;

/**
 * THE ENDPOINTS, over HTTP — routes + FormRequests + JSON shapes.
 * The service tests prove the accounting; these prove a client can actually reach
 * it: the route exists, validation rejects what it should, a refusal comes back as
 * 422 with a readable message, and the response carries what the SPA reads.
 *
 *   php vendor/bin/phpunit --filter TravelsMoneyApiTest
 */
class TravelsMoneyApiTest extends TestCase
{
    use BuildsMoneySchema;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildMoneySchema();
        $this->seedChart();
        $this->seedAccountsFor();
        // a group-level user: ScopesToCompany treats company 4 (Group) as "sees all",
        // so the request is not forced onto one concern's books
        $this->actingAs(new User(['name' => 'Tester', 'email' => 't@e.st']), 'sanctum');
    }

    /* ------------------------------------------------------------------ sales */

    public function test_it_records_a_sale_and_then_a_receipt(): void
    {
        $sale = $this->postJson('/api/travels/accounts/sales', [
            'ref' => 'TKT-API-1', 'amount' => 100000, 'cost' => 70000,
            'category' => 'air', 'customer' => 'Mr Rahman', 'vendor' => 'Emirates',
        ]);
        $sale->assertStatus(201)->assertJsonPath('success', true)
            ->assertJsonPath('data.debitedTo', '1200')
            ->assertJsonPath('data.product', 'Air Ticket');

        // it is really on the books
        $this->assertSame(100000.0, $this->lineOn('GL-STKT-API-1', '1200', 'debit'));
        $this->assertSame(70000.0, $this->lineOn('GL-SCTKT-API-1', '5000', 'debit'));

        // …and what is owed is readable
        $due = $this->getJson('/api/travels/accounts/receivables?ref=TKT-API-1');
        $due->assertOk()->assertJsonPath('total', 100000);

        $receipt = $this->postJson('/api/travels/accounts/receipts', [
            'ref' => 'TKT-API-1', 'amount' => 100000, 'bankId' => '1', 'party' => 'Mr Rahman',
        ]);
        $receipt->assertStatus(201)
            ->assertJsonPath('data.arAccount', '1200')
            ->assertJsonPath('data.outstanding', 0)
            ->assertJsonPath('data.account', 'City Bank (Travels)');

        $this->assertEquals(900000 + 100000, $this->balanceOf(1));
        $this->assertSame(0.0, $this->netOn('1200'));
        $this->assertTrue($this->booksBalance());

        // and nothing is outstanding any more
        $this->getJson('/api/travels/accounts/receivables')->assertOk()->assertJsonPath('total', 0);
    }

    public function test_validation_refuses_a_sale_with_no_reference(): void
    {
        $this->postJson('/api/travels/accounts/sales', ['amount' => 1000])
            ->assertStatus(422)->assertJsonValidationErrors(['ref']);
    }

    public function test_validation_refuses_a_receipt_with_no_amount(): void
    {
        $this->postJson('/api/travels/accounts/receipts', ['ref' => 'X-1'])
            ->assertStatus(422)->assertJsonValidationErrors(['amount']);
    }

    /** A ledger refusal is a readable 422, not a 500. */
    public function test_settling_an_unposted_sale_is_a_clean_422(): void
    {
        $r = $this->postJson('/api/travels/accounts/receipts', [
            'ref' => 'NOPE-9', 'amount' => 500, 'bankId' => '1',
        ]);
        $r->assertStatus(422)->assertJsonPath('success', false);
        $this->assertStringContainsString('not on the books', $r->json('message'));
    }

    public function test_paying_from_another_concerns_account_is_refused(): void
    {
        $this->postJson('/api/travels/accounts/sales', [
            'ref' => 'TKT-API-2', 'amount' => 5000, 'cost' => 0, 'category' => 'air',
        ])->assertStatus(201);

        $r = $this->postJson('/api/travels/accounts/receipts', [
            'ref' => 'TKT-API-2', 'amount' => 5000, 'bankId' => '4',      // Woodart's bank
        ]);
        $r->assertStatus(422);
        $this->assertStringContainsString('belongs to', $r->json('message'));
    }

    /* ----------------------------------------------------------------- voiding */

    public function test_voiding_a_sale_over_http_reverses_it(): void
    {
        $this->postJson('/api/travels/accounts/sales', [
            'ref' => 'TKT-API-3', 'amount' => 25000, 'cost' => 15000, 'category' => 'air',
            'paid' => true, 'bankId' => '1', 'costPaid' => true,
        ])->assertStatus(201);

        $this->deleteJson('/api/travels/accounts/sales/TKT-API-3?reason=customer%20cancelled')
            ->assertOk()->assertJsonPath('success', true);

        $this->assertSame(0.0, $this->netOn('4010'));
        $this->assertSame(0.0, $this->netOn('5000'));
        $this->assertEquals(900000, $this->balanceOf(1));
        $this->assertTrue($this->booksBalance());
    }

    /** Marked paid by mistake: un-pay and the debt returns. */
    public function test_reversing_a_receipt_over_http_restores_the_debt(): void
    {
        $this->postJson('/api/travels/accounts/sales', [
            'ref' => 'TKT-API-4', 'amount' => 30000, 'cost' => 0, 'category' => 'visa',
        ])->assertStatus(201);
        $this->postJson('/api/travels/accounts/receipts', [
            'ref' => 'TKT-API-4', 'amount' => 30000, 'bankId' => '1',
        ])->assertStatus(201);

        $this->deleteJson('/api/travels/accounts/receipts/TKT-API-4')->assertOk();

        $this->assertSame(30000.0, $this->netOn('1200'));
        $this->assertEquals(900000, $this->balanceOf(1));
        $this->getJson('/api/travels/accounts/receivables')->assertOk()->assertJsonPath('total', 30000);
    }

    /* ---------------------------------------------------------------- expenses */

    /** The money-OUT endpoint over HTTP, for symmetry with the above. */
    public function test_it_records_an_expense_over_http(): void
    {
        $r = $this->postJson('/api/travels/accounts/expenses', [
            'amount' => 1250, 'head' => '5550', 'category' => 'Guest & Entertainment',
            'subCategory' => 'Tea / Coffee (Guest)', 'bankId' => '1', 'party' => 'Star Kabab',
        ]);
        $r->assertStatus(201)->assertJsonPath('success', true)
            ->assertJsonPath('data.entry.head', '5550')
            ->assertJsonPath('data.register.type', 'withdraw');

        $this->assertEquals(900000 - 1250, $this->balanceOf(1));
        $this->assertTrue($this->booksBalance());
    }

    public function test_the_expense_form_endpoint_orders_heads_and_accounts(): void
    {
        $r = $this->getJson('/api/travels/accounts/expenses/form');
        $r->assertOk();

        $heads = $r->json('data.heads');
        $this->assertNotEmpty($heads);
        $this->assertSame('expense', $heads[0]['type']);          // expense codes first

        $accounts = $r->json('data.accounts');
        $this->assertSame('travels', $accounts[0]['companyId']);   // Travels' accounts first
        $this->assertSame('Bank', $accounts[0]['type']);           // bank before cash
        $cash = collect($accounts)->firstWhere('type', 'Cash Box');
        $this->assertSame('1000', $cash['glAccount']);             // a cash box IS hard cash
    }
}
