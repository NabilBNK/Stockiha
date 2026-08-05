import type {
  HistoricalFinanceBalanceInput,
  HistoricalFinanceRowInput,
} from '../../shared/ipc/onboardingDto';
import type {
  HistoricalFinanceImportError,
  HistoricalFinanceWorkbookData,
} from './xlsxParser';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function validateHistoricalFinanceRowForReview(
  row: HistoricalFinanceRowInput,
): string[] {
  const issues: string[] = [];
  if (row.transactionDate > todayIso()) issues.push('Transaction date is in the future.');

  const paid = row.amountPaidDzd ?? 0;
  if (
    row.paymentStatus === 'PARTIAL' &&
    (row.amountPaidDzd === null ||
      row.amountPaidDzd === undefined ||
      row.amountPaidDzd <= 0 ||
      row.amountPaidDzd >= row.netAmountDzd)
  ) {
    issues.push('A partial payment must be greater than zero and lower than the net amount.');
  }
  if (row.paymentStatus === 'UNPAID' && paid !== 0) {
    issues.push('An unpaid transaction cannot contain a paid amount.');
  }
  if (
    row.paymentStatus === 'PAID' &&
    row.amountPaidDzd !== null &&
    row.amountPaidDzd !== undefined &&
    row.amountPaidDzd !== row.netAmountDzd
  ) {
    issues.push('For a paid transaction, the entered paid amount must equal the net amount.');
  }
  if (row.paymentStatus === 'UNKNOWN') {
    issues.push('Payment status must be confirmed before approval.');
  }
  if (
    ['EXPENSE', 'SALARY', 'TAX_PAYMENT'].includes(row.transactionType) &&
    !row.expenseCategory?.trim()
  ) {
    issues.push('An expense, salary, or tax payment requires an expense category.');
  }
  if (row.reviewStatus === 'NEEDS_REVIEW') {
    issues.push('The row is explicitly marked as needing review.');
  }

  return issues;
}

export function validateHistoricalFinanceBalanceForReview(
  balance: HistoricalFinanceBalanceInput,
): string[] {
  const issues: string[] = [];
  if (balance.balanceDate > todayIso()) issues.push('Balance date is in the future.');
  if (balance.balanceType === 'CUSTOMER_RECEIVABLE' && !balance.customerClient?.trim()) {
    issues.push('A customer receivable requires a customer/client name.');
  }
  if (balance.balanceType === 'SUPPLIER_PAYABLE' && !balance.supplierFournisseur?.trim()) {
    issues.push('A supplier payable requires a supplier/fournisseur name.');
  }
  if (balance.reviewStatus === 'NEEDS_REVIEW') {
    issues.push('The balance row is explicitly marked as needing review.');
  }
  return issues;
}

export function collectHistoricalFinanceWorkbookReviewErrors(
  workbook: HistoricalFinanceWorkbookData,
): HistoricalFinanceImportError[] {
  const errors: HistoricalFinanceImportError[] = [];

  for (const row of workbook.rows) {
    for (const message of validateHistoricalFinanceRowForReview(row)) {
      errors.push({
        sheet: 'Historical_Transactions',
        row: row.sourceRowNumber,
        message,
      });
    }
  }

  for (const balance of workbook.balances) {
    for (const message of validateHistoricalFinanceBalanceForReview(balance)) {
      errors.push({
        sheet: 'Balances',
        row: balance.sourceRowNumber,
        message,
      });
    }
  }

  return errors;
}
