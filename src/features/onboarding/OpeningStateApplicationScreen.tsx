import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner, Button, ConfirmDialog, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import { listCustomers } from '../../shared/ipc/customerGateway';
import type { Customer } from '../../shared/ipc/customerDto';
import { listSuppliers } from '../../shared/ipc/gateway';
import type { Supplier } from '../../shared/ipc/dto';
import type {
  OpeningStateApplicationContextResult,
  OpeningStateApplicationLine,
  OpeningStateApplicationMappingInput,
  OpeningStateApplicationResult,
} from '../../shared/ipc/openingStateApplicationDto';
import {
  applyOpeningState,
  getOpeningStateApplicationContext,
  updateOpeningStateApplicationSetting,
} from '../../shared/ipc/openingStateApplicationGateway';

interface Props {
  sessionToken: string;
  openFiscalPeriodId: number | null;
  onApplied: () => void;
  onCancel: () => void;
}

type MappingDraft = Record<number, string>;

type Copy = {
  title: string;
  subtitle: string;
  irreversible: string;
  inventoryWarning: string;
  noPeriod: string;
  noPackage: string;
  alreadyApplied: string;
  disabled: string;
  enable: string;
  cutoverDate: string;
  assets: string;
  liabilities: string;
  equity: string;
  lineType: string;
  evidence: string;
  amount: string;
  destination: string;
  fixedAccount: string;
  chooseCustomer: string;
  chooseSupplier: string;
  chooseAccount: string;
  customerEvidence: string;
  supplierEvidence: string;
  acknowledge: string;
  apply: string;
  back: string;
  confirmTitle: string;
  confirmBody: string;
  confirm: string;
  cancel: string;
  mappingRequired: string;
  applied: string;
  applicationId: string;
  journalId: string;
  physicalIncomplete: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    title: 'Apply opening state',
    subtitle: 'Final administrator review before the approved balances enter the live financial ledgers.',
    irreversible: 'This is a one-time, immutable cutover operation. Corrections after application require a controlled accounting correction; the original evidence cannot be edited.',
    inventoryWarning: 'Inventory value is financial only. This operation does not create product quantities, warehouse positions, movements, or weighted-average costs.',
    noPeriod: 'An open fiscal period containing the cutover date is required.',
    noPackage: 'There is no approved opening-state package ready to apply.',
    alreadyApplied: 'The opening state has already been applied.',
    disabled: 'Opening-state application is disabled by the administrator setting.',
    enable: 'Enable application',
    cutoverDate: 'Cutover date',
    assets: 'Assets',
    liabilities: 'Liabilities',
    equity: 'Equity',
    lineType: 'Balance type',
    evidence: 'Approved evidence',
    amount: 'Amount',
    destination: 'Live destination',
    fixedAccount: 'Controlled account',
    chooseCustomer: 'Select the existing customer',
    chooseSupplier: 'Select the existing supplier',
    chooseAccount: 'Select the controlled account',
    customerEvidence: 'Evidence customer name',
    supplierEvidence: 'Evidence supplier name',
    acknowledge: 'I understand that this applies the balances once and creates immutable live financial records.',
    apply: 'Apply opening state once',
    back: 'Back to settings',
    confirmTitle: 'Confirm one-time opening-state application',
    confirmBody: 'This will post one balanced journal and create the mapped customer receivables and supplier liabilities. It cannot be undone by editing or deleting the opening state.',
    confirm: 'Apply permanently',
    cancel: 'Cancel',
    mappingRequired: 'Complete every required customer, supplier, and controlled-account mapping.',
    applied: 'Opening state applied successfully.',
    applicationId: 'Application ID',
    journalId: 'Opening journal ID',
    physicalIncomplete: 'Physical inventory remains incomplete until item quantities and costs are entered through the dedicated stock workflow.',
  },
  fr: {
    title: 'Appliquer la situation initiale',
    subtitle: 'Dernière vérification administrateur avant l’entrée des soldes approuvés dans les registres financiers actifs.',
    irreversible: 'Il s’agit d’une opération de démarrage unique et immuable. Toute correction ultérieure exige une écriture contrôlée; les preuves d’origine ne peuvent pas être modifiées.',
    inventoryWarning: 'La valeur du stock est uniquement financière. Cette opération ne crée ni quantités, ni positions, ni mouvements, ni coût moyen pondéré.',
    noPeriod: 'Une période comptable ouverte contenant la date de démarrage est obligatoire.',
    noPackage: 'Aucun dossier de situation initiale approuvé n’est prêt à être appliqué.',
    alreadyApplied: 'La situation initiale a déjà été appliquée.',
    disabled: 'L’application de la situation initiale est désactivée par le paramètre administrateur.',
    enable: 'Activer l’application',
    cutoverDate: 'Date de démarrage',
    assets: 'Actifs',
    liabilities: 'Passifs',
    equity: 'Capitaux propres',
    lineType: 'Type de solde',
    evidence: 'Preuve approuvée',
    amount: 'Montant',
    destination: 'Destination active',
    fixedAccount: 'Compte contrôlé',
    chooseCustomer: 'Sélectionner le client existant',
    chooseSupplier: 'Sélectionner le fournisseur existant',
    chooseAccount: 'Sélectionner le compte contrôlé',
    customerEvidence: 'Nom client dans la preuve',
    supplierEvidence: 'Nom fournisseur dans la preuve',
    acknowledge: 'Je comprends que cette action applique les soldes une seule fois et crée des écritures financières immuables.',
    apply: 'Appliquer la situation une seule fois',
    back: 'Retour aux paramètres',
    confirmTitle: 'Confirmer l’application unique',
    confirmBody: 'Cette action comptabilise un journal équilibré et crée les créances clients et dettes fournisseurs associées. Elle ne peut pas être annulée par modification ou suppression.',
    confirm: 'Appliquer définitivement',
    cancel: 'Annuler',
    mappingRequired: 'Complétez chaque correspondance client, fournisseur et compte contrôlé obligatoire.',
    applied: 'Situation initiale appliquée avec succès.',
    applicationId: 'ID d’application',
    journalId: 'ID du journal initial',
    physicalIncomplete: 'Le stock physique reste incomplet jusqu’à la saisie des quantités et coûts par le flux de stock dédié.',
  },
  ar: {
    title: 'تطبيق الوضعية الافتتاحية',
    subtitle: 'المراجعة النهائية للمسؤول قبل إدخال الأرصدة الموافق عليها إلى السجلات المالية الفعلية.',
    irreversible: 'هذه عملية انتقال تُنفذ مرة واحدة ولا يمكن تعديل دليلها بعد التطبيق. أي تصحيح لاحق يتطلب قيداً محاسبياً مضبوطاً.',
    inventoryWarning: 'قيمة المخزون هنا مالية فقط. لا تنشئ هذه العملية كميات منتجات أو أرصدة مخازن أو حركات أو تكلفة متوسطة.',
    noPeriod: 'يجب وجود فترة مالية مفتوحة تشمل تاريخ بداية الاستعمال.',
    noPackage: 'لا يوجد ملف وضعية افتتاحية موافق عليه وجاهز للتطبيق.',
    alreadyApplied: 'تم تطبيق الوضعية الافتتاحية مسبقاً.',
    disabled: 'تطبيق الوضعية الافتتاحية متوقف من إعدادات المسؤول.',
    enable: 'تفعيل التطبيق',
    cutoverDate: 'تاريخ بداية الاستعمال',
    assets: 'الأصول',
    liabilities: 'الالتزامات',
    equity: 'حقوق الملكية',
    lineType: 'نوع الرصيد',
    evidence: 'الدليل الموافق عليه',
    amount: 'المبلغ',
    destination: 'الوجهة الفعلية',
    fixedAccount: 'الحساب المضبوط',
    chooseCustomer: 'اختر الزبون الموجود',
    chooseSupplier: 'اختر المورد الموجود',
    chooseAccount: 'اختر الحساب المضبوط',
    customerEvidence: 'اسم الزبون في الدليل',
    supplierEvidence: 'اسم المورد في الدليل',
    acknowledge: 'أفهم أن هذه العملية تطبق الأرصدة مرة واحدة وتنشئ سجلات مالية فعلية غير قابلة للتعديل.',
    apply: 'تطبيق الوضعية مرة واحدة',
    back: 'العودة إلى الإعدادات',
    confirmTitle: 'تأكيد تطبيق الوضعية مرة واحدة',
    confirmBody: 'سيتم إنشاء قيد متوازن وديون الزبائن والموردين المرتبطة. لا يمكن التراجع عنها بحذف أو تعديل الوضعية الافتتاحية.',
    confirm: 'تطبيق نهائي',
    cancel: 'إلغاء',
    mappingRequired: 'أكمل كل ربط مطلوب للزبائن والموردين والحسابات المضبوطة.',
    applied: 'تم تطبيق الوضعية الافتتاحية بنجاح.',
    applicationId: 'معرف التطبيق',
    journalId: 'معرف القيد الافتتاحي',
    physicalIncomplete: 'يبقى المخزون المادي غير مكتمل إلى أن تُدخل الكميات والتكاليف عبر مسار المخزون المخصص.',
  },
};

