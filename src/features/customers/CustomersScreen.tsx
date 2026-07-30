import { useEffect, useState, type FormEvent } from 'react';

import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  createCustomer,
  getCustomerCreditSummary,
  listCustomerLedger,
  listCustomers,
  updateCustomer,
} from '../../shared/ipc/customerGateway';
import type {
  Customer,
  CustomerCreditSummary,
  CustomerLedgerEntry,
} from '../../shared/ipc/customerDto';

interface Props {
  sessionToken: string;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Customers',
    newCustomer: 'New customer',
    editCustomer: 'Edit customer',
    code: 'Code',
    name: 'Name',
    contact: 'Contact',
    phone: 'Phone',
    email: 'Email',
    taxId: 'Tax ID',
    address: 'Address',
    active: 'Active',
    inactive: 'Inactive',
    credit: 'Credit',
    cashOnly: 'Cash only',
    creditEnabled: 'Credit enabled',
    creditLimit: 'Credit limit',
    terms: 'Payment terms (days)',
    maxOverdue: 'Maximum overdue days',
    exposure: 'Exposure',
    available: 'Available credit',
    oldestDue: 'Oldest open due date',
    overdueBlocked: 'Overdue block',
    ledger: 'Customer ledger',
    entry: 'Entry',
    amount: 'Amount',
    due: 'Due date',
    document: 'Document',
    created: 'Created',
    view: 'View',
    edit: 'Edit',
    activate: 'Activate',
    deactivate: 'Deactivate',
    save: 'Save',
    cancel: 'Cancel',
    none: 'No customers yet.',
    noLedger: 'No ledger entries yet.',
    yes: 'Yes',
    no: 'No',
  },
  fr: {
    title: 'Clients',
    newCustomer: 'Nouveau client',
    editCustomer: 'Modifier le client',
    code: 'Code',
    name: 'Nom',
    contact: 'Contact',
    phone: 'Téléphone',
    email: 'E-mail',
    taxId: 'NIF / NIS',
    address: 'Adresse',
    active: 'Actif',
    inactive: 'Inactif',
    credit: 'Crédit',
    cashOnly: 'Comptant uniquement',
    creditEnabled: 'Crédit autorisé',
    creditLimit: 'Plafond de crédit',
    terms: 'Délai de paiement (jours)',
    maxOverdue: 'Retard maximum (jours)',
    exposure: 'Encours',
    available: 'Crédit disponible',
    oldestDue: 'Plus ancienne échéance ouverte',
    overdueBlocked: 'Blocage pour retard',
    ledger: 'Grand livre client',
    entry: 'Écriture',
    amount: 'Montant',
    due: 'Échéance',
    document: 'Document',
    created: 'Créé le',
    view: 'Voir',
    edit: 'Modifier',
    activate: 'Activer',
    deactivate: 'Désactiver',
    save: 'Enregistrer',
    cancel: 'Annuler',
    none: 'Aucun client.',
    noLedger: 'Aucune écriture client.',
    yes: 'Oui',
    no: 'Non',
  },
  ar: {
    title: 'العملاء',
    newCustomer: 'عميل جديد',
    editCustomer: 'تعديل العميل',
    code: 'الرمز',
    name: 'الاسم',
    contact: 'جهة الاتصال',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    taxId: 'الرقم الجبائي',
    address: 'العنوان',
    active: 'نشط',
    inactive: 'غير نشط',
    credit: 'الائتمان',
    cashOnly: 'نقداً فقط',
    creditEnabled: 'السماح بالائتمان',
    creditLimit: 'حد الائتمان',
    terms: 'أجل الدفع بالأيام',
    maxOverdue: 'أقصى تأخر بالأيام',
    exposure: 'الدين الحالي',
    available: 'الائتمان المتاح',
    oldestDue: 'أقدم استحقاق مفتوح',
    overdueBlocked: 'حظر بسبب التأخر',
    ledger: 'حساب العميل',
    entry: 'الحركة',
    amount: 'المبلغ',
    due: 'الاستحقاق',
    document: 'المستند',
    created: 'تاريخ الإنشاء',
    view: 'عرض',
    edit: 'تعديل',
    activate: 'تفعيل',
    deactivate: 'تعطيل',
    save: 'حفظ',
    cancel: 'إلغاء',
    none: 'لا يوجد عملاء.',
    noLedger: 'لا توجد حركات في حساب العميل.',
    yes: 'نعم',
    no: 'لا',
  },
};

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const DAYS_RE = /^\d+$/;

