import type { Locale } from '../../shared/i18n';

export type ImportStep = 'select' | 'parsed' | 'validated' | 'approved';

interface Props {
  currentStep: ImportStep;
  hasErrors?: boolean;
  locale: Locale;
}

const STEP_LABELS: Record<Locale, Record<ImportStep, string>> = {
  en: {
    select: '1. Select Workbook',
    parsed: '2. Excel Parsed',
    validated: '3. Staged & Validated',
    approved: '4. Approved for Reporting',
  },
  fr: {
    select: '1. Sélectionner Classeur',
    parsed: '2. Classeur Analysé',
    validated: '3. Préparé & Validé',
    approved: '4. Approuvé pour Reporting',
  },
  ar: {
    select: '1. اختيار الملف',
    parsed: '2. فحص الملف',
    validated: '3. الحفظ والتحقق',
    approved: '4. اعتماد التقارير',
  },
};

export function HistoricalImportStepper({ currentStep, hasErrors = false, locale }: Props) {
  const steps: ImportStep[] = ['select', 'parsed', 'validated', 'approved'];
  const labels = STEP_LABELS[locale];

  const getStepStatus = (step: ImportStep) => {
    const currentIndex = steps.indexOf(currentStep);
    const stepIndex = steps.indexOf(step);

    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return hasErrors ? 'error' : 'active';
    return 'pending';
  };

  return (
    <div className="sk-import-stepper" data-testid="import-stepper">
      {steps.map((step, idx) => {
        const status = getStepStatus(step);
        return (
          <div key={step} className={`sk-import-stepper__step sk-import-stepper__step--${status}`}>
            <div className="sk-import-stepper__indicator">
              {status === 'completed' ? (
                <svg viewBox="0 0 20 20" fill="currentColor" className="sk-icon--sm">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <span>{idx + 1}</span>
              )}
            </div>
            <span className="sk-import-stepper__label">{labels[step]}</span>
            {idx < steps.length - 1 && <div className="sk-import-stepper__connector" />}
          </div>
        );
      })}
    </div>
  );
}
