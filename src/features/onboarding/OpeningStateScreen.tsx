import { useEffect, useMemo, useState } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type {
  OpeningStateApprovalResult,
  OpeningStateLineInput,
  OpeningStateLineType,
  OpeningStateValidationResult,
} from '../../shared/ipc/openingStateDto';
import {
  approveOpeningStatePackage,
  createOpeningStatePackage,
  getOpeningStateSetting,
  replaceOpeningStatePackageData,
  updateOpeningStateSetting,
  validateOpeningStatePackage,
} from '../../shared/ipc/openingStateGateway';

interface Props {
  sessionToken: string;
}

interface LineDraft {
  lineType: OpeningStateLineType;
  description: string;
  amountDzd: string;
  counterpartyName: string;
  externalReference: string;
  notes: string;
}

type BusyAction = 'setting' | 'validate' | 'approve' | null;

const LINE_TYPES: OpeningStateLineType[] = [
  'CASH',
  'BANK',
  'INVENTORY_VALUE',
  'CUSTOMER_RECEIVABLE',
  'SUPPLIER_PAYABLE',
  'LOAN_PAYABLE',
  'TAX_PAYABLE',
  'OWNER_CAPITAL',
  'RETAINED_EARNINGS',
  'OTHER_ASSET',
  'OTHER_LIABILITY',
];

