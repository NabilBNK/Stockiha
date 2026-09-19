import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button, TextField } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type {
  BackupDestinationSetting,
  BackupKind,
  BackupStatus,
  OperatorBackupValidationResult,
  OperatorRestoreVerificationResult,
  RecoveryCapabilities,
} from '../../shared/ipc/recoveryDto';
import {
  createOperatorBackup,
  getBackupDestinationSetting,
  getBackupStatus,
  getRecoveryCapabilities,
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

/** A backup older than this is flagged on the status line (WS-H-3). */
const STALE_BACKUP_MS = 3 * 24 * 60 * 60 * 1000;

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
    // WS-H-3
    lastBackup: 'Last successful backup: {date}',
    noBackupYet: 'No backup has been made yet.',
    lastBackupFailed: 'The last backup attempt failed.',
    destinationDefaultHelp: 'Default folder on this computer. For real protection choose a USB drive or another disk.',
    sameDriveWarning: 'This folder is on the same disk as your data. If the disk fails, the backups are lost too.',
    kind: 'Backup type',
    kindManual: 'Manual',
    kindDaily: 'Daily automatic',
    kindPreUpdate: 'Before update',
    kindPreRestore: 'Before restore',
    kindUnknown: 'Unknown',
    restorable: 'Can be restored by this version',
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
    // WS-H-3
    lastBackup: 'Dernière sauvegarde réussie : {date}',
    noBackupYet: 'Aucune sauvegarde n’a encore été faite.',
    lastBackupFailed: 'La dernière tentative de sauvegarde a échoué.',
    destinationDefaultHelp: 'Dossier par défaut sur cet ordinateur. Pour une vraie protection, choisissez une clé USB ou un autre disque.',
    sameDriveWarning: 'Ce dossier est sur le même disque que vos données. Si le disque tombe en panne, les sauvegardes sont perdues aussi.',
    kind: 'Type de sauvegarde',
    kindManual: 'Manuelle',
    kindDaily: 'Automatique quotidienne',
    kindPreUpdate: 'Avant mise à jour',
    kindPreRestore: 'Avant restauration',
    kindUnknown: 'Inconnu',
    restorable: 'Restaurable par cette version',
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
    // WS-H-3 — English copies until WS-H-7 translates them.
    // TODO(WS-H-7)
    lastBackup: 'Last successful backup: {date}',
    // TODO(WS-H-7)
    noBackupYet: 'No backup has been made yet.',
    // TODO(WS-H-7)
    lastBackupFailed: 'The last backup attempt failed.',
    // TODO(WS-H-7)
    destinationDefaultHelp: 'Default folder on this computer. For real protection choose a USB drive or another disk.',
    // TODO(WS-H-7)
    sameDriveWarning: 'This folder is on the same disk as your data. If the disk fails, the backups are lost too.',
    // TODO(WS-H-7)
    kind: 'Backup type',
    // TODO(WS-H-7)
    kindManual: 'Manual',
    // TODO(WS-H-7)
    kindDaily: 'Daily automatic',
    // TODO(WS-H-7)
    kindPreUpdate: 'Before update',
    // TODO(WS-H-7)
    kindPreRestore: 'Before restore',
    // TODO(WS-H-7)
    kindUnknown: 'Unknown',
    // TODO(WS-H-7)
    restorable: 'Can be restored by this version',
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

function kindLabel(kind: BackupKind | undefined, text: Record<string, string>): string {
  switch (kind) {
    case 'MANUAL':
      return text.kindManual;
    case 'DAILY':
      return text.kindDaily;
    case 'PRE_UPDATE':
      return text.kindPreUpdate;
    case 'PRE_RESTORE':
      return text.kindPreRestore;
    default:
      return text.kindUnknown;
  }
}

function formatDateTime(iso: string, locale: Locale): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

type StatusTone = 'success' | 'warning' | 'error';

/**
 * WS-H-3 status line: warning when no backup exists or the last one is older
 * than three days; error when the most recent attempt failed after the last
 * success.
 */
function describeStatus(
  status: BackupStatus,
  now: number,
): { tone: StatusTone; failed: boolean; stale: boolean } {
  const successAt = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : null;
  const failureAt = status.lastFailureAt ? new Date(status.lastFailureAt).getTime() : null;
  const failed = failureAt !== null && (successAt === null || failureAt > successAt);
  const stale = successAt === null || now - successAt > STALE_BACKUP_MS;
  if (failed) return { tone: 'error', failed, stale };
  if (stale) return { tone: 'warning', failed, stale };
  return { tone: 'success', failed, stale };
}

export function RecoverySettingsScreen({ sessionToken }: Props) {
  const { locale, t } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  // WS-H-3: `undefined` = still loading (render nothing); `null` = the user
  // may not see this screen at all (no capability, or the call failed).
  const [capabilities, setCapabilities] = useState<RecoveryCapabilities | null | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [bundlePath, setBundlePath] = useState('');
  const [destination, setDestination] = useState<BackupDestinationSetting | null>(null);
  const [restoreEnabled, setRestoreEnabled] = useState<boolean | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<OperatorBackupValidationResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<OperatorRestoreVerificationResult | null>(null);

  useEffect(() => {
    let active = true;
    void getRecoveryCapabilities(sessionToken)
      .then((loaded) => {
        if (active) setCapabilities(loaded);
      })
      .catch(() => {
        // A failed capabilities call (including SESSION_INVALID, handled by
        // the session layer) hides the screen rather than showing errors.
        if (active) setCapabilities(null);
      });
    return () => {
      active = false;
    };
  }, [sessionToken]);

  const mode = capabilities?.mode ?? null;
  const usable = capabilities !== null && capabilities !== undefined && mode !== 'UNAVAILABLE';
  const canCreate = usable && capabilities.canCreateBackup;
  const canValidate = usable && capabilities.canValidateBackup;
  const canVerify = usable && capabilities.canVerifyRestore;

  useEffect(() => {
    if (!canVerify) return;
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
  }, [canVerify, errorText, sessionToken]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    void getBackupDestinationSetting(sessionToken)
      .then((setting) => {
        if (active) setDestination(setting);
      })
      .catch((settingError) => {
        if (active) setError(errorText(settingError));
      });
    return () => {
      active = false;
    };
  }, [canCreate, errorText, sessionToken]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    void getBackupStatus(sessionToken)
      .then((loaded) => {
        if (active) setStatus(loaded);
      })
      .catch(() => {
        // The status line is informational; a failure just leaves it off.
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, [canCreate, sessionToken, statusRefresh]);

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
      await updateBackupDestinationSetting(sessionToken, { path: selected });
      // Re-fetch: the effective path, default flag and same-drive warning
      // are computed by the backend, not by the setter's response.
      setDestination(await getBackupDestinationSetting(sessionToken));
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
      setStatusRefresh((value) => value + 1);
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

  // WS-H-3: nothing is rendered until the capabilities are known, and
  // nothing at all for a user without any recovery permission (cashier).
  if (capabilities === undefined) return null;
  if (mode === 'UNAVAILABLE') {
    return (
      <section className="sk-page sk-settings-page" aria-labelledby="recovery-settings-title">
        <div className="sk-settings-card">
          <div className="sk-settings-card__header">
            <div className="sk-settings-card__title-group">
              <h2 id="recovery-settings-title" className="sk-settings-card__title">{text.title}</h2>
            </div>
          </div>
          <Banner tone="error">{t('errors.recoveryUnavailable')}</Banner>
        </div>
      </section>
    );
  }
  if (!canCreate && !canValidate && !canVerify && !capabilities?.canRestoreLive) return null;

  const statusView = status ? describeStatus(status, Date.now()) : null;

  return (
    <section className="sk-page sk-settings-page" aria-labelledby="recovery-settings-title">
      <div className="sk-settings-card">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 id="recovery-settings-title" className="sk-settings-card__title">{text.title}</h2>
            <p className="sk-settings-card__desc">{text.subtitle}</p>
          </div>
        </div>

        {canCreate && status && statusView ? (
          <div data-testid="backup-status-line">
            <Banner tone={statusView.tone}>
              {status.lastSuccessAt
                ? text.lastBackup.replace('{date}', formatDateTime(status.lastSuccessAt, locale))
                : text.noBackupYet}
              {statusView.failed ? ` ${text.lastBackupFailed}` : ''}
            </Banner>
          </div>
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-recovery-section">
          {canCreate ? (
            <div className="sk-recovery-box" data-testid="destination-box">
              <div className="sk-recovery-box__header">
                <div>
                  <h3 className="sk-recovery-box__title">{text.destination}</h3>
                  <p className="sk-recovery-box__desc">{text.destinationHelp}</p>
                </div>
              </div>
              <div className="sk-recovery-input-row">
                <TextField
                  label={text.destination}
                  value={destination?.effectivePath ?? ''}
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
              {destination?.isDefault ? (
                <small className="sk-field-help">{text.destinationDefaultHelp}</small>
              ) : null}
              {destination && destination.available === false ? (
                <Banner tone="error">{t('errors.backupDestinationUnavailable')}</Banner>
              ) : null}
              {destination?.sameDriveWarning ? (
                <Banner tone="warning">{text.sameDriveWarning}</Banner>
              ) : null}
            </div>
          ) : null}

          {canCreate ? (
            <div className="sk-recovery-box">
              <div className="sk-recovery-box__header">
                <div>
                  <h3 className="sk-recovery-box__title">{text.create}</h3>
                  <p className="sk-recovery-box__desc">{text.createHelp}</p>
                </div>
                <Button
                  type="button"
                  loading={busy === 'create'}
                  disabled={busy !== null}
                  onClick={() => void create()}
                >
                  {text.create}
                </Button>
              </div>
            </div>
          ) : null}

          {canValidate ? (
            <div className="sk-recovery-box">
              <div className="sk-recovery-box__header">
                <div>
                  <h3 className="sk-recovery-box__title">{text.validate}</h3>
                  <p className="sk-recovery-box__desc">{text.validateHelp}</p>
                </div>
              </div>
              <div className="sk-recovery-input-row">
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
          ) : null}
        </div>

        {result ? (
          <dl className="sk-details-grid" data-testid="backup-result" style={{ marginTop: '20px' }}>
            <div><dt>{text.bundle}</dt><dd>{result.bundleIdentifier}</dd></div>
            {/* WS-H-3 (R5): the application version is informational; only a
                mismatch is worth a label. */}
            <div><dt>{text.application}</dt><dd>{result.applicationCompatible ? result.applicationVersion : `${result.applicationVersion} · ${text.incompatible}`}</dd></div>
            <div><dt>{text.schema}</dt><dd>{result.schemaVersion} · {compatibilityLabel(result.schemaCompatible, text)}</dd></div>
            <div><dt>{text.postgres}</dt><dd>{result.postgresMajorVersion} · {compatibilityLabel(result.postgresCompatible, text)}</dd></div>
            {result.backupKind !== undefined ? (
              <div><dt>{text.kind}</dt><dd>{kindLabel(result.backupKind, text)}</dd></div>
            ) : null}
            {result.restorable !== undefined ? (
              <div><dt>{text.restorable}</dt><dd>{result.restorable ? text.yes : text.no}</dd></div>
            ) : null}
            <div><dt>{text.files}</dt><dd>{new Intl.NumberFormat(locale).format(result.fileCount)}</dd></div>
            <div><dt>{text.bytes}</dt><dd>{new Intl.NumberFormat(locale).format(result.totalBytes)}</dd></div>
          </dl>
        ) : null}
      </div>

      {canVerify ? (
      <div className="sk-settings-card" aria-labelledby="recovery-restore-title">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 id="recovery-restore-title" className="sk-settings-card__title">
              {text.restoreAvailableTitle}
            </h2>
            <p className="sk-settings-card__desc">{text.restoreAvailableBody}</p>
          </div>
        </div>

        <Banner tone="warning">{text.recoveryBoundary}</Banner>

        <fieldset className="sk-form" style={{ marginTop: '16px' }}>
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
      ) : null}
    </section>
  );
}
