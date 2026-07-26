import React, { useEffect, useState, useCallback } from 'react';
import { listCustomers, createCustomer } from '../../shared/ipc/gateway';
import type { Customer, CreateCustomerPayload } from '../../shared/ipc/dto';

interface CustomersScreenProps {
  sessionToken: string;
}

export const CustomersScreen: React.FC<CustomersScreenProps> = ({ sessionToken }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [creditLimit, setCreditLimit] = useState('0.00');
  const [maxOverdueDays, setMaxOverdueDays] = useState(30);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listCustomers(sessionToken, false);
      setCustomers(res);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load customers.');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setCode(''); setName(''); setContactName(''); setPhone('');
    setEmail(''); setAddress(''); setTaxId('');
    setCreditLimit('0.00'); setMaxOverdueDays(30);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateCustomerPayload = {
        code: code.trim(),
        name: name.trim(),
        contact_name: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        tax_id: taxId.trim() || null,
        credit_limit_amount: creditLimit,
        max_overdue_days: maxOverdueDays,
      };
      await createCustomer(sessionToken, payload);
      setShowModal(false);
      resetForm();
      loadData();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to create customer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: '24px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Customers</h2>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '4px' }}>
            {customers.length} customer{customers.length !== 1 ? 's' : ''} registered
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={loadData}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#1e293b', color: '#fff', cursor: 'pointer' }}>
            Refresh
          </button>
          <button onClick={() => setShowModal(true)}
            style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
            + New Customer
          </button>
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading customers…</div>
      ) : customers.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#1e293b', borderRadius: '8px' }}>
          No customers found. Create one to get started.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
                <th style={{ padding: '12px' }}>Code</th>
                <th style={{ padding: '12px' }}>Name</th>
                <th style={{ padding: '12px' }}>Contact</th>
                <th style={{ padding: '12px' }}>Phone</th>
                <th style={{ padding: '12px' }}>Credit Limit (DZD)</th>
                <th style={{ padding: '12px' }}>Exposure (DZD)</th>
                <th style={{ padding: '12px' }}>Max Overdue Days</th>
                <th style={{ padding: '12px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{c.code}</td>
                  <td style={{ padding: '12px' }}>{c.name}</td>
                  <td style={{ padding: '12px', color: '#94a3b8' }}>{c.contact_name || '—'}</td>
                  <td style={{ padding: '12px', color: '#94a3b8' }}>{c.phone || '—'}</td>
                  <td style={{ padding: '12px' }}>{c.credit_limit_amount}</td>
                  <td style={{ padding: '12px', fontWeight: 600, color: parseFloat(c.exposure_amount) > 0 ? '#f87171' : '#34d399' }}>
                    {c.exposure_amount}
                  </td>
                  <td style={{ padding: '12px' }}>{c.max_overdue_days}d</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '3px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600,
                      backgroundColor: c.is_active ? '#065f46' : '#1e293b',
                      color: c.is_active ? '#34d399' : '#94a3b8',
                      border: c.is_active ? 'none' : '1px solid #475569'
                    }}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '8px', padding: '24px', maxWidth: '560px', width: '100%', border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>New Customer</h3>
            {error && (
              <div style={{ backgroundColor: '#7f1d1d', color: '#fecaca', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9rem' }}>
                {error}
              </div>
            )}
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Customer Code *</label>
                  <input required value={code} onChange={(e) => setCode(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Full Name *</label>
                  <input required value={name} onChange={(e) => setName(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Contact Person</label>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Phone</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Address</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Tax ID (NIF/NIS)</label>
                <input value={taxId} onChange={(e) => setTaxId(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Credit Limit (DZD)</label>
                  <input type="number" step="0.01" min="0" value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Max Overdue Days</label>
                  <input type="number" min="0" value={maxOverdueDays}
                    onChange={(e) => setMaxOverdueDays(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button type="button" onClick={() => { setShowModal(false); resetForm(); setError(null); }}
                  disabled={submitting}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#fff', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 500, cursor: 'pointer' }}>
                  {submitting ? 'Creating…' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