export function CustomersScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerCreditSummary | null>(null);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditLimit, setCreditLimit] = useState('0');
  const [paymentTermsDays, setPaymentTermsDays] = useState('0');
  const [maxOverdueDays, setMaxOverdueDays] = useState('');

  async function loadCustomers() {
    setLoading(true);
    setError(null);
    try {
      setCustomers(await listCustomers(sessionToken, true));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, [sessionToken]);

  function resetForm(customer?: Customer) {
    setEditing(customer ?? null);
    setCode(customer?.code ?? '');
    setName(customer?.name ?? '');
    setContactName(customer?.contact_name ?? '');
    setPhone(customer?.phone ?? '');
    setEmail(customer?.email ?? '');
    setAddress(customer?.address ?? '');
    setTaxId(customer?.tax_id ?? '');
    setCreditEnabled(customer?.credit_enabled ?? false);
    setCreditLimit(customer?.credit_limit ?? '0');
    setPaymentTermsDays(String(customer?.payment_terms_days ?? 0));
    setMaxOverdueDays(customer?.max_overdue_days == null ? '' : String(customer.max_overdue_days));
    setShowForm(true);
  }

  function toggleCredit(enabled: boolean) {
    setCreditEnabled(enabled);
    if (!enabled) {
      setCreditLimit('0');
      setPaymentTermsDays('0');
      setMaxOverdueDays('');
    }
  }

  const formValid =
    code.trim() !== '' &&
    name.trim() !== '' &&
    MONEY_RE.test(creditLimit) &&
    DAYS_RE.test(paymentTermsDays) &&
    (maxOverdueDays === '' || DAYS_RE.test(maxOverdueDays));

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    if (!formValid || busy) return;

    setBusy(true);
    setError(null);
    const basePayload = {
      code,
      name,
      contact_name: contactName || null,
      phone: phone || null,
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
        await updateCustomer(sessionToken, {
          ...basePayload,
          customer_id: editing.id,
          is_active: editing.is_active,
        });
      } else {
        await createCustomer(sessionToken, basePayload);
      }
      setShowForm(false);
      await loadCustomers();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(customer: Customer) {
    setBusy(true);
    setError(null);
    try {
      await updateCustomer(sessionToken, {
        customer_id: customer.id,
        code: customer.code,
        name: customer.name,
        contact_name: customer.contact_name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        tax_id: customer.tax_id,
        is_active: !customer.is_active,
        credit_enabled: customer.credit_enabled,
        credit_limit: customer.credit_limit,
        payment_terms_days: customer.payment_terms_days,
        max_overdue_days: customer.max_overdue_days,
      });
      await loadCustomers();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function openFinancialDetail(customer: Customer) {
    setSelected(customer);
    setSummary(null);
    setLedger([]);
    setError(null);
    try {
      const [creditSummary, entries] = await Promise.all([
        getCustomerCreditSummary(sessionToken, customer.id),
        listCustomerLedger(sessionToken, customer.id, 100),
      ]);
      setSummary(creditSummary);
      setLedger(entries);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="sk-screen" data-testid="customers-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.credit}: {text.exposure} → {text.available}</p>
        </div>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={() => resetForm()}
          data-testid="add-customer-btn"
        >
          {text.newCustomer}
        </button>
      </header>

      {error ? <div className="sk-banner sk-banner--error" role="alert">{error}</div> : null}

      {showForm ? (
        <form className="sk-card sk-form" onSubmit={saveCustomer} data-testid="customer-form">
          <h2>{editing ? text.editCustomer : text.newCustomer}</h2>
          <div className="sk-form-grid">
            <label>
              {text.code} *
              <input value={code} onChange={(event) => setCode(event.target.value)} required data-testid="customer-code-input" />
            </label>
            <label>
              {text.name} *
              <input value={name} onChange={(event) => setName(event.target.value)} required data-testid="customer-name-input" />
            </label>
            <label>{text.contact}<input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
            <label>{text.phone}<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label>{text.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>{text.taxId}<input value={taxId} onChange={(event) => setTaxId(event.target.value)} /></label>
            <label className="sk-grid-full">{text.address}<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label>
              <input
                type="checkbox"
                checked={creditEnabled}
                onChange={(event) => toggleCredit(event.target.checked)}
                data-testid="customer-credit-enabled"
              />{' '}
              {text.creditEnabled}
            </label>
            <label>
              {text.creditLimit}
              <input
                inputMode="decimal"
                value={creditLimit}
                onChange={(event) => setCreditLimit(event.target.value)}
                disabled={!creditEnabled}
                data-testid="customer-credit-limit"
              />
            </label>
            <label>
              {text.terms}
              <input
                inputMode="numeric"
                value={paymentTermsDays}
                onChange={(event) => setPaymentTermsDays(event.target.value)}
                disabled={!creditEnabled}
              />
            </label>
            <label>
              {text.maxOverdue}
              <input
                inputMode="numeric"
                value={maxOverdueDays}
                onChange={(event) => setMaxOverdueDays(event.target.value)}
                disabled={!creditEnabled}
              />
            </label>
          </div>
          <div className="sk-form-actions">
            <button type="button" className="sk-button sk-button--secondary" onClick={() => setShowForm(false)}>
              {text.cancel}
            </button>
            <button type="submit" className="sk-button sk-button--primary" disabled={!formValid || busy} data-testid="save-customer-btn">
              {text.save}
            </button>
          </div>
        </form>
      ) : null}

      <div className="sk-card">
        {loading ? (
          <div>{text.title}…</div>
        ) : (
          <table className="sk-table" data-testid="customers-table">
            <thead>
              <tr>
                <th>{text.code}</th>
                <th>{text.name}</th>
                <th>{text.credit}</th>
                <th>{text.creditLimit}</th>
                <th>{text.exposure}</th>
                <th>{text.available}</th>
                <th>{text.active}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr><td colSpan={8}>{text.none}</td></tr>
              ) : customers.map((customer) => (
                <tr key={customer.id} data-testid={`customer-row-${customer.id}`}>
                  <td><strong>{customer.code}</strong></td>
                  <td>{customer.name}</td>
                  <td>{customer.credit_enabled ? text.credit : text.cashOnly}</td>
                  <td>{customer.credit_limit}</td>
                  <td>{customer.exposure_amount}</td>
                  <td>{customer.available_credit}</td>
                  <td>{customer.is_active ? text.active : text.inactive}</td>
                  <td>
                    <button type="button" className="sk-button sk-button--small" onClick={() => void openFinancialDetail(customer)}>
                      {text.view}
                    </button>{' '}
                    <button type="button" className="sk-button sk-button--small" onClick={() => resetForm(customer)}>
                      {text.edit}
                    </button>{' '}
                    <button type="button" className="sk-button sk-button--small" disabled={busy} onClick={() => void toggleActive(customer)}>
                      {customer.is_active ? text.deactivate : text.activate}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected ? (
        <div className="sk-card" data-testid="customer-financial-detail">
          <h2>{selected.name}</h2>
          {summary ? (
            <div className="sk-form-grid">
              <p><strong>{text.creditLimit}:</strong> {summary.credit_limit}</p>
              <p><strong>{text.exposure}:</strong> {summary.exposure_amount}</p>
              <p><strong>{text.available}:</strong> {summary.available_credit}</p>
              <p><strong>{text.oldestDue}:</strong> {summary.oldest_open_due_date ?? '—'}</p>
              <p><strong>{text.overdueBlocked}:</strong> {summary.overdue_blocked ? text.yes : text.no}</p>
            </div>
          ) : null}

          <h3>{text.ledger}</h3>
          <table className="sk-table" data-testid="customer-ledger-table">
            <thead><tr><th>{text.entry}</th><th>{text.amount}</th><th>{text.due}</th><th>{text.document}</th><th>{text.created}</th></tr></thead>
            <tbody>
              {ledger.length === 0 ? <tr><td colSpan={5}>{text.noLedger}</td></tr> : ledger.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.entry_type}</td>
                  <td>{entry.amount_delta}</td>
                  <td>{entry.due_date ?? '—'}</td>
                  <td>{entry.document_id ?? '—'}</td>
                  <td>{entry.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
