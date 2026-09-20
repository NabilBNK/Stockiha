import { Banner } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n';
import type { OperatorRestoreVerificationResult } from '../../../shared/ipc/recoveryDto';

export function RestoreTestResultGrid({ result }: { result: OperatorRestoreVerificationResult }) {
  const { t } = useI18n();
  return (
    <>
      <dl className="sk-details-grid" data-testid="restore-result">
        <div><dt>{t('recovery.bundle')}</dt><dd>{result.bundleIdentifier}</dd></div>
        <div><dt>{t('recovery.schema')}</dt><dd>{result.schemaVersion}</dd></div>
        <div><dt>{t('recovery.postgres')}</dt><dd>{result.postgresMajorVersion}</dd></div>
        <div>
          <dt>{t('recovery.serverStopped')}</dt>
          <dd>{result.temporaryDatabaseCleaned ? t('recovery.yes') : t('recovery.no')}</dd>
        </div>
        <div>
          <dt>{t('recovery.journalBalance')}</dt>
          <dd>{result.journalBalanced ? t('recovery.balanced') : t('recovery.unbalanced')}</dd>
        </div>
        {result.migratedForward !== undefined ? (
          <div>
            <dt>{t('recovery.updatedToCurrent')}</dt>
            <dd>{result.migratedForward ? t('recovery.yes') : t('recovery.no')}</dd>
          </div>
        ) : null}
        <div><dt>{t('recovery.schemas')}</dt><dd>{result.controlTotals.schemaCount}</dd></div>
        <div><dt>{t('recovery.tables')}</dt><dd>{result.controlTotals.tableCount}</dd></div>
        <div><dt>{t('recovery.users')}</dt><dd>{result.controlTotals.userCount}</dd></div>
        <div><dt>{t('recovery.products')}</dt><dd>{result.controlTotals.productCount}</dd></div>
        <div><dt>{t('recovery.customers')}</dt><dd>{result.controlTotals.customerCount}</dd></div>
        <div><dt>{t('recovery.suppliers')}</dt><dd>{result.controlTotals.supplierCount}</dd></div>
        <div><dt>{t('recovery.inventoryPositions')}</dt><dd>{result.controlTotals.inventoryPositionCount}</dd></div>
        <div><dt>{t('recovery.inventoryMovements')}</dt><dd>{result.controlTotals.inventoryMovementCount}</dd></div>
        <div><dt>{t('recovery.cashSales')}</dt><dd>{result.controlTotals.cashSaleCount}</dd></div>
        <div><dt>{t('recovery.journals')}</dt><dd>{result.controlTotals.journalCount}</dd></div>
        <div><dt>{t('recovery.journalDebits')}</dt><dd>{result.controlTotals.journalDebitTotal}</dd></div>
        <div><dt>{t('recovery.journalCredits')}</dt><dd>{result.controlTotals.journalCreditTotal}</dd></div>
        <div><dt>{t('recovery.customerExposure')}</dt><dd>{result.controlTotals.customerExposureTotal}</dd></div>
        <div><dt>{t('recovery.supplierOutstanding')}</dt><dd>{result.controlTotals.supplierOutstandingTotal}</dd></div>
        <div><dt>{t('recovery.openingApplications')}</dt><dd>{result.controlTotals.openingStateApplicationCount}</dd></div>
      </dl>
      {result.cleanupPending ? (
        <Banner tone="warning">{t('recovery.cleanupPendingNote')}</Banner>
      ) : null}
    </>
  );
}
