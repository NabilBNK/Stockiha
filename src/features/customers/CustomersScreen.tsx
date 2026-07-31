import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAppData } from '../../app/AppDataContext';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  createCustomer,
  getCustomerCapabilities,
  getCustomerCreditSummary,
  listCustomerLedger,
  listCustomers,
  updateCustomer,
} from '../../shared/ipc/customerGateway';
import type {
  Customer,
  CustomerCapabilities,
  CustomerCreditSummary,
  CustomerLedgerEntry,
} from '../../shared/ipc/customerDto';
import { listOpenCustomerInvoices, postCustomerPayment } from '../../shared/ipc/receivablesGateway';
import type { CustomerPaymentResult, OpenCustomerInvoice } from '../../shared/ipc/receivablesDto';
import { useSession } from '../../shared/session/SessionContext';
import { currentBusinessDate } from '../../shared/utils/businessDate';

interface Props { sessionToken: string; }
type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Customers', newCustomer: 'New customer', editCustomer: 'Edit customer', code: 'Customer code', name: 'Name', contact: 'Contact',
    email: 'Email', taxId: 'Tax ID', taxIdHelp: 'Customer fiscal or tax registration number.', address: 'Address', active: 'Active', inactive: 'Inactive',
    credit: 'Credit', cashOnly: 'Cash only', creditEnabled: 'Credit enabled', creditLimit: 'Credit limit', terms: 'Payment terms (days)',
    maxOverdue: 'Maximum overdue days', exposure: 'Exposure', available: 'Available credit', oldestDue: 'Oldest open due date',
    overdueBlocked: 'Overdue block', ledger: 'Customer ledger', entry: 'Entry', amount: 'Amount', due: 'Due date', document: 'Document',
    created: 'Created', view: 'View', edit: 'Edit', activate: 'Activate', deactivate: 'Deactivate', save: 'Save', cancel: 'Cancel',
    none: 'No customers yet.', noLedger: 'No ledger entries yet.', yes: 'Yes', no: 'No', readOnly: 'Read-only customer access',
    codeAuto: 'Generated automatically when the customer is saved.', activated: 'Customer activated successfully.', deactivated: 'Customer deactivated successfully.',
    payment: 'Record payment', openInvoices: 'Open invoices', original: 'Original', remaining: 'Remaining', allocate: 'Allocate',
    paymentMethod: 'Payment method', cash: 'Cash', bank: 'Bank transfer', note: 'Note', postPayment: 'Post payment',
    paymentTotal: 'Allocated payment total', noOpenInvoices: 'No open invoices.', paymentPosted: 'Customer payment posted',
    cashSessionRequired: 'Open a cash session before recording a cash customer payment.',
  },
  fr: {
    title: 'Clients', newCustomer: 'Nouveau client', editCustomer: 'Modifier le client', code: 'Code client', name: 'Nom', contact: 'Contact',
    email: 'E-mail', taxId: 'NIF / NIS', taxIdHelp: "Identifiant fiscal ou d'immatriculation fiscale du client.", address: 'Adresse', active: 'Actif', inactive: 'Inactif',
    credit: 'Crédit', cashOnly: 'Comptant uniquement', creditEnabled: 'Crédit autorisé', creditLimit: 'Plafond de crédit', terms: 'Délai de paiement (jours)',
    maxOverdue: 'Retard maximum (jours)', exposure: 'Encours', available: 'Crédit disponible', oldestDue: 'Plus ancienne échéance ouverte',
    overdueBlocked: 'Blocage pour retard', ledger: 'Grand livre client', entry: 'Écriture', amount: 'Montant', due: 'Échéance', document: 'Document',
    created: 'Créé le', view: 'Voir', edit: 'Modifier', activate: 'Activer', deactivate: 'Désactiver', save: 'Enregistrer', cancel: 'Annuler',
    none: 'Aucun client.', noLedger: 'Aucune écriture client.', yes: 'Oui', no: 'Non', readOnly: 'Accès client en lecture seule',
    codeAuto: "Généré automatiquement lors de l'enregistrement du client.", activated: 'Client activé avec succès.', deactivated: 'Client désactivé avec succès.',
    payment: 'Enregistrer un paiement', openInvoices: 'Factures ouvertes', original: 'Original', remaining: 'Restant', allocate: 'Affecter',
    paymentMethod: 'Mode de paiement', cash: 'Espèces', bank: 'Virement bancaire', note: 'Note', postPayment: 'Valider le paiement',
    paymentTotal: 'Total affecté', noOpenInvoices: 'Aucune facture ouverte.', paymentPosted: 'Paiement client enregistré',
    cashSessionRequired: 'Ouvrez une session de caisse avant un paiement client en espèces.',
  },
  ar: {
    title: 'العملاء', newCustomer: 'عميل جديد', editCustomer: 'تعديل العميل', code: 'رمز العميل', name: 'الاسم', contact: 'الاتصال',
    email: 'البريد الإلكتروني', taxId: 'الرقم الجبائي', taxIdHelp: 'رقم التعريف أو التسجيل الجبائي للعميل.', address: 'العنوان', active: 'نشط', inactive: 'غير نشط',
    credit: 'الائتمان', cashOnly: 'نقداً فقط', creditEnabled: 'السماح بالائتمان', creditLimit: 'حد الائتمان', terms: 'أجل الدفع بالأيام',
    maxOverdue: 'أقصى تأخر بالأيام', exposure: 'الدين الحالي', available: 'الائتمان المتاح', oldestDue: 'أقدم استحقاق مفتوح',
    overdueBlocked: 'حظر بسبب التأخر', ledger: 'حساب العميل', entry: 'الحركة', amount: 'المبلغ', due: 'الاستحقاق', document: 'المستند',
    created: 'تاريخ الإنشاء', view: 'عرض', edit: 'تعديل', activate: 'تفعيل', deactivate: 'تعطيل', save: 'حفظ', cancel: 'إلغاء',
    none: 'لا يوجد عملاء.', noLedger: 'لا توجد حركات في حساب العميل.', yes: 'نعم', no: 'لا', readOnly: 'صلاحية عرض العملاء فقط',
    codeAuto: 'يتم إنشاء رمز العميل تلقائياً عند الحفظ.', activated: 'تم تفعيل العميل بنجاح.', deactivated: 'تم تعطيل العميل بنجاح.',
    payment: 'تسجيل دفعة', openInvoices: 'الفواتير المفتوحة', original: 'الأصلي', remaining: 'المتبقي', allocate: 'تخصيص',
    paymentMethod: 'طريقة الدفع', cash: 'نقداً', bank: 'تحويل بنكي', note: 'ملاحظة', postPayment: 'تسجيل الدفع',
    paymentTotal: 'إجمالي التخصيص', noOpenInvoices: 'لا توجد فواتير مفتوحة.', paymentPosted: 'تم تسجيل دفعة العميل',
    cashSessionRequired: 'افتح جلسة الصندوق قبل تسجيل دفعة نقدية من العميل.',
  },
};

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const DAYS_RE = /^\d+$/;

