<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A posting was refused by the ledger — unbalanced lines, an unknown account
 * code, a zero amount, an account that belongs to another concern.
 *
 * Thrown by App\Services\LedgerService / BankRegisterService / ExpensePostingService
 * and caught by the module controller, which turns it into the API's standard
 * `{ success:false, message:… }` 422 body. It is deliberately NOT a
 * ValidationException: the SPA reads `message`, and a validation payload would
 * change that contract.
 */
class LedgerException extends RuntimeException
{
}
