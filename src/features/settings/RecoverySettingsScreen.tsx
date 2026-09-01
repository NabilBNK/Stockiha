import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button, TextField } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type {
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
} from '../../shared/ipc/recoveryDto';
import {
  createOperatorBackup,
  getBackupDestinationSetting,
  getRestoreVerificationSetting,
  updateBackupDestinationSetting,
  updateRestoreVerificationSetting,
  validateOperatorBackup,
  verifyOperatorBackupRestore,
} from '../../shared/ipc/recoveryGateway';

interface Props {
  sessionToken: string;
}

type BusyAction = 'setting' | 'create' | 'validate' | 'restore' | 'destination' | null;

// Restore verification is a WS-H MVP requirement per STOCKIHA_GROUND_TRUTH.md
// §4 ("Database restore capability (pg_restore into temporary validation
// target)"). It is not in the deferred/future list (only cloud sync,
// off-device retention, and scheduled encrypted backups are). The drill is
// isolated to a temporary database that it creates and drops — see
// restore_proof/mod.rs — and never touches the live database.
const RESTORE_DRILL_AVAILABLE = true;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Backup and recovery',
    subtitle: 'Create a backup of your Stockiha data at any time',
    setting: 'Temporary restore verification enabled',
    settingHelp: 'When disabled, new temporary restore drills are blocked. Backup creation and read-only validation remain available.',
    settingUpdated: 'Restore-verification policy updated.',
    createHelp: 'Creates a verified backup file inside your chosen backup destination. The PostgreSQL role, credential, and pg_dump executable are resolved automatically.',
    create: 'Create backup',
    created: 'Backup created and verified.',
    creationFailed: 'The backup could not be created. No partial bundle was published.',
    destination: 'Backup destination',
    destinationHelp: 'New backups are created inside this folder. Choose a folder with a native picker instead of typing a path.',
    destinationNotSet: 'Not set — using the default backup location',
    destinationChange: 'Change destination…',
    destinationUpdated: 'Backup destination updated.',
    browse: 'Browse…',
    browseTitle: 'Select a GestStock-Backup folder',
    browseDestinationTitle: 'Select a backup destination folder',
    validateHelp: 'Browse to a GestStock-Backup folder located directly inside your backup destination.',
    path: 'Existing backup folder path',
    placeholder: 'No folder selected',
    validate: 'Validate backup',
    recoveryBoundary: 'Recovery verification restores only into a generated temporary database. It never replaces or modifies the live Stockiha database.',
    restoreConfirm: 'I understand that this recovery drill temporarily creates and then deletes a PostgreSQL database.',
    restore: 'Verify temporary restore',
    restoreHelp: 'Requires an exact application, schema, and PostgreSQL 18 match. The temporary database must be deleted before success is reported.',
    restored: 'Backup restored and reconciled successfully in a temporary database.',
    restoreFailed: 'The temporary restore verification failed. The live database was not replaced.',
    restoreComingSoon: 'Coming after MVP',
    restoreDeferredTitle: 'Restoring from a backup is not available yet',
    restoreDeferredBody: 'This version can create and validate backup files, so your data is protected while the rest of Stockiha is completed. The ability to actually restore your data from a backup file will be added in a later update. Keep every backup file you create — they will work with that update.',
    restoreAvailableTitle: 'Restore from a backup',
    restoreAvailableBody: 'Verifying a restore builds a temporary database from the backup file, checks it, then deletes it. Your live Stockiha database is never touched.',
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
    subtitle: 'Créez à tout moment une sauvegarde de vos données Stockiha',
    setting: 'Vérification de restauration temporaire activée',
    settingHelp: 'Lorsqu’elle est désactivée, les nouveaux tests de restauration sont bloqués. La création et la validation restent disponibles.',
    settingUpdated: 'Politique de vérification de restauration mise à jour.',
    createHelp: 'Crée un fichier de sauvegarde vérifié dans la destination choisie. Le rôle PostgreSQL, le secret et pg_dump sont résolus automatiquement.',
    create: 'Créer une sauvegarde',
    created: 'Sauvegarde créée et vérifiée.',
    creationFailed: 'La sauvegarde n’a pas pu être créée. Aucun dossier partiel n’a été publié.',
    destination: 'Destination des sauvegardes',
    destinationHelp: 'Les nouvelles sauvegardes sont créées dans ce dossier. Choisissez un dossier avec le sélecteur natif plutôt que de saisir un chemin.',
    destinationNotSet: 'Non défini — emplacement de sauvegarde par défaut utilisé',
    destinationChange: 'Changer de destination…',
    destinationUpdated: 'Destination de sauvegarde mise à jour.',
    browse: 'Parcourir…',
    browseTitle: 'Sélectionnez un dossier GestStock-Backup',
    browseDestinationTitle: 'Sélectionnez un dossier de destination de sauvegarde',
    validateHelp: 'Parcourez pour choisir un dossier GestStock-Backup situé directement dans votre destination de sauvegarde.',
    path: 'Chemin d’une sauvegarde existante',
    placeholder: 'Aucun dossier sélectionné',
    validate: 'Valider la sauvegarde',
    recoveryBoundary: 'La vérification restaure uniquement dans une base temporaire générée. Elle ne remplace ni ne modifie jamais la base Stockiha active.',
    restoreConfirm: 'Je comprends que ce test crée puis supprime temporairement une base PostgreSQL.',
    restore: 'Vérifier la restauration temporaire',
    restoreHelp: 'Exige la même version d’application, de schéma et PostgreSQL 18. La base temporaire doit être supprimée avant le succès.',
    restored: 'Sauvegarde restaurée et rapprochée avec succès dans une base temporaire.',
    restoreFailed: 'La vérification de restauration temporaire a échoué. La base active n’a pas été remplacée.',
    restoreComingSoon: 'Disponible après le MVP',
    restoreDeferredTitle: 'La restauration à partir d’une sauvegarde n’est pas encore disponible',
    restoreDeferredBody: 'Cette version permet de créer et de valider des fichiers de sauvegarde, afin que vos données soient protégées pendant que le reste de Stockiha est finalisé. La restauration réelle de vos données à partir d’un fichier de sauvegarde sera ajoutée dans une prochaine mise à jour. Conservez chaque sauvegarde créée — elles fonctionneront avec cette mise à jour.',
    restoreAvailableTitle: 'Restaurer depuis une sauvegarde',
    restoreAvailableBody: 'La vérification de restauration crée une base de données temporaire à partir du fichier de sauvegarde, la contrôle, puis la supprime. Votre base Stockiha active n’est jamais modifiée.',
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
    subtitle: 'أنشئ نسخة احتياطية من بيانات Stockiha في أي وقت',
    setting: 'تفعيل اختبار الاسترجاع المؤقت',
    settingHelp: 'عند التعطيل يتم منع اختبارات الاسترجاع الجديدة، بينما يبقى إنشاء النسخ والتحقق منها متاحاً.',
    settingUpdated: 'تم تحديث سياسة اختبار الاسترجاع.',
    createHelp: 'ينشئ ملف نسخة احتياطية موثوقاً داخل الوجهة التي اخترتها. يحدد النظام دور PostgreSQL وكلمة السر وpg_dump تلقائياً.',
    create: 'إنشاء نسخة احتياطية',
    created: 'تم إنشاء النسخة الاحتياطية والتحقق منها.',
    creationFailed: 'تعذر إنشاء النسخة الاحتياطية. لم يتم نشر أي مجلد ناقص.',
    destination: 'وجهة النسخ الاحتياطي',
    destinationHelp: 'تُنشأ النسخ الاحتياطية الجديدة داخل هذا المجلد. اختر مجلدًا باستخدام أداة الاختيار الأصلية بدلاً من كتابة المسار.',
    destinationNotSet: 'غير محدد — يُستخدم موقع النسخ الاحتياطي الافتراضي',
    destinationChange: 'تغيير الوجهة…',
    destinationUpdated: 'تم تحديث وجهة النسخ الاحتياطي.',
    browse: 'تصفح…',
    browseTitle: 'اختر مجلد GestStock-Backup',
    browseDestinationTitle: 'اختر مجلد وجهة النسخ الاحتياطي',
    validateHelp: 'تصفح لاختيار مجلد GestStock-Backup الموجود مباشرة داخل وجهة النسخ الاحتياطي الخاصة بك.',
    path: 'مسار نسخة احتياطية موجودة',
    placeholder: 'لم يتم اختيار مجلد',
    validate: 'التحقق من النسخة',
    recoveryBoundary: 'اختبار الاسترجاع يستعمل قاعدة مؤقتة يتم إنشاؤها تلقائياً فقط. لا يستبدل ولا يعدّل قاعدة Stockiha الحالية.',
    restoreConfirm: 'أفهم أن اختبار الاسترجاع ينشئ قاعدة PostgreSQL مؤقتة ثم يحذفها.',
    restore: 'اختبار الاسترجاع المؤقت',
    restoreHelp: 'يتطلب تطابق إصدار التطبيق والمخطط وPostgreSQL 18. يجب حذف القاعدة المؤقتة قبل إعلان النجاح.',
    restored: 'تم استرجاع النسخة ومطابقة الأرصدة بنجاح داخل قاعدة مؤقتة.',
    restoreFailed: 'فشل اختبار الاسترجاع المؤقت. لم يتم استبدال قاعدة البيانات الحالية.',
    restoreComingSoon: 'متوفر بعد الإصدار الأول',
    restoreDeferredTitle: 'استرجاع البيانات من نسخة احتياطية غير متاح بعد',
    restoreDeferredBody: 'تتيح هذه النسخة إنشاء ملفات النسخ الاحتياطي والتحقق منها، لحماية بياناتك أثناء إتمام باقي أجزاء Stockiha. سيتم إضافة الاسترجاع الفعلي للبيانات من ملف نسخة احتياطية في تحديث لاحق. احتفظ بكل نسخة تنشئها الآن، فهي ستعمل مع ذلك التحديث.',
    restoreAvailableTitle: 'الاسترجاع من نسخة احتياطية',
    restoreAvailableBody: 'يُنشئ التحقق من الاسترجاع قاعدة بيانات مؤقتة من ملف النسخة الاحتياطية، ويتحقق منها، ثم يحذفها. لا يتم أبدًا لمس قاعدة بيانات Stockiha الفعلية.',
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
  const [destination, setDestination] = useState<string | null>(null);
  const [restoreEnabled, setRestoreEnabled] = useState<boolean | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<OperatorBackupValidationResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<OperatorRestoreVerificationResult | null>(null);

  useEffect(() => {
    if (!RESTORE_DRILL_AVAILABLE) return;
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

  useEffect(() => {
    let active = true;
    void getBackupDestinationSetting(sessionToken)
      .then((setting) => {
        if (active) setDestination(setting.path);
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

  async function changeDestination() {
    if (busy) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: text.browseDestinationTitle,
    });
    if (!selected || Array.isArray(selected)) return;
    setBusy('destination');
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateBackupDestinationSetting(sessionToken, { path: selected });
      setDestination(updated.path ?? null);
      setFeedback(text.destinationUpdated);
    } catch (destinationError) {
      setError(errorText(destinationError));
    } finally {
      setBusy(null);
    }
  }

  async function browseBundle() {
    if (busy) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: text.browseTitle,
    });
    if (!selected || Array.isArray(selected)) return;
    setBundlePath(selected);
    setRestoreConfirmed(false);
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
    if (!RESTORE_DRILL_AVAILABLE) return;
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

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-form">
          <div className="sk-field">
            <div className="sk-field-row">
              <TextField
                label={text.destination}
                value={destination ?? ''}
                placeholder={text.destinationNotSet}
                readOnly
              />
              <Button
                type="button"
                variant="secondary"
                loading={busy === 'destination'}
                disabled={busy !== null}
                onClick={() => void changeDestination()}
              >
                {text.destinationChange}
              </Button>
            </div>
            <small className="sk-field-help">{text.destinationHelp}</small>
          </div>

          <div className="sk-field">
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

          <div className="sk-field">
            <div className="sk-field-row">
              <TextField
                label={text.path}
                value={bundlePath}
                placeholder={text.placeholder}
                readOnly
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void browseBundle()}
              >
                {text.browse}
              </Button>
            </div>
            <small className="sk-field-help">{text.validateHelp}</small>
          </div>

          <div className="sk-field">
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
      </div>

      <div className="sk-card sk-card--muted" aria-labelledby="recovery-restore-title">
        <div className="sk-section-heading">
          <h2 id="recovery-restore-title">
            {RESTORE_DRILL_AVAILABLE ? text.restoreAvailableTitle : text.restoreDeferredTitle}
          </h2>
          {RESTORE_DRILL_AVAILABLE ? null : (
            <span className="sk-badge sk-badge--warning">{text.restoreComingSoon}</span>
          )}
        </div>
        {/* Card body copy, not field help: this is the restore card's
            equivalent of the backup card's subtitle, so it uses the same
            plain paragraph rather than the 0.74rem `.sk-field-help` scale
            reserved for text attached to a single control. */}
        <p>{RESTORE_DRILL_AVAILABLE ? text.restoreAvailableBody : text.restoreDeferredBody}</p>

        <Banner tone="warning">{text.recoveryBoundary}</Banner>

        <fieldset
          className={RESTORE_DRILL_AVAILABLE ? 'sk-form' : 'sk-form sk-fieldset--disabled'}
          disabled={!RESTORE_DRILL_AVAILABLE}
        >
          <div className="sk-field">
            <label className="sk-checkbox-row">
              <input
                type="checkbox"
                aria-label={text.setting}
                checked={restoreEnabled === true}
                disabled={busy !== null}
                onChange={(event) => changeRestoreSetting(event.target.checked)}
              />
              <span>{text.setting}</span>
            </label>
            <small className="sk-field-help">{text.settingHelp}</small>
          </div>

          {/* Wrapped in `.sk-field` like every other row in both cards: as a
              bare fieldset child this one row sat outside the form's field
              rhythm. */}
          <div className="sk-field">
            <label className="sk-checkbox-row">
              <input
                type="checkbox"
                checked={restoreConfirmed}
                disabled={!restoreEnabled || busy !== null}
                onChange={(event) => setRestoreConfirmed(event.target.checked)}
              />
              <span>{text.restoreConfirm}</span>
            </label>
          </div>

          <div className="sk-field">
            {/* `loading` as well as `disabled`: all three recovery buttons
                disable while any one runs, so without a spinner on the one
                actually working the screen looks inert rather than busy. */}
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'restore'}
              disabled={!bundlePath.trim() || !restoreConfirmed || !restoreEnabled || busy !== null}
              onClick={verifyRestore}
            >
              {text.restore}
            </Button>
            <small className="sk-field-help">{text.restoreHelp}</small>
          </div>
        </fieldset>

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