function contactValue(customer?: Customer | null) {
  if (!customer) return '';
  return [customer.contact_name, customer.phone]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' · ');
}

export function CustomersScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const { activeCashSession } = useSession();
  const { openFiscalPeriod } = useAppData();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [capabilities, setCapabilities] = useState<CustomerCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerCreditSummary | null>(null);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenCustomerInvoice[]>([]);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditLimit, setCreditLimit] = useState('0');
  const [paymentTermsDays, setPaymentTermsDays] = useState('0');
  const [maxOverdueDays, setMaxOverdueDays] = useState('');

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [allocationAmounts, setAllocationAmounts] = useState<Record<number, string>>({});
  const [lastPayment, setLastPayment] = useState<CustomerPaymentResult | null>(null);

  const canManage = capabilities?.can_manage_customers === true;
  const canPostPayment = capabilities?.can_post_customer_payment === true;

  const paymentTotal = useMemo(() => {
    const total = Object.values(allocationAmounts).reduce((sum, value) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? sum + parsed : sum;
    }, 0);
    return total.toFixed(2);
  }, [allocationAmounts]);

  async function loadCustomers() {
    setLoading(true); setError(null);
    try {
      const [customerRows, access] = await Promise.all([listCustomers(sessionToken, true), getCustomerCapabilities(sessionToken)]);
      setCustomers(customerRows); setCapabilities(access);
    } catch (err) { setError(errorText(err)); } finally { setLoading(false); }
  }

  useEffect(() => { void loadCustomers(); }, [sessionToken]);

  function resetForm(customer?: Customer) {
    if (!canManage) return;
    setEditing(customer ?? null);
    setName(customer?.name ?? '');
    setContact(contactValue(customer));
    setEmail(customer?.email ?? '');
    setAddress(customer?.address ?? '');
    setTaxId(customer?.tax_id ?? '');
    setCreditEnabled(customer?.credit_enabled ?? false);
    setCreditLimit(customer?.credit_limit ?? '0');
    setPaymentTermsDays(String(customer?.payment_terms_days ?? 0));
    setMaxOverdueDays(customer?.max_overdue_days == null ? '' : String(customer.max_overdue_days));
    setFeedback(null);
    setShowForm(true);
  }

  function toggleCredit(enabled: boolean) {
    setCreditEnabled(enabled);
    if (!enabled) { setCreditLimit('0'); setPaymentTermsDays('0'); setMaxOverdueDays(''); }
  }

  const formValid = name.trim() !== '' && MONEY_RE.test(creditLimit)
    && DAYS_RE.test(paymentTermsDays) && (maxOverdueDays === '' || DAYS_RE.test(maxOverdueDays));

  async function saveCustomer(event: FormEvent) {
    event.preventDefault(); if (!canManage || !formValid || busy) return;
    setBusy(true); setError(null); setFeedback(null);
    const common = {
      name,
      contact_name: contact || null,
      phone: null,
      email: email || null,
      address: address || null,
      tax_id: taxId || null,
      credit_enabled: creditEnabled,
      credit_limit: creditEnabled ? creditLimit : '0',
      payment_terms_days: creditEnabled ? Number(paymentTermsDays) : 0,
      max_overdue_days: creditEnabled && maxOverdueDays !== '' ? Number(maxOverdueDays) : null,
    };
    try {
      if (editing) {
        await updateCustomer(sessionToken, { ...common, customer_id: editing.id, code: editing.code, is_active: editing.is_active });
      } else {
        await createCustomer(sessionToken, common);
      }
      setShowForm(false); await loadCustomers();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  async function toggleActive(customer: Customer) {
    if (!canManage || busy) return;
    const nextActive = !customer.is_active;
    setBusy(true); setError(null); setFeedback(null);
    try {
      await updateCustomer(sessionToken, {
        customer_id: customer.id,
        code: customer.code,
        name: customer.name,
        contact_name: contactValue(customer) || null,
        phone: null,
        email: customer.email,
        address: customer.address,
        tax_id: customer.tax_id,
        is_active: nextActive,
        credit_enabled: customer.credit_enabled,
        credit_limit: customer.credit_limit,
        payment_terms_days: customer.payment_terms_days,
        max_overdue_days: customer.max_overdue_days,
      });
      setFeedback(nextActive ? text.activated : text.deactivated);
      if (selected?.id === customer.id) setSelected({ ...customer, is_active: nextActive });
      await loadCustomers();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  async function refreshFinancialDetail(customer: Customer) {
    const [creditSummary, entries, invoices] = await Promise.all([
      getCustomerCreditSummary(sessionToken, customer.id),
      listCustomerLedger(sessionToken, customer.id, 100),
      listOpenCustomerInvoices(sessionToken, customer.id),
    ]);
    setSummary(creditSummary); setLedger(entries); setOpenInvoices(invoices);
  }

  async function openFinancialDetail(customer: Customer) {
    setSelected(customer); setSummary(null); setLedger([]); setOpenInvoices([]); setPaymentOpen(false); setLastPayment(null); setError(null);
    try { await refreshFinancialDetail(customer); } catch (err) { setError(errorText(err)); }
  }

  function openPaymentForm() {
    if (!canPostPayment || !selected || !openFiscalPeriod) return;
    setAllocationAmounts({}); setPaymentNote(''); setPaymentMethod(activeCashSession ? 'CASH' : 'BANK_TRANSFER'); setPaymentOpen(true); setLastPayment(null);
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!selected || !openFiscalPeriod || busy || Number(paymentTotal) <= 0) return;
    if (paymentMethod === 'CASH' && !activeCashSession) { setError(text.cashSessionRequired); return; }

    const allocations = openInvoices
      .map((invoice) => ({ invoice_ledger_entry_id: invoice.invoice_ledger_entry_id, amount: allocationAmounts[invoice.invoice_ledger_entry_id] ?? '' }))
      .filter((allocation) => MONEY_RE.test(allocation.amount) && Number(allocation.amount) > 0);
    if (allocations.length === 0) return;

    setBusy(true); setError(null);
    try {
      const result = await postCustomerPayment(sessionToken, {
        request_id: crypto.randomUUID(), customer_id: selected.id, amount: paymentTotal, payment_method: paymentMethod,
        cash_session_id: paymentMethod === 'CASH' ? activeCashSession?.id ?? null : null,
        fiscal_period_id: openFiscalPeriod.id, document_date: currentBusinessDate(), allocations, note: paymentNote || null,
      });
      setLastPayment(result); setPaymentOpen(false); setAllocationAmounts({}); setPaymentNote('');
      setCustomers((rows) => rows.map((customer) => customer.id === selected.id ? {
        ...customer, exposure_amount: result.exposure_amount, available_credit: result.available_credit,
      } : customer));
      await refreshFinancialDetail(selected);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }

  return (
    <section className="sk-screen" data-testid="customers-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.credit}: {text.exposure} → {text.available}</p>
          {!loading && capabilities && !canManage ? <small data-testid="customers-read-only">{text.readOnly}</small> : null}
        </div>
        {canManage ? <button type="button" className="sk-button sk-button--primary" onClick={() => resetForm()} data-testid="add-customer-btn">{text.newCustomer}</button> : null}
      </header>

      {error ? <div className="sk-banner sk-banner--error" role="alert">{error}</div> : null}
      {feedback ? <div className="sk-banner sk-banner--success sk-feedback-pop" role="status">{feedback}</div> : null}

      {showForm && canManage ? (
        <form className="sk-card sk-form" onSubmit={saveCustomer} data-testid="customer-form">
          <h2>{editing ? text.editCustomer : text.newCustomer}</h2>
          <div className="sk-form-grid">
            {editing ? (
              <label>{text.code}<input value={editing.code} readOnly className="sk-code-readonly" data-testid="customer-code-input" /></label>
            ) : (
              <div className="sk-field sk-auto-code-note"><span className="sk-field__label">{text.code}</span><strong>Auto</strong><small className="sk-field-help">{text.codeAuto}</small></div>
            )}
            <label>{text.name} *<input value={name} onChange={(event) => setName(event.target.value)} required data-testid="customer-name-input" /></label>
            <label>{text.contact}<input value={contact} onChange={(event) => setContact(event.target.value)} data-testid="customer-contact-input" /></label>
            <label>{text.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>{text.taxId}<input value={taxId} onChange={(event) => setTaxId(event.target.value)} /><small className="sk-field-help">{text.taxIdHelp}</small></label>
            <label className="sk-grid-full">{text.address}<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label className="sk-checkbox-row"><input type="checkbox" checked={creditEnabled} onChange={(event) => toggleCredit(event.target.checked)} data-testid="customer-credit-enabled" /><span>{text.creditEnabled}</span></label>
            <label>{text.creditLimit}<input inputMode="decimal" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} disabled={!creditEnabled} data-testid="customer-credit-limit" /></label>
            <label>{text.terms}<input inputMode="numeric" value={paymentTermsDays} onChange={(event) => setPaymentTermsDays(event.target.value)} disabled={!creditEnabled} /></label>
            <label>{text.maxOverdue}<input inputMode="numeric" value={maxOverdueDays} onChange={(event) => setMaxOverdueDays(event.target.value)} disabled={!creditEnabled} /></label>
          </div>
          <div className="sk-form-actions"><button type="button" className="sk-button sk-button--secondary" onClick={() => setShowForm(false)}>{text.cancel}</button><button type="submit" className="sk-button sk-button--primary" disabled={!formValid || busy} data-testid="save-customer-btn">{text.save}</button></div>
        </form>
      ) : null}

      <div className="sk-card">
        {loading ? <div>{text.title}…</div> : (
          <div className="sk-table-wrap sk-table-wrap--flat">
            <table className="sk-table" data-testid="customers-table">
              <thead><tr><th>{text.code}</th><th>{text.name}</th><th>{text.credit}</th><th>{text.creditLimit}</th><th>{text.exposure}</th><th>{text.available}</th><th>{text.active}</th><th></th></tr></thead>
              <tbody>{customers.length === 0 ? <tr><td colSpan={8}>{text.none}</td></tr> : customers.map((customer) => (
                <tr key={customer.id} className={customer.is_active ? undefined : 'sk-row--inactive'} data-testid={`customer-row-${customer.id}`}>
                  <td><strong>{customer.code}</strong></td><td>{customer.name}</td><td>{customer.credit_enabled ? text.credit : text.cashOnly}</td><td>{customer.credit_limit}</td><td>{customer.exposure_amount}</td><td>{customer.available_credit}</td>
                  <td><span className={`sk-badge ${customer.is_active ? 'sk-badge--success' : 'sk-badge--danger'}`}>{customer.is_active ? text.active : text.inactive}</span></td>
                  <td><div className="sk-action-group"><button type="button" className="sk-button sk-button--small" onClick={() => void openFinancialDetail(customer)}>{text.view}</button>{canManage ? <><button type="button" className="sk-button sk-button--small sk-button--secondary" onClick={() => resetForm(customer)}>{text.edit}</button><button type="button" className={`sk-button sk-button--small ${customer.is_active ? 'sk-button--danger' : 'sk-button--success'}`} disabled={busy} onClick={() => void toggleActive(customer)}>{customer.is_active ? text.deactivate : text.activate}</button></> : null}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <div className="sk-card" data-testid="customer-financial-detail">
          <div className="sk-screen__header"><h2>{selected.name}</h2>{canPostPayment && openInvoices.length > 0 ? <button type="button" className="sk-button sk-button--primary" onClick={openPaymentForm} data-testid="record-customer-payment">{text.payment}</button> : null}</div>
          {summary ? <div className="sk-form-grid"><p><strong>{text.creditLimit}:</strong> {summary.credit_limit}</p><p><strong>{text.exposure}:</strong> {summary.exposure_amount}</p><p><strong>{text.available}:</strong> {summary.available_credit}</p><p><strong>{text.oldestDue}:</strong> {summary.oldest_open_due_date ?? '—'}</p><p><strong>{text.overdueBlocked}:</strong> {summary.overdue_blocked ? text.yes : text.no}</p></div> : null}

          {lastPayment ? <div className="sk-banner sk-banner--success" data-testid="customer-payment-success">{text.paymentPosted}: {lastPayment.document_number} · {lastPayment.amount}</div> : null}

          {paymentOpen ? (
            <form className="sk-form sk-card" onSubmit={submitPayment} data-testid="customer-payment-form">
              <h3>{text.payment}</h3>
              <label>{text.paymentMethod}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} data-testid="customer-payment-method"><option value="CASH" disabled={!activeCashSession}>{text.cash}</option><option value="BANK_TRANSFER">{text.bank}</option></select></label>
              {!activeCashSession && paymentMethod === 'CASH' ? <small>{text.cashSessionRequired}</small> : null}
              <h4>{text.openInvoices}</h4>
              {openInvoices.length === 0 ? <p>{text.noOpenInvoices}</p> : <table className="sk-table"><thead><tr><th>{text.document}</th><th>{text.due}</th><th>{text.original}</th><th>{text.remaining}</th><th>{text.allocate}</th></tr></thead><tbody>{openInvoices.map((invoice) => <tr key={invoice.invoice_ledger_entry_id}><td>{invoice.document_number ?? invoice.document_id ?? '—'}</td><td>{invoice.due_date ?? '—'}</td><td>{invoice.original_amount}</td><td>{invoice.remaining_amount}</td><td><input inputMode="decimal" value={allocationAmounts[invoice.invoice_ledger_entry_id] ?? ''} onChange={(event) => setAllocationAmounts((current) => ({ ...current, [invoice.invoice_ledger_entry_id]: event.target.value }))} data-testid={`payment-allocation-${invoice.invoice_ledger_entry_id}`} /></td></tr>)}</tbody></table>}
              <p><strong>{text.paymentTotal}:</strong> <span data-testid="customer-payment-total">{paymentTotal}</span></p>
              <label>{text.note}<input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label>
              <div className="sk-form-actions"><button type="button" className="sk-button sk-button--secondary" onClick={() => setPaymentOpen(false)}>{text.cancel}</button><button type="submit" className="sk-button sk-button--primary" disabled={busy || Number(paymentTotal) <= 0}>{text.postPayment}</button></div>
            </form>
          ) : null}

          <h3>{text.openInvoices}</h3>
          {openInvoices.length === 0 ? <p>{text.noOpenInvoices}</p> : <table className="sk-table" data-testid="open-customer-invoices"><thead><tr><th>{text.document}</th><th>{text.due}</th><th>{text.original}</th><th>{text.remaining}</th></tr></thead><tbody>{openInvoices.map((invoice) => <tr key={invoice.invoice_ledger_entry_id}><td>{invoice.document_number ?? invoice.document_id ?? '—'}</td><td>{invoice.due_date ?? '—'}</td><td>{invoice.original_amount}</td><td>{invoice.remaining_amount}</td></tr>)}</tbody></table>}

          <h3>{text.ledger}</h3>
          <table className="sk-table" data-testid="customer-ledger-table"><thead><tr><th>{text.entry}</th><th>{text.amount}</th><th>{text.due}</th><th>{text.document}</th><th>{text.created}</th></tr></thead><tbody>{ledger.length === 0 ? <tr><td colSpan={5}>{text.noLedger}</td></tr> : ledger.map((entry) => <tr key={entry.id}><td>{entry.entry_type}</td><td>{entry.amount_delta}</td><td>{entry.due_date ?? '—'}</td><td>{entry.document_id ?? '—'}</td><td>{entry.created_at}</td></tr>)}</tbody></table>
        </div>
      ) : null}
    </section>
  );
}
