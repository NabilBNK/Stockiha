import { useEffect, useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type {
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
} from '../../shared/ipc/recoveryDto';
import {
  createOperatorBackup,
  getRestoreVerificationSetting,
  updateRestoreVerificationSetting,
  validateOperatorBackup,
  verifyOperatorBackupRestore,
} from '../../shared/ipc/recoveryGateway';

interface Props {
  sessionToken: string;
}

type BusyAction = 'setting' | 'create' | 'validate' | 'restore' | null;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Backup and recovery',
    subtitle: 'Create, validate, or verify recovery from a Stockiha backup',
    setting: 'Temporary restore verification enabled',
    settingHelp: 'When disabled, new temporary restore drills are blocked. Backup creation and read-only validation remain available.',
    settingUpdated: 'Restore-verification policy updated.',
    createHelp: 'Creates a verified bundle inside the configured backup directory. The destination, PostgreSQL role, credential, and pg_dump executable are resolved by the backend.',
    create: 'Create backup',
    created: 'Backup created and verified.',
    creationFailed: 'The backup could not be created. No partial bundle was published.',
    validateHelp: 'Enter the full path of a GestStock-Backup folder located directly inside the configured backup directory.',
    path: 'Existing backup folder path',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260805-150500',
    validate: 'Validate backup',
    recoveryBoundary: 'Recovery verification restores only into a generated temporary database. It never replaces or modifies the live Stockiha database.',
    restoreConfirm: 'I understand that this recovery drill temporarily creates and then deletes a PostgreSQL database.',
    restore: 'Verify temporary restore',
    restoreHelp: 'Requires an exact application, schema, and PostgreSQL 18 match. The temporary database must be deleted before success is reported.',
    restored: 'Backup restored and reconciled successfully in a temporary database.',
    restoreFailed: 'The temporary restore verification failed. The live database was not replaced.',
    valid: 'Backup integrity verified.',
    invalid: 'The backup could not be validated. It was not changed or repaired.',
    bundle: 'Bundle',
    application: 'Application version',
    schema: 'Schema version',
    postgres: 'PostgreSQL',
    files: 'Files',
    bytes: 'Total bytes',
    compatible: 'Compatible',
    incompatible: 'Different version',
    temporaryCleanup: 'Temporary database cleaned',
    journalBalance: 'Journal balance',
    yes: 'Yes',
    no: 'No',
    balanced: 'Balanced',
    unbalanced: 'Unbalanced',
    schemas: 'Schemas',
    tables: 'Tables',
    users: 'Users',
    products: 'Products',
    customers: 'Customers',
    suppliers: 'Suppliers',
    inventoryPositions: 'Inventory positions',
    inventoryMovements: 'Inventory movements',
    cashSales: 'Cash sales',
    journals: 'Journals',
    journalDebits: 'Journal debits',
    journalCredits: 'Journal credits',
    customerExposure: 'Customer exposure',
    supplierOutstanding: 'Supplier outstanding',
    openingApplications: 'Applied opening states',
  },
  fr: {
    title: 'Sauvegarde et récupération',
    subtitle: 'Créer, valider ou vérifier la récupération d’une sauvegarde Stockiha',
    setting: 'Vérification de restauration temporaire activée',
    settingHelp: 'Lorsqu’elle est désactivée, les nouveaux tests de restauration sont bloqués. La création et la validation restent disponibles.',
    settingUpdated: 'Politique de vérification de restauration mise à jour.',
    createHelp: 'Crée une sauvegarde vérifiée dans le répertoire configuré. La destination, le rôle PostgreSQL, le secret et pg_dump sont résolus par le backend.',
    create: 'Créer une sauvegarde',
    created: 'Sauvegarde créée et vérifiée.',
    creationFailed: 'La sauvegarde n’a pas pu être créée. Aucun dossier partiel n’a été publié.',
    validateHelp: 'Saisissez le chemin complet d’un dossier GestStock-Backup placé directement dans le répertoire configuré.',
    path: 'Chemin d’une sauvegarde existante',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260805-150500',
    validate: 'Valider la sauvegarde',
    recoveryBoundary: 'La vérification restaure uniquement dans une base temporaire générée. Elle ne remplace ni ne modifie jamais la base Stockiha active.',
    restoreConfirm: 'Je comprends que ce test crée puis supprime temporairement une base PostgreSQL.',
    restore: 'Vérifier la restauration temporaire',
    restoreHelp: 'Exige la même version d’application, de schéma et PostgreSQL 18. La base temporaire doit être supprimée avant le succès.',
    restored: 'Sauvegarde restaurée et rapprochée avec succès dans une base temporaire.',
    restoreFailed: 'La vérification de restauration temporaire a échoué. La base active n’a pas été remplacée.',
    valid: 'Intégrité de la sauvegarde vérifiée.',
    invalid: 'La sauvegarde n’a pas pu être validée. Aucun fichier n’a été modifié ou réparé.',
    bundle: 'Sauvegarde',
    application: 'Version de l’application',
    schema: 'Version du schéma',
    postgres: 'PostgreSQL',
    files: 'Fichiers',
    bytes: 'Taille totale',
    compatible: 'Compatible',
    incompatible: 'Version différente',
    temporaryCleanup: 'Base temporaire supprimée',
    journalBalance: 'Équilibre du journal',
    yes: 'Oui',
    no: 'Non',
    balanced: 'Équilibré',
    unbalanced: 'Non équilibré',
    schemas: 'Schémas',
    tables: 'Tables',
    users: 'Utilisateurs',
    products: 'Produits',
    customers: 'Clients',
    suppliers: 'Fournisseurs',
    inventoryPositions: 'Positions de stock',
    inventoryMovements: 'Mouvements de stock',
    cashSales: 'Ventes comptant',
    journals: 'Journaux',
    journalDebits: 'Débits du journal',
    journalCredits: 'Crédits du journal',
    customerExposure: 'Encours clients',
    supplierOutstanding: 'Solde fournisseurs',
    openingApplications: 'Situations initiales appliquées',
  },
  ar: {
    title: 'النسخ الاحتياطي والاسترجاع',
    subtitle: 'إنشاء نسخة Stockiha أو التحقق منها أو اختبار استرجاعها',
    setting: 'تفعيل اختبار الاسترجاع المؤقت',
    settingHelp: 'عند التعطيل يتم منع اختبارات الاسترجاع الجديدة، بينما يبقى إنشاء النسخ والتحقق منها متاحاً.',
    settingUpdated: 'تم تحديث سياسة اختبار الاسترجاع.',
    createHelp: 'ينشئ نسخة جديدة ويتم التحقق منها داخل مجلد النسخ المضبوط. يحدد النظام المسار ودور PostgreSQL وكلمة السر وpg_dump داخلياً.',
    create: 'إنشاء نسخة احتياطية',
    created: 'تم إنشاء النسخة الاحتياطية والتحقق منها.',
    creationFailed: 'تعذر إنشاء النسخة الاحتياطية. لم يتم نشر أي مجلد ناقص.',
    validateHelp: 'أدخل المسار الكامل لمجلد GestStock-Backup الموجود مباشرة داخل مجلد النسخ المضبوط.',
    path: 'مسار نسخة احتياطية موجودة',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260805-150500',
    validate: 'التحقق من النسخة',
    recoveryBoundary: 'اختبار الاسترجاع يستعمل قاعدة مؤقتة يتم إنشاؤها تلقائياً فقط. لا يستبدل ولا يعدّل قاعدة Stockiha الحالية.',
    restoreConfirm: 'أفهم أن اختبار الاسترجاع ينشئ قاعدة PostgreSQL مؤقتة ثم يحذفها.',
    restore: 'اختبار الاسترجاع المؤقت',
    restoreHelp: 'يتطلب تطابق إصدار التطبيق والمخطط وPostgreSQL 18. يجب حذف القاعدة المؤقتة قبل إعلان النجاح.',
    restored: 'تم استرجاع النسخة ومطابقة الأرصدة بنجاح داخل قاعدة مؤقتة.',
    restoreFailed: 'فشل اختبار الاسترجاع المؤقت. لم يتم استبدال قاعدة البيانات الحالية.',
    valid: 'تم التحقق من سلامة النسخة الاحتياطية.',
    invalid: 'تعذر التحقق من النسخة الاحتياطية. لم يتم تعديلها أو إصلاحها.',
    bundle: 'النسخة',
    application: 'إصدار التطبيق',
    schema: 'إصدار المخطط',
    postgres: 'PostgreSQL',
    files: 'الملفات',
    bytes: 'الحجم الإجمالي',
    compatible: 'متوافق',
    incompatible: 'إصدار مختلف',
    temporaryCleanup: 'تم حذف القاعدة المؤقتة',
    journalBalance: 'توازن القيود',
    yes: 'نعم',
    no: 'لا',
    balanced: 'متوازن',
    unbalanced: 'غير متوازن',
    schemas: 'المخططات',
    tables: 'الجداول',
    users: 'المستخدمون',
    products: 'المنتجات',
    customers: 'الزبائن',
    suppliers: 'الموردون',
    inventoryPositions: 'أرصدة المخزون',
    inventoryMovements: 'حركات المخزون',
    cashSales: 'المبيعات النقدية',
    journals: 'القيود',
    journalDebits: 'إجمالي المدين',
    journalCredits: 'إجمالي الدائن',
    customerExposure: 'ديون الزبائن',
    supplierOutstanding: 'ديون الموردين',
    openingApplications: 'الوضعيات الافتتاحية المطبقة',
  },
};

