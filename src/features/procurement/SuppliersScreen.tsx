import { useEffect, useState } from 'react';
import { createSupplier, listSuppliers, updateSupplier } from '../../shared/ipc/gateway';
import type { Supplier } from '../../shared/ipc/dto';
import { useI18n } from '../../shared/i18n';

interface Props {
  sessionToken: string;
}

export default function SuppliersScreen({ sessionToken }: Props) {
  const { t } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

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
      const data = await listSuppliers(sessionToken, true);
      setSuppliers(data);
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
    setCode('');
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
          code,
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
          code,
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

  return (
    <div className="sk-screen">
      <header className="sk-screen__header">
        <h1>{t('nav.suppliers')}</h1>
        <button
          type="button"
          className="sk-button sk-button--primary"
          onClick={openCreateForm}
          data-testid="add-supplier-btn"
        >
          {t('common.create')}
        </button>
      </header>

      {error && (
        <div className="sk-banner sk-banner--error" data-testid="suppliers-error">
          {error}
        </div>
      )}

      {showForm && (
        <form className="sk-card sk-form" onSubmit={handleSave} data-testid="supplier-form">
          <h2>{editingSupplier ? 'Edit Supplier' : 'New Supplier'}</h2>
          <div className="sk-form-grid">
            <label>
              Code *
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                data-testid="supplier-code-input"
              />
            </label>

            <label>
              Name *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="supplier-name-input"
              />
            </label>

            <label>
              Contact Person
              <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </label>

            <label>
              Phone
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>

            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            <label>
              Tax ID (NIF / NIS)
              <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </label>

            <label className="sk-grid-full">
              Address
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
          </div>

          <div className="sk-form-actions">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              onClick={() => setShowForm(false)}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="sk-button sk-button--primary" data-testid="save-supplier-btn">
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div>{t('common.loading')}</div>
      ) : (
        <div className="sk-card">
          <table className="sk-table" data-testid="suppliers-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Tax ID</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.length === 0 ? (
                <tr>
                  <td colSpan={7}>{t('common.none')}</td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={s.id} data-testid={`supplier-row-${s.id}`}>
                    <td>
                      <strong>{s.code}</strong>
                    </td>
                    <td>{s.name}</td>
                    <td>{s.contact_name || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.tax_id || '—'}</td>
                    <td>
                      <span className={`sk-badge ${s.is_active ? 'sk-badge--success' : 'sk-badge--secondary'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="sk-button sk-button--small"
                        onClick={() => openEditForm(s)}
                        data-testid={`edit-supplier-${s.id}`}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        className={`sk-button sk-button--small ${
                          s.is_active ? 'sk-button--warning' : 'sk-button--secondary'
                        }`}
                        onClick={() => toggleActive(s)}
                        data-testid={`toggle-supplier-${s.id}`}
                      >
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
