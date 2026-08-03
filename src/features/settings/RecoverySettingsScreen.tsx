import { useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type { OperatorBackupValidationResult } from '../../shared/ipc/recoveryDto';
import {
  createOperatorBackup,
  validateOperatorBackup,
} from '../../shared/ipc/recoveryGateway';

interface Props {
  sessionToken: string;
}

type BusyAction = 'create' | 'validate' | null;

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Backup and recovery',
    subtitle: 'Create or validate a Stockiha backup',
    createHelp: 'Creates a new verified bundle inside the configured backup directory. The destination, PostgreSQL role, credential, and pg_dump executable are resolved by the backend.',
    create: 'Create backup',
    created: 'Backup created and verified.',
    creationFailed: 'The backup could not be created. No partial bundle was published.',
    validateHelp: 'Enter the full path of a GestStock-Backup folder located directly inside the configured backup directory.',
    path: 'Existing backup folder path',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'Validate backup',
    restoreUnavailable: 'Restore is intentionally unavailable. R6-001 creates and verifies backups but never replaces the live database.',
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
  },
  fr: {
    title: 'Sauvegarde et récupération',
    subtitle: 'Créer ou valider une sauvegarde Stockiha',
    createHelp: 'Crée une nouvelle sauvegarde vérifiée dans le répertoire configuré. La destination, le rôle PostgreSQL, le secret et pg_dump sont résolus par le backend.',
    create: 'Créer une sauvegarde',
    created: 'Sauvegarde créée et vérifiée.',
    creationFailed: 'La sauvegarde n’a pas pu être créée. Aucun dossier partiel n’a été publié.',
    validateHelp: 'Saisissez le chemin complet d’un dossier GestStock-Backup placé directement dans le répertoire de sauvegarde configuré.',
    path: 'Chemin d’une sauvegarde existante',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'Valider la sauvegarde',
    restoreUnavailable: 'La restauration est volontairement indisponible. R6-001 crée et vérifie les sauvegardes sans remplacer la base active.',
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
  },
  ar: {
    title: 'النسخ الاحتياطي والاسترجاع',
    subtitle: 'إنشاء نسخة احتياطية أو التحقق منها',
    createHelp: 'ينشئ نسخة جديدة ويتم التحقق منها داخل مجلد النسخ المضبوط. يحدد النظام المسار ودور PostgreSQL وكلمة السر وpg_dump داخلياً.',
    create: 'إنشاء نسخة احتياطية',
    created: 'تم إنشاء النسخة الاحتياطية والتحقق منها.',
    creationFailed: 'تعذر إنشاء النسخة الاحتياطية. لم يتم نشر أي مجلد ناقص.',
    validateHelp: 'أدخل المسار الكامل لمجلد GestStock-Backup الموجود مباشرة داخل مجلد النسخ الاحتياطي المضبوط.',
    path: 'مسار نسخة احتياطية موجودة',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'التحقق من النسخة',
    restoreUnavailable: 'الاسترجاع غير متاح عمداً. تنشئ R6-001 النسخ وتتحقق منها دون استبدال قاعدة البيانات الحالية.',
    valid: 'تم التحقق من سلامة النسخة الاحتياطية.',
    invalid: 'تعذر التحقق من النسخة الاحتياطية. لم يتم تعديلها أو إصلاحها.',
    bundle: 'النسخة',
    application: 'إصدار التطبيق',
    schema: 'إصدار قاعدة البيانات',
    postgres: 'PostgreSQL',
    files: 'الملفات',
    bytes: 'الحجم الإجمالي',
    compatible: 'متوافق',
    incompatible: 'إصدار مختلف',
  },
};

let requestSequence = 0;

function nextRequestId(operation: 'create' | 'validate'): string {
  requestSequence += 1;
  return `backup-${operation}-${Date.now()}-${requestSequence}`;
}

function compatibilityLabel(
  compatible: boolean,
  text: Record<string, string>,
): string {
  return compatible ? text.compatible : text.incompatible;
}

export function RecoverySettingsScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [bundlePath, setBundlePath] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<OperatorBackupValidationResult | null>(null);

  async function create() {
    if (busy) return;
    setBusy('create');
    setError(null);
    setFeedback(null);
    setResult(null);
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
    setError(null);
    setFeedback(null);
    setResult(null);
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

  return (
    <section className="sk-page" aria-labelledby="recovery-settings-title">
      <div className="sk-card">
        <h2 id="recovery-settings-title">{text.title}</h2>
        <p>{text.subtitle}</p>

        <Banner tone="warning">{text.restoreUnavailable}</Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-stack">
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
            onChange={(event) => setBundlePath(event.target.value)}
          />
          <small className="sk-field-help">{text.validateHelp}</small>
          <div>
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
            <div>
              <dt>{text.bundle}</dt>
              <dd>{result.bundleIdentifier}</dd>
            </div>
            <div>
              <dt>{text.application}</dt>
              <dd>
                {result.applicationVersion} · {compatibilityLabel(result.applicationCompatible, text)}
              </dd>
            </div>
            <div>
              <dt>{text.schema}</dt>
              <dd>
                {result.schemaVersion} · {compatibilityLabel(result.schemaCompatible, text)}
              </dd>
            </div>
            <div>
              <dt>{text.postgres}</dt>
              <dd>
                {result.postgresMajorVersion} · {compatibilityLabel(result.postgresCompatible, text)}
              </dd>
            </div>
            <div>
              <dt>{text.files}</dt>
              <dd>{new Intl.NumberFormat(locale).format(result.fileCount)}</dd>
            </div>
            <div>
              <dt>{text.bytes}</dt>
              <dd>{new Intl.NumberFormat(locale).format(result.totalBytes)}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