function formatMoney(value: number, locale: Locale): string {
  return `${new Intl.NumberFormat(locale).format(value)} DZD`;
}

function requiresMapping(line: OpeningStateApplicationLine): boolean {
  return (
    line.lineType === 'CUSTOMER_RECEIVABLE'
    || line.lineType === 'SUPPLIER_PAYABLE'
    || line.lineType === 'OTHER_ASSET'
    || line.lineType === 'OTHER_LIABILITY'
  );
}

function defaultAccount(line: OpeningStateApplicationLine): string {
  return line.accountOptions.find((option) => option.isDefault)?.accountCode
    ?? line.accountOptions[0]?.accountCode
    ?? '';
}

export function OpeningStateApplicationScreen({
  sessionToken,
  openFiscalPeriodId,
  onApplied,
  onCancel,
}: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [context, setContext] = useState<OpeningStateApplicationContextResult | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [mappings, setMappings] = useState<MappingDraft>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpeningStateApplicationResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextContext, nextCustomers, nextSuppliers] = await Promise.all([
        getOpeningStateApplicationContext(sessionToken),
        listCustomers(sessionToken, false),
        listSuppliers(sessionToken, false),
      ]);
      setContext(nextContext);
      setCustomers(nextCustomers.filter((customer) => customer.is_active));
      setSuppliers(nextSuppliers.filter((supplier) => supplier.is_active));
      setMappings((current) => {
        const next = { ...current };
        for (const line of nextContext.lines) {
          if ((line.lineType === 'OTHER_ASSET' || line.lineType === 'OTHER_LIABILITY') && !next[line.lineId]) {
            next[line.lineId] = defaultAccount(line);
          }
        }
        return next;
      });
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [errorText, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const applicationMappings = useMemo<OpeningStateApplicationMappingInput[] | null>(() => {
    if (!context) return null;
    const output: OpeningStateApplicationMappingInput[] = [];
    for (const line of context.lines) {
      if (!requiresMapping(line)) continue;
      const selected = mappings[line.lineId];
      if (!selected) return null;
      if (line.lineType === 'CUSTOMER_RECEIVABLE') {
        output.push({ lineId: line.lineId, customerId: Number(selected) });
      } else if (line.lineType === 'SUPPLIER_PAYABLE') {
        output.push({ lineId: line.lineId, supplierId: Number(selected) });
      } else {
        output.push({ lineId: line.lineId, accountCode: selected });
      }
    }
    return output;
  }, [context, mappings]);

  async function enableApplication() {
    if (enabling) return;
    setEnabling(true);
    setError(null);
    try {
      await updateOpeningStateApplicationSetting(sessionToken, { enabled: true });
      await load();
    } catch (settingError) {
      setError(errorText(settingError));
    } finally {
      setEnabling(false);
    }
  }

  async function confirmApplication() {
    if (!context?.package || !openFiscalPeriodId || !applicationMappings || applying) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await applyOpeningState(sessionToken, {
        requestId: crypto.randomUUID(),
        packageId: context.package.packageId,
        fiscalPeriodId: openFiscalPeriodId,
        mappings: applicationMappings,
      });
      setResult(applied);
      setConfirming(false);
      await load();
    } catch (applyError) {
      setError(errorText(applyError));
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return <Spinner />;
  }

  if (result) {
    return (
      <section className="sk-screen" data-testid="opening-state-application-success">
        <header className="sk-screen__header">
          <h1>{text.title}</h1>
        </header>
        <Banner tone="success">{text.applied}</Banner>
        <div className="sk-card">
          <p><strong>{text.applicationId}:</strong> {result.applicationId}</p>
          <p><strong>{text.journalId}:</strong> {result.journalDocumentId}</p>
          {result.physicalInventoryIncomplete ? (
            <Banner tone="warning">{text.physicalIncomplete}</Banner>
          ) : null}
        </div>
        <Button type="button" onClick={onApplied}>{text.back}</Button>
      </section>
    );
  }

  if (!context) {
    return (
      <section className="sk-screen">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button type="button" variant="secondary" onClick={onCancel}>{text.back}</Button>
      </section>
    );
  }

  if (context.applied) {
    return (
      <section className="sk-screen">
        <Banner tone="success">{text.alreadyApplied}</Banner>
        <Button type="button" variant="secondary" onClick={onCancel}>{text.back}</Button>
      </section>
    );
  }

  if (!context.hasApprovedPackage || !context.package) {
    return (
      <section className="sk-screen">
        <Banner tone="info">{text.noPackage}</Banner>
        <Button type="button" variant="secondary" onClick={onCancel}>{text.back}</Button>
      </section>
    );
  }

  return (
    <section className="sk-screen" data-testid="opening-state-application-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <Button type="button" variant="secondary" onClick={onCancel}>{text.back}</Button>
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}
      <Banner tone="warning">{text.irreversible}</Banner>
      <Banner tone="info">{text.inventoryWarning}</Banner>

      {!context.enabled ? (
        <div className="sk-card">
          <Banner tone="warning">{text.disabled}</Banner>
          <Button type="button" loading={enabling} onClick={() => void enableApplication()}>
            {text.enable}
          </Button>
        </div>
      ) : null}

      {!openFiscalPeriodId ? <Banner tone="error">{text.noPeriod}</Banner> : null}

      <div className="sk-grid sk-grid--4">
        <div className="sk-card"><strong>{text.cutoverDate}</strong><p>{context.package.cutoverDate}</p></div>
        <div className="sk-card"><strong>{text.assets}</strong><p>{formatMoney(context.package.totalAssetsDzd, locale)}</p></div>
        <div className="sk-card"><strong>{text.liabilities}</strong><p>{formatMoney(context.package.totalLiabilitiesDzd, locale)}</p></div>
        <div className="sk-card"><strong>{text.equity}</strong><p>{formatMoney(context.package.totalEquityDzd, locale)}</p></div>
      </div>

      <div className="sk-table-wrap">
        <table className="sk-table">
          <thead>
            <tr>
              <th>{text.lineType}</th>
              <th>{text.evidence}</th>
              <th>{text.amount}</th>
              <th>{text.destination}</th>
            </tr>
          </thead>
          <tbody>
            {context.lines.map((line) => {
              const fixed = defaultAccount(line);
              return (
                <tr key={line.lineId}>
                  <td><strong>{line.lineType}</strong></td>
                  <td>
                    <div>{line.description}</div>
                    {line.counterpartyName ? (
                      <small>
                        {line.lineType === 'CUSTOMER_RECEIVABLE' ? text.customerEvidence : text.supplierEvidence}: {line.counterpartyName}
                      </small>
                    ) : null}
                  </td>
                  <td className="sk-num">{formatMoney(line.amountDzd, locale)}</td>
                  <td>
                    {line.lineType === 'CUSTOMER_RECEIVABLE' ? (
                      <select
                        className="sk-field__input"
                        aria-label={`${text.chooseCustomer}: ${line.description}`}
                        value={mappings[line.lineId] ?? ''}
                        onChange={(event) => setMappings((current) => ({ ...current, [line.lineId]: event.target.value }))}
                      >
                        <option value="">{text.chooseCustomer}</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>{customer.code} — {customer.name}</option>
                        ))}
                      </select>
                    ) : line.lineType === 'SUPPLIER_PAYABLE' ? (
                      <select
                        className="sk-field__input"
                        aria-label={`${text.chooseSupplier}: ${line.description}`}
                        value={mappings[line.lineId] ?? ''}
                        onChange={(event) => setMappings((current) => ({ ...current, [line.lineId]: event.target.value }))}
                      >
                        <option value="">{text.chooseSupplier}</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>
                        ))}
                      </select>
                    ) : line.lineType === 'OTHER_ASSET' || line.lineType === 'OTHER_LIABILITY' ? (
                      <select
                        className="sk-field__input"
                        aria-label={`${text.chooseAccount}: ${line.description}`}
                        value={mappings[line.lineId] ?? ''}
                        onChange={(event) => setMappings((current) => ({ ...current, [line.lineId]: event.target.value }))}
                      >
                        <option value="">{text.chooseAccount}</option>
                        {line.accountOptions.map((account) => (
                          <option key={account.accountCode} value={account.accountCode}>
                            {account.accountCode} — {account.description}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="sk-badge sk-badge--muted">{text.fixedAccount}: {fixed}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="sk-card">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />{' '}
        {text.acknowledge}
      </label>

      {!applicationMappings ? <Banner tone="warning">{text.mappingRequired}</Banner> : null}

      <Button
        type="button"
        disabled={!context.enabled || !openFiscalPeriodId || !acknowledged || !applicationMappings}
        onClick={() => setConfirming(true)}
        data-testid="apply-opening-state-button"
      >
        {text.apply}
      </Button>

      {confirming ? (
        <ConfirmDialog
          title={text.confirmTitle}
          body={text.confirmBody}
          confirmLabel={text.confirm}
          cancelLabel={text.cancel}
          confirmVariant="danger"
          busy={applying}
          onConfirm={() => void confirmApplication()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </section>
  );
}
