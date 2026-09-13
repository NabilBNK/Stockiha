import { useEffect, useMemo, useState } from 'react';
import {
  createSupplier,
  listSupplierBalances,
  listSuppliers,
  updateSupplier,
} from '../../shared/ipc/gateway';
import type { Supplier, SupplierBalanceDto } from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';
import { PROCUREMENT_COPY } from './procurementCopy';
import { addExactDecimals } from './procurementDecimal';
import './procurement.css';

interface Props {
  sessionToken: string;
}

function getNextSupplierCode(existingList: Supplier[]): string {
  let maxNum = 0;
  for (const s of existingList) {
    const match = /SUP-(\d+)/i.exec(s.code);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `SUP-${String(maxNum + 1).padStart(3, '0')}`;
}

export default function SuppliersScreen({ sessionToken }: Props) {
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<SupplierBalanceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'DUE'>('ALL');

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, balanceData] = await Promise.all([
        listSuppliers(sessionToken, true),
        listSupplierBalances(sessionToken).catch(() => []),
      ]);
      setSuppliers(data);
      setBalances(balanceData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
  }, [sessionToken]);

  const openCreateForm = () => {
    setEditingSupplier(null);
    setCode(getNextSupplierCode(suppliers));
    setName('');
    setContactName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setTaxId('');
    setShowForm(true);
  };

  const openEditForm = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setCode(supplier.code);
    setName(supplier.name);
    setContactName(supplier.contact_name ?? '');
    setPhone(supplier.phone ?? '');
    setEmail(supplier.email ?? '');
    setAddress(supplier.address ?? '');
    setTaxId(supplier.tax_id ?? '');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      if (editingSupplier) {
        await updateSupplier(sessionToken, {
          supplier_id: editingSupplier.id,
          code: editingSupplier.code, // Enforce locked code from existing record
          name,
          contact_name: contactName || null,
          phone: phone || null,
          email: email || null,
          address: address || null,
          tax_id: taxId || null,
          is_active: editingSupplier.is_active,
        });
      } else {
        await createSupplier(sessionToken, {
          code: code.trim() || getNextSupplierCode(suppliers),
          name,
          contact_name: contactName || null,
          phone: phone || null,
          email: email || null,
          address: address || null,
          tax_id: taxId || null,
        });
      }
      setShowForm(false);
      await loadSuppliers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save supplier');
    }
  };

  const toggleActive = async (supplier: Supplier) => {
    try {
      setError(null);
      await updateSupplier(sessionToken, {
        supplier_id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        contact_name: supplier.contact_name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        tax_id: supplier.tax_id,
        is_active: !supplier.is_active,
      });
      await loadSuppliers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update supplier status');
    }
  };

  // Metrics
  const totalSuppliersCount = suppliers.length;
  const activeSuppliersCount = suppliers.filter((s) => s.is_active).length;
  const totalBalanceDue = useMemo(() => {
    return addExactDecimals(balances.map((b) => b.balance_due));
  }, [balances]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (statusFilter === 'ACTIVE' && !s.is_active) return false;
      if (statusFilter === 'INACTIVE' && s.is_active) return false;
      if (statusFilter === 'DUE') {
        const bal = balances.find((b) => b.supplier_id === s.id)?.balance_due ?? '0.00';
        if (bal === '0.00' || bal === '0') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCode = s.code.toLowerCase().includes(q);
        const matchName = s.name.toLowerCase().includes(q);
        const matchContact = s.contact_name?.toLowerCase().includes(q) ?? false;
        const matchPhone = s.phone?.toLowerCase().includes(q) ?? false;
        const matchTax = s.tax_id?.toLowerCase().includes(q) ?? false;
        if (!matchCode && !matchName && !matchContact && !matchPhone && !matchTax) {
          return false;
        }
      }
      return true;
    });
  }, [suppliers, balances, searchQuery, statusFilter]);

  const hasActiveFilters = Boolean(searchQuery.trim() || statusFilter !== 'ALL');
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
  };

  return (
    <div className="sk-screen">
      <header className="sk-screen__header">
        <div>
          <h1>{t('nav.suppliers')}</h1>
          <p className="sk-muted" style={{ margin: '4px 0 0 0', fontSize: '0.88rem' }}>
            {text.suppliersTitle}
          </p>
        </div>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={openCreateForm}
          data-testid="add-supplier-btn"
        >
          + {text.newSupplier}
        </button>
      </header>

      {error && (
        <div className="sk-banner sk-banner--error" data-testid="suppliers-error">
          {error}
        </div>
      )}

      {/* Top Metric Summary Cards */}
      <div className="sk-cards" style={{ marginBottom: '22px' }}>
        <div className="sk-metric pr-metric-card" data-testid="metric-total-suppliers">
          <span className="sk-metric__label">{text.totalSuppliers}</span>
          <strong className="sk-metric__value">{totalSuppliersCount}</strong>
        </div>
        <div className="sk-metric pr-metric-card" data-testid="metric-active-suppliers">
          <span className="sk-metric__label">{text.activeSuppliers}</span>
          <strong className="sk-metric__value" style={{ color: 'var(--sk-ok)' }}>
            {activeSuppliersCount}
          </strong>
        </div>
        <div className="sk-metric pr-metric-card" data-testid="metric-total-balance-due">
          <span className="sk-metric__label">{text.balanceDue}</span>
          <strong
            className="sk-metric__value"
            style={{
              color: totalBalanceDue !== '0' && totalBalanceDue !== '0.00' ? '#b45309' : 'var(--sk-text)',
            }}
          >
            {totalBalanceDue} DZD
          </strong>
        </div>
      </div>

      {/* Redesigned Form Card */}
      {showForm && (
        <form className="pr-supplier-form-card" onSubmit={handleSave} data-testid="supplier-form">
          <div className="pr-supplier-form-header">
            <h2>
              <span>{editingSupplier ? '✎' : '+'}</span>
              <span>{editingSupplier ? `${text.editSupplier}: ${editingSupplier.name}` : text.newSupplier}</span>
            </h2>
            <button
              type="button"
              className="sk-modal-close"
              onClick={() => setShowForm(false)}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              style={{ width: 30, height: 30 }}
            >
              ✕
            </button>
          </div>

          <div className="pr-supplier-sections">
            {/* General Info Section */}
            <div>
              <div className="pr-supplier-section-title">1. General Information</div>
              <div className="pr-supplier-grid">
                <div className="pr-supplier-field">
                  <label htmlFor="supplier-code-field">
                    <span>{text.code} *</span>
                    {!editingSupplier && (
                      <span className="pr-supplier-badge-auto">✨ {text.autoGenerated}</span>
                    )}
                  </label>
                  <input
                    id="supplier-code-field"
                    type="text"
                    value={code}
                    readOnly={!!editingSupplier}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    data-testid="supplier-code-input"
                  />
                </div>

                <div className="pr-supplier-field">
                  <label htmlFor="supplier-name-field">
                    <span>{text.name} *</span>
                  </label>
                  <input
                    id="supplier-name-field"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. SARL Distribution Express"
                    required
                    data-testid="supplier-name-input"
                  />
                </div>

                <div className="pr-supplier-field">
                  <label htmlFor="supplier-taxid-field">
                    <span>{text.taxId}</span>
                  </label>
                  <input
                    id="supplier-taxid-field"
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder="e.g. 000116000000000"
                  />
                </div>
              </div>
            </div>

            {/* Contact Info Section */}
            <div>
              <div className="pr-supplier-section-title">2. Contact Information</div>
              <div className="pr-supplier-grid">
                <div className="pr-supplier-field">
                  <label htmlFor="supplier-contact-field">{text.contact}</label>
                  <input
                    id="supplier-contact-field"
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Ahmed Benali"
                  />
                </div>

                <div className="pr-supplier-field">
                  <label htmlFor="supplier-phone-field">{text.phone}</label>
                  <input
                    id="supplier-phone-field"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 0550 12 34 56"
                  />
                </div>

                <div className="pr-supplier-field">
                  <label htmlFor="supplier-email-field">{text.email}</label>
                  <input
                    id="supplier-email-field"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@supplier.dz"
                  />
                </div>
              </div>
            </div>

            {/* Location Section */}
            <div>
              <div className="pr-supplier-section-title">3. Location</div>
              <div className="pr-supplier-field">
                <label htmlFor="supplier-address-field">{text.address}</label>
                <input
                  id="supplier-address-field"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Zone Industrielle Oued Smar, Alger"
                />
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid var(--sk-border)',
            }}
          >
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={() => setShowForm(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="sk-button sk-button--primary"
              data-testid="save-supplier-btn"
              style={{ minWidth: 140 }}
            >
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      {/* Suppliers Table & Filter Card */}
      <div className="sk-card" style={{ padding: 22 }}>
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}>{text.suppliersTitle}</h2>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="pr-history-toolbar">
            <input
              type="search"
              placeholder={text.searchSuppliersPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-filter-input"
              style={{ flex: '1 1 240px', minWidth: '220px' }}
              data-testid="search-suppliers-input"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE' | 'DUE')}
              className="pr-filter-input"
              data-testid="filter-supplier-status-select"
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
              <option value="DUE">With Balance Due</option>
            </select>
            <button
              type="button"
              className="pr-clear-filter-btn"
              onClick={clearFilters}
              title={text.clearFilters}
              data-testid="clear-supplier-filters-btn"
              style={{
                visibility: hasActiveFilters ? 'visible' : 'hidden',
                pointerEvents: hasActiveFilters ? 'auto' : 'none',
              }}
            >
              ✕ {text.clearFilters}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="sk-spinner">{t('common.loading')}</div>
        ) : filteredSuppliers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <h3 style={{ marginBottom: '8px' }}>{t('common.none')}</h3>
            <p className="sk-muted" style={{ margin: 0 }}>
              {hasActiveFilters ? 'No suppliers match the active search or filters.' : 'No suppliers added yet.'}
            </p>
          </div>
        ) : (
          <div className="sk-table-wrap">
            <table className="sk-table" data-testid="suppliers-table">
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>{text.code}</th>
                  <th>{text.name}</th>
                  <th>{text.contact}</th>
                  <th>{text.phone}</th>
                  <th>{text.taxId}</th>
                  <th style={{ width: '110px' }}>{text.status}</th>
                  <th className="sk-num">{text.returned}</th>
                  <th className="sk-num" style={{ width: '150px' }}>{text.balanceDue}</th>
                  <th style={{ width: '190px', whiteSpace: 'nowrap' }}>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => (
                  <tr key={s.id} data-testid={`supplier-row-${s.id}`}>
                    <td>
                      <strong style={{ fontFamily: 'monospace', fontSize: '0.92rem' }}>{s.code}</strong>
                    </td>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>{s.contact_name || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>
                      {s.tax_id ? <code style={{ fontSize: '0.82rem' }}>{s.tax_id}</code> : '—'}
                    </td>
                    <td>
                      <span className={`sk-badge ${s.is_active ? 'sk-badge--success' : 'sk-badge--secondary'}`}>
                        {s.is_active ? text.active : text.inactive}
                      </span>
                    </td>
                    <td className="sk-num" data-testid={`supplier-returned-${s.id}`}>
                      {balances.find((item) => item.supplier_id === s.id)?.total_returned ?? '0.00'} DZD
                    </td>
                    <td className="sk-num" data-testid={`supplier-balance-${s.id}`}>
                      {(() => {
                        const bal = balances.find((item) => item.supplier_id === s.id)?.balance_due ?? '0.00';
                        const isDue = bal !== '0.00' && bal !== '0';
                        return isDue ? (
                          <span
                            className="sk-badge sk-badge--warning"
                            style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {bal} DZD
                          </span>
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--sk-muted)' }}>
                            {bal} DZD
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      <div className="pr-row-actions">
                        <button
                          type="button"
                          className="sk-button sk-button--small sk-button--secondary"
                          onClick={() => openEditForm(s)}
                          data-testid={`edit-supplier-${s.id}`}
                        >
                          {text.edit}
                        </button>
                        <button
                          type="button"
                          className={`sk-button sk-button--small ${
                            s.is_active ? 'sk-button--warning' : 'sk-button--secondary'
                          }`}
                          onClick={() => toggleActive(s)}
                          data-testid={`toggle-supplier-${s.id}`}
                        >
                          {s.is_active ? text.deactivate : text.activate}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