let requestSequence = 0;

function nextRequestId(operation: 'create' | 'validate' | 'restore'): string {
  requestSequence += 1;
  return `backup-${operation}-${Date.now()}-${requestSequence}`;
}

function compatibilityLabel(compatible: boolean, text: Record<string, string>): string {
  return compatible ? text.compatible : text.incompatible;
}

export function RecoverySettingsScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [bundlePath, setBundlePath] = useState('');
  const [restoreEnabled, setRestoreEnabled] = useState<boolean | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<OperatorBackupValidationResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<OperatorRestoreVerificationResult | null>(null);

  useEffect(() => {
    let active = true;
    void getRestoreVerificationSetting(sessionToken)
      .then((setting) => {
        if (active) setRestoreEnabled(setting.enabled);
      })
      .catch((settingError) => {
        if (active) setError(errorText(settingError));
      });
    return () => {
      active = false;
    };
  }, [errorText, sessionToken]);

  function resetMessages() {
    setError(null);
    setFeedback(null);
    setResult(null);
    setRestoreResult(null);
  }

  async function changeRestoreSetting(enabled: boolean) {
    if (busy || restoreEnabled === null) return;
    setBusy('setting');
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateRestoreVerificationSetting(sessionToken, enabled);
      setRestoreEnabled(updated.enabled);
      if (!updated.enabled) setRestoreConfirmed(false);
      setFeedback(text.settingUpdated);
    } catch (settingError) {
      setError(errorText(settingError));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (busy) return;
    setBusy('create');
    resetMessages();
    try {
      const created = await createOperatorBackup(sessionToken, {
        requestId: nextRequestId('create'),
      });
      setResult(created);
      setFeedback(text.created);
    } catch (creationError) {
      setError(
        codeForError(creationError) === 'BACKUP_CREATION_FAILED'
          ? text.creationFailed
          : errorText(creationError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    if (!bundlePath.trim() || busy) return;
    setBusy('validate');
    resetMessages();
    try {
      const validated = await validateOperatorBackup(sessionToken, {
        requestId: nextRequestId('validate'),
        bundlePath: bundlePath.trim(),
      });
      setResult(validated);
      setFeedback(text.valid);
    } catch (validationError) {
      setError(
        codeForError(validationError) === 'BACKUP_VALIDATION_FAILED'
          ? text.invalid
          : errorText(validationError),
      );
    } finally {
      setBusy(null);
    }
  }

  async function verifyRestore() {
    if (!bundlePath.trim() || !restoreConfirmed || !restoreEnabled || busy) return;
    setBusy('restore');
    resetMessages();
    try {
      const restored = await verifyOperatorBackupRestore(sessionToken, {
        requestId: nextRequestId('restore'),
        bundlePath: bundlePath.trim(),
        confirmed: true,
      });
      setRestoreResult(restored);
      setFeedback(text.restored);
    } catch (restoreError) {
      setError(
        codeForError(restoreError) === 'BACKUP_VALIDATION_FAILED'
          ? text.restoreFailed
          : errorText(restoreError),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sk-page" aria-labelledby="recovery-settings-title">
      <div className="sk-card">
        <h2 id="recovery-settings-title">{text.title}</h2>
        <p>{text.subtitle}</p>

        <Banner tone="warning">{text.recoveryBoundary}</Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-stack">
          <label className="sk-checkbox-row">
            <input
              type="checkbox"
              aria-label={text.setting}
              checked={restoreEnabled === true}
              disabled={restoreEnabled === null || busy !== null}
              onChange={(event) => void changeRestoreSetting(event.target.checked)}
            />
            <span>{text.setting}</span>
          </label>
          <small className="sk-field-help">{text.settingHelp}</small>

          <div>
            <Button
              type="button"
              loading={busy === 'create'}
              disabled={busy !== null}
              onClick={() => void create()}
            >
              {text.create}
            </Button>
            <small className="sk-field-help">{text.createHelp}</small>
          </div>

          <TextField
            label={text.path}
            value={bundlePath}
            placeholder={text.placeholder}
            disabled={busy !== null}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setBundlePath(event.target.value);
              setRestoreConfirmed(false);
            }}
          />
          <small className="sk-field-help">{text.validateHelp}</small>
          <div className="sk-actions">
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'validate'}
              disabled={!bundlePath.trim() || busy !== null}
              onClick={() => void validate()}
            >
              {text.validate}
            </Button>
          </div>

          <label className="sk-checkbox-row">
            <input
              type="checkbox"
              checked={restoreConfirmed}
              disabled={!bundlePath.trim() || !restoreEnabled || busy !== null}
              onChange={(event) => setRestoreConfirmed(event.target.checked)}
            />
            <span>{text.restoreConfirm}</span>
          </label>
          <div>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'restore'}
              disabled={!bundlePath.trim() || !restoreConfirmed || !restoreEnabled || busy !== null}
              onClick={() => void verifyRestore()}
            >
              {text.restore}
            </Button>
            <small className="sk-field-help">{text.restoreHelp}</small>
          </div>
        </div>

        {result ? (
          <dl className="sk-details-grid" data-testid="backup-result">
            <div><dt>{text.bundle}</dt><dd>{result.bundleIdentifier}</dd></div>
            <div><dt>{text.application}</dt><dd>{result.applicationVersion} · {compatibilityLabel(result.applicationCompatible, text)}</dd></div>
            <div><dt>{text.schema}</dt><dd>{result.schemaVersion} · {compatibilityLabel(result.schemaCompatible, text)}</dd></div>
            <div><dt>{text.postgres}</dt><dd>{result.postgresMajorVersion} · {compatibilityLabel(result.postgresCompatible, text)}</dd></div>
            <div><dt>{text.files}</dt><dd>{new Intl.NumberFormat(locale).format(result.fileCount)}</dd></div>
            <div><dt>{text.bytes}</dt><dd>{new Intl.NumberFormat(locale).format(result.totalBytes)}</dd></div>
          </dl>
        ) : null}

        {restoreResult ? (
          <dl className="sk-details-grid" data-testid="restore-result">
            <div><dt>{text.bundle}</dt><dd>{restoreResult.bundleIdentifier}</dd></div>
            <div><dt>{text.schema}</dt><dd>{restoreResult.schemaVersion}</dd></div>
            <div><dt>{text.postgres}</dt><dd>{restoreResult.postgresMajorVersion}</dd></div>
            <div><dt>{text.temporaryCleanup}</dt><dd>{restoreResult.temporaryDatabaseCleaned ? text.yes : text.no}</dd></div>
            <div><dt>{text.journalBalance}</dt><dd>{restoreResult.journalBalanced ? text.balanced : text.unbalanced}</dd></div>
            <div><dt>{text.schemas}</dt><dd>{restoreResult.controlTotals.schemaCount}</dd></div>
            <div><dt>{text.tables}</dt><dd>{restoreResult.controlTotals.tableCount}</dd></div>
            <div><dt>{text.users}</dt><dd>{restoreResult.controlTotals.userCount}</dd></div>
            <div><dt>{text.products}</dt><dd>{restoreResult.controlTotals.productCount}</dd></div>
            <div><dt>{text.customers}</dt><dd>{restoreResult.controlTotals.customerCount}</dd></div>
            <div><dt>{text.suppliers}</dt><dd>{restoreResult.controlTotals.supplierCount}</dd></div>
            <div><dt>{text.inventoryPositions}</dt><dd>{restoreResult.controlTotals.inventoryPositionCount}</dd></div>
            <div><dt>{text.inventoryMovements}</dt><dd>{restoreResult.controlTotals.inventoryMovementCount}</dd></div>
            <div><dt>{text.cashSales}</dt><dd>{restoreResult.controlTotals.cashSaleCount}</dd></div>
            <div><dt>{text.journals}</dt><dd>{restoreResult.controlTotals.journalCount}</dd></div>
            <div><dt>{text.journalDebits}</dt><dd>{restoreResult.controlTotals.journalDebitTotal}</dd></div>
            <div><dt>{text.journalCredits}</dt><dd>{restoreResult.controlTotals.journalCreditTotal}</dd></div>
            <div><dt>{text.customerExposure}</dt><dd>{restoreResult.controlTotals.customerExposureTotal}</dd></div>
            <div><dt>{text.supplierOutstanding}</dt><dd>{restoreResult.controlTotals.supplierOutstandingTotal}</dd></div>
            <div><dt>{text.openingApplications}</dt><dd>{restoreResult.controlTotals.openingStateApplicationCount}</dd></div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