const INITIAL_LINES: LineDraft[] = [
  {
    lineType: 'CASH',
    description: 'Cash on hand at cutover',
    amountDzd: '',
    counterpartyName: '',
    externalReference: '',
    notes: '',
  },
  {
    lineType: 'BANK',
    description: 'Bank balance at cutover',
    amountDzd: '',
    counterpartyName: '',
    externalReference: '',
    notes: '',
  },
  {
    lineType: 'INVENTORY_VALUE',
    description: 'Current inventory financial value',
    amountDzd: '',
    counterpartyName: '',
    externalReference: '',
    notes: '',
  },
  {
    lineType: 'OWNER_CAPITAL',
    description: 'Owner capital and accumulated result',
    amountDzd: '',
    counterpartyName: '',
    externalReference: '',
    notes: '',
  },
];

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Opening-state reconciliation',
    subtitle: 'Record what the business owns and owes on the Stockiha go-live date.',
    safety: 'Approval only marks the package ready for a later controlled application. This screen does not create live cash, stock, receivables, payables, sales, purchases, or journals.',
    enabled: 'Opening-state reconciliation enabled',
    enabledHelp: 'Administrator control. It is ON by default and blocks new packages when disabled.',
    cutoverDate: 'Cutover date',
    linesTitle: 'Current balances',
    linesHelp: 'Enter zero explicitly when cash, bank, or inventory value is zero. Customer and supplier balances require a name.',
    type: 'Balance type',
    description: 'Description',
    amount: 'Amount (DZD)',
    counterparty: 'Customer / Supplier name',
    reference: 'Reference (optional)',
    notes: 'Notes (optional)',
    addLine: 'Add balance line',
    remove: 'Remove',
    validate: 'Stage and reconcile',
    approve: 'Approve as ready for application',
    validated: 'The opening-state package is balanced and ready for approval.',
    needsReview: 'The package requires correction before approval.',
    approved: 'Opening state approved as ready for a later controlled application.',
    assets: 'Assets',
    liabilities: 'Liabilities',
    equity: 'Equity',
    difference: 'Reconciliation difference',
    equation: 'Required: Assets = Liabilities + Equity',
    invalid: 'Complete the cutover date and every line with a non-negative whole-DZD amount.',
    customerRequired: 'Customer receivables require a customer name.',
    supplierRequired: 'Supplier payables require a supplier name.',
    errors: 'Validation issues',
  },
  fr: {
    title: 'Rapprochement de la situation initiale',
    subtitle: 'Enregistrer ce que l’entreprise possède et doit à la date de démarrage Stockiha.',
    safety: 'L’approbation indique seulement que le dossier est prêt pour une application contrôlée ultérieure. Cet écran ne crée aucune caisse, stock, créance, dette, vente, achat ou écriture comptable active.',
    enabled: 'Rapprochement de la situation initiale activé',
    enabledHelp: 'Contrôle administrateur. Activé par défaut et bloque les nouveaux dossiers lorsqu’il est désactivé.',
    cutoverDate: 'Date de démarrage',
    linesTitle: 'Soldes actuels',
    linesHelp: 'Saisissez explicitement zéro si la caisse, la banque ou le stock vaut zéro. Les créances et dettes exigent un nom.',
    type: 'Type de solde',
    description: 'Description',
    amount: 'Montant (DZD)',
    counterparty: 'Nom du client / fournisseur',
    reference: 'Référence (facultatif)',
    notes: 'Notes (facultatif)',
    addLine: 'Ajouter une ligne',
    remove: 'Supprimer',
    validate: 'Préparer et rapprocher',
    approve: 'Approuver comme prêt à appliquer',
    validated: 'Le dossier est équilibré et prêt pour approbation.',
    needsReview: 'Le dossier doit être corrigé avant approbation.',
    approved: 'Situation initiale approuvée pour une application contrôlée ultérieure.',
    assets: 'Actifs',
    liabilities: 'Passifs',
    equity: 'Capitaux propres',
    difference: 'Écart de rapprochement',
    equation: 'Obligatoire : Actifs = Passifs + Capitaux propres',
    invalid: 'Complétez la date et chaque ligne avec un montant DZD entier et non négatif.',
    customerRequired: 'Une créance client exige le nom du client.',
    supplierRequired: 'Une dette fournisseur exige le nom du fournisseur.',
    errors: 'Problèmes de validation',
  },
  ar: {
    title: 'مطابقة الوضعية الافتتاحية',
    subtitle: 'تسجيل ما تملكه المؤسسة وما عليها في تاريخ بدء استعمال Stockiha.',
    safety: 'الموافقة تعني فقط أن الملف جاهز لتطبيق مضبوط لاحقاً. هذه الشاشة لا تنشئ حركة صندوق أو مخزون أو ديوناً أو مبيعات أو مشتريات أو قيوداً محاسبية مباشرة.',
    enabled: 'تفعيل مطابقة الوضعية الافتتاحية',
    enabledHelp: 'إعداد المسؤول. مفعّل افتراضياً ويمنع إنشاء ملفات جديدة عند إيقافه.',
    cutoverDate: 'تاريخ بداية الاستعمال',
    linesTitle: 'الأرصدة الحالية',
    linesHelp: 'أدخل صفراً بوضوح إذا كانت قيمة الصندوق أو البنك أو المخزون صفراً. ديون الزبائن والموردين تتطلب اسماً.',
    type: 'نوع الرصيد',
    description: 'الوصف',
    amount: 'المبلغ (دج)',
    counterparty: 'اسم الزبون / المورد',
    reference: 'المرجع (اختياري)',
    notes: 'ملاحظات (اختياري)',
    addLine: 'إضافة رصيد',
    remove: 'حذف',
    validate: 'حفظ ومطابقة الوضعية',
    approve: 'الموافقة كملف جاهز للتطبيق',
    validated: 'الوضعية متوازنة وجاهزة للموافقة.',
    needsReview: 'يجب تصحيح الملف قبل الموافقة.',
    approved: 'تمت الموافقة على الوضعية لتطبيق مضبوط لاحقاً.',
    assets: 'الأصول',
    liabilities: 'الالتزامات',
    equity: 'حقوق الملكية',
    difference: 'فرق المطابقة',
    equation: 'المطلوب: الأصول = الالتزامات + حقوق الملكية',
    invalid: 'أكمل التاريخ وكل سطر بمبلغ صحيح وغير سالب بالدينار.',
    customerRequired: 'دين الزبون يتطلب اسم الزبون.',
    supplierRequired: 'دين المورد يتطلب اسم المورد.',
    errors: 'مشاكل التحقق',
  },
};

