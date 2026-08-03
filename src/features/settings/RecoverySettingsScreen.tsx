import { useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { codeForError, useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type { OperatorBackupValidationResult } from '../../shared/ipc/recoveryDto';
import { validateOperatorBackup } from '../../shared/ipc/recoveryGateway';

interface Props {
  sessionToken: string;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Backup and recovery',
    subtitle: 'Validate an existing Stockiha backup',
    help: 'Enter the full path of a GestStock-Backup folder located directly inside the configured backup directory.',
    path: 'Backup folder path',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'Validate backup',
    restoreUnavailable: 'Restore is intentionally unavailable. R6-001 only verifies backup integrity and compatibility.',
    creationPending: 'Creating new backup bundles will be enabled after the current schema metadata is wired into the production backup flow.',
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
    subtitle: 'Valider une sauvegarde Stockiha existante',
    help: 'Saisissez le chemin complet d’un dossier GestStock-Backup placé directement dans le répertoire de sauvegarde configuré.',
    path: 'Chemin du dossier de sauvegarde',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'Valider la sauvegarde',
    restoreUnavailable: 'La restauration est volontairement indisponible. R6-001 vérifie uniquement l’intégrité et la compatibilité.',
    creationPending: 'La création de nouvelles sauvegardes sera activée après le raccordement de la version réelle du schéma au flux de sauvegarde.',
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
    subtitle: 'التحقق من نسخة احتياطية موجودة',
    help: 'أدخل المسار الكامل لمجلد GestStock-Backup الموجود مباشرة داخل مجلد النسخ الاحتياطي المضبوط.',
    path: 'مسار مجلد النسخة الاحتياطية',
    placeholder: 'C:\\Stockiha Backups\\GestStock-Backup-20260803-195700',
    validate: 'التحقق من النسخة',
    restoreUnavailable: 'الاسترجاع غير متاح عمداً. تقوم R6-001 فقط بفحص السلامة والتوافق.',
    creationPending: 'سيتم تفعيل إنشاء نسخ جديدة بعد ربط إصدار قاعدة البيانات الحقيقي بمسار النسخ الاحتياطي.',
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

function nextRequestId(): string {
  requestSequence += 1;
  return `backup-validate-${Date.now()}-${requestSequence}`;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OperatorBackupValidationResult | null>(null);

  async function validate() {
    if (!bundlePath.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const validated = await validateOperatorBackup(sessionToken, {
        requestId: nextRequestId(),
        bundlePath: bundlePath.trim(),
      });
      setResult(validated);
    } catch (validationError) {
      setError(
        codeForError(validationError) === 'BACKUP_VALIDATION_FAILED'
          ? text.invalid
          : errorText(validationError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-page" aria-labelledby="recovery-settings-title">
      <div className="sk-card">
        <h2 id="recovery-settings-title">{text.title}</h2>
        <p>{text.subtitle}</p>

        <Banner tone="warning">{text.restoreUnavailable}</Banner>
        <Banner tone="info">{text.creationPending}</Banner>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {result ? <Banner tone="success">{text.valid}</Banner> : null}

        <div className="sk-stack">
          <TextField
            label={text.path}
            value={bundlePath}
            placeholder={text.placeholder}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setBundlePath(event.target.value)}
          />
          <small className="sk-field-help">{text.help}</small>
          <div>
            <Button
              type="button"
              loading={busy}
              disabled={!bundlePath.trim()}
              onClick={() => void validate()}
            >
              {text.validate}
            </Button>
          </div>
        </div>

        {result ? (
          <dl className="sk-details-grid" data-testid="backup-validation-result">
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