let requestSequence = 0;
function nextRequestId(): string {
  requestSequence += 1;
  return `opening-manual-${Date.now()}-${requestSequence}`;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseAmount(value: string): number | null {
  const normalized = value.replace(/[\s,]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

function formatMoney(value: number, locale: Locale): string {
  return `${new Intl.NumberFormat(locale).format(value)} DZD`;
}

function category(lineType: OpeningStateLineType): 'ASSET' | 'LIABILITY' | 'EQUITY' {
  if (
    lineType === 'SUPPLIER_PAYABLE' ||
    lineType === 'LOAN_PAYABLE' ||
    lineType === 'TAX_PAYABLE' ||
    lineType === 'OTHER_LIABILITY'
  ) {
    return 'LIABILITY';
  }
  if (lineType === 'OWNER_CAPITAL' || lineType === 'RETAINED_EARNINGS') {
    return 'EQUITY';
  }
  return 'ASSET';
}

export function OpeningStateScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [enabled, setEnabled] = useState(true);
  const [cutoverDate, setCutoverDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(INITIAL_LINES);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [validation, setValidation] = useState<OpeningStateValidationResult | null>(null);
  const [approval, setApproval] = useState<OpeningStateApprovalResult | null>(null);

  useEffect(() => {
    let active = true;
    void getOpeningStateSetting(sessionToken)
      .then((result) => {
        if (active) setEnabled(result.enabled);
      })
      .catch((loadError) => {
        if (active) setError(errorText(loadError));
      });
    return () => {
      active = false;
    };
  }, [errorText, sessionToken]);

  const localTotals = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    for (const line of lines) {
      const amount = parseAmount(line.amountDzd) ?? 0;
      const group = category(line.lineType);
      if (group === 'ASSET') assets += amount;
      if (group === 'LIABILITY') liabilities += amount;
      if (group === 'EQUITY') equity += amount;
    }
    return { assets, liabilities, equity, difference: assets - liabilities - equity };
  }, [lines]);

  function updateLine(index: number, changes: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...changes } : line)),
    );
    setValidation(null);
    setApproval(null);
    setFeedback(null);
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        lineType: 'CUSTOMER_RECEIVABLE',
        description: '',
        amountDzd: '',
        counterpartyName: '',
        externalReference: '',
        notes: '',
      },
    ]);
    setValidation(null);
    setApproval(null);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
    setValidation(null);
    setApproval(null);
  }

  async function toggleSetting() {
    if (busy) return;
    setBusy('setting');
    setError(null);
    setFeedback(null);
    try {
      const result = await updateOpeningStateSetting(sessionToken, { enabled: !enabled });
      setEnabled(result.enabled);
    } catch (settingError) {
      setError(errorText(settingError));
    } finally {
      setBusy(null);
    }
  }

  function buildLines(): OpeningStateLineInput[] | null {
    if (!cutoverDate || lines.length === 0) return null;
    const output: OpeningStateLineInput[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const amount = parseAmount(line.amountDzd);
      if (amount === null || !line.description.trim()) return null;
      if (line.lineType === 'CUSTOMER_RECEIVABLE' && !line.counterpartyName.trim()) {
        setError(text.customerRequired);
        return null;
      }
      if (line.lineType === 'SUPPLIER_PAYABLE' && !line.counterpartyName.trim()) {
        setError(text.supplierRequired);
        return null;
      }
      output.push({
        sourceRowNumber: index + 2,
        lineType: line.lineType,
        description: line.description.trim(),
        amountDzd: amount,
        counterpartyName: optional(line.counterpartyName),
        externalReference: optional(line.externalReference),
        notes: optional(line.notes),
        reviewStatus: 'READY',
      });
    }
    return output;
  }

  async function stageAndValidate() {
    if (busy || !enabled) return;
    setError(null);
    setFeedback(null);
    setApproval(null);
    const preparedLines = buildLines();
    if (!preparedLines) {
      setError((current) => current ?? text.invalid);
      return;
    }

    setBusy('validate');
    try {
      const created = await createOpeningStatePackage(sessionToken, {
        requestId: nextRequestId(),
        sourceType: 'MANUAL',
        originalFilename: null,
        cutoverDate,
      });
      await replaceOpeningStatePackageData(sessionToken, {
        packageId: created.packageId,
        lines: preparedLines,
      });
      const result = await validateOpeningStatePackage(sessionToken, {
        packageId: created.packageId,
      });
      setPackageId(created.packageId);
      setValidation(result);
      setFeedback(result.status === 'VALIDATED' ? text.validated : text.needsReview);
    } catch (validationError) {
      setError(errorText(validationError));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (busy || packageId === null || validation?.status !== 'VALIDATED') return;
    setBusy('approve');
    setError(null);
    setFeedback(null);
    try {
      const result = await approveOpeningStatePackage(sessionToken, { packageId });
      setApproval(result);
      setFeedback(text.approved);
    } catch (approvalError) {
      setError(errorText(approvalError));
    } finally {
      setBusy(null);
    }
  }

  const displayedTotals = validation
    ? {
        assets: validation.totalAssetsDzd,
        liabilities: validation.totalLiabilitiesDzd,
        equity: validation.totalEquityDzd,
        difference: validation.reconciliationDifferenceDzd,
      }
    : localTotals;

  return (
    <section className="sk-page" aria-labelledby="opening-state-title">
      <div className="sk-card">
        <h1 id="opening-state-title">{text.title}</h1>
        <p>{text.subtitle}</p>
        <Banner tone="warning">{text.safety}</Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? (
          <Banner tone={validation?.status === 'NEEDS_REVIEW' ? 'warning' : 'success'}>
            {feedback}
          </Banner>
        ) : null}

        <div className="sk-stack">
          <label className="sk-field__label">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy !== null}
              onChange={() => void toggleSetting()}
            />{' '}
            {text.enabled}
          </label>
          <small className="sk-field-help">{text.enabledHelp}</small>
          <TextField
            label={text.cutoverDate}
            type="date"
            value={cutoverDate}
            disabled={!enabled || busy !== null || approval !== null}
            onChange={(event) => {
              setCutoverDate(event.target.value);
              setValidation(null);
              setApproval(null);
            }}
          />
        </div>
      </div>

      <div className="sk-card">
        <h2>{text.linesTitle}</h2>
        <p>{text.linesHelp}</p>
        <div className="sk-stack">
          {lines.map((line, index) => (
            <div className="sk-card" key={`${index}-${line.lineType}`}>
              <div className="sk-grid sk-grid--2">
                <div className="sk-field">
                  <label className="sk-field__label" htmlFor={`opening-type-${index}`}>
                    {text.type}
                  </label>
                  <select
                    id={`opening-type-${index}`}
                    className="sk-field__input"
                    value={line.lineType}
                    disabled={!enabled || busy !== null || approval !== null}
                    onChange={(event) =>
                      updateLine(index, { lineType: event.target.value as OpeningStateLineType })
                    }
                  >
                    {LINE_TYPES.map((lineType) => (
                      <option key={lineType} value={lineType}>
                        {lineType}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField
                  label={text.amount}
                  inputMode="numeric"
                  value={line.amountDzd}
                  disabled={!enabled || busy !== null || approval !== null}
                  onChange={(event) => updateLine(index, { amountDzd: event.target.value })}
                />
                <TextField
                  label={text.description}
                  value={line.description}
                  disabled={!enabled || busy !== null || approval !== null}
                  onChange={(event) => updateLine(index, { description: event.target.value })}
                />
                <TextField
                  label={text.counterparty}
                  value={line.counterpartyName}
                  disabled={!enabled || busy !== null || approval !== null}
                  onChange={(event) => updateLine(index, { counterpartyName: event.target.value })}
                />
                <TextField
                  label={text.reference}
                  value={line.externalReference}
                  disabled={!enabled || busy !== null || approval !== null}
                  onChange={(event) => updateLine(index, { externalReference: event.target.value })}
                />
                <TextField
                  label={text.notes}
                  value={line.notes}
                  disabled={!enabled || busy !== null || approval !== null}
                  onChange={(event) => updateLine(index, { notes: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!enabled || busy !== null || approval !== null}
                onClick={() => removeLine(index)}
              >
                {text.remove}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={!enabled || busy !== null || approval !== null}
            onClick={addLine}
          >
            {text.addLine}
          </Button>
        </div>
      </div>

      <div className="sk-card">
        <h2>{text.equation}</h2>
        <dl className="sk-details-grid" data-testid="opening-state-totals">
          <div><dt>{text.assets}</dt><dd>{formatMoney(displayedTotals.assets, locale)}</dd></div>
          <div><dt>{text.liabilities}</dt><dd>{formatMoney(displayedTotals.liabilities, locale)}</dd></div>
          <div><dt>{text.equity}</dt><dd>{formatMoney(displayedTotals.equity, locale)}</dd></div>
          <div><dt>{text.difference}</dt><dd>{formatMoney(displayedTotals.difference, locale)}</dd></div>
        </dl>

        {validation && validation.validationErrors.length > 0 ? (
          <div>
            <h3>{text.errors}</h3>
            <ul>
              {validation.validationErrors.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="sk-actions">
          <Button
            type="button"
            loading={busy === 'validate'}
            disabled={!enabled || busy !== null || approval !== null}
            onClick={() => void stageAndValidate()}
          >
            {text.validate}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === 'approve'}
            disabled={validation?.status !== 'VALIDATED' || busy !== null || approval !== null}
            onClick={() => void approve()}
          >
            {text.approve}
          </Button>
        </div>
      </div>
    </section>
  );
}
