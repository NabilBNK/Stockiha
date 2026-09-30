import { useId, useMemo, useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, TextField } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { formatExactDecimal } from '../../features/inventory/exactDecimal';
import type { UnitLifecycleItem } from '../../shared/ipc/dto';

export interface UnitManagerProps {
  items: UnitLifecycleItem[];
  loading: boolean;
  error: string | null;
  onCreate: (
    name: string,
    allowsFractions: boolean,
    code?: string | null,
    baseUnitId?: number | null,
    conversionFactor?: string | null,
  ) => Promise<void>;
  onRename?: (id: number, name: string, allowsFractions: boolean) => Promise<void>;
  onUpdate: (
    id: number,
    name: string,
    allowsFractions: boolean,
    code?: string | null,
    baseUnitId?: number | null,
    conversionFactor?: string | null,
  ) => Promise<void>;
  onToggleActive: (id: number, isActive: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function UnitManager({
  items,
  loading,
  error,
  onCreate,
  onRename,
  onUpdate,
  onToggleActive,
  onDelete,
}: UnitManagerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const formId = useId();

  // Create state
  const [newName, setNewName] = useState('');
  const [isPack, setIsPack] = useState(false);
  // Default to permissive (true), matching the column default
  const [newAllowsFractions, setNewAllowsFractions] = useState(true);
  const [newBaseUnitId, setNewBaseUnitId] = useState<number | null>(null);
  const [newFactor, setNewFactor] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editAllowsFractions, setEditAllowsFractions] = useState(false);
  const [editIsPack, setEditIsPack] = useState(false);
  const [editBaseUnitId, setEditBaseUnitId] = useState<number | null>(null);
  const [editFactor, setEditFactor] = useState('');
  const [editFactorLocked, setEditFactorLocked] = useState(false);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Base units available for selection (units without a base_unit_id)
  const availableBaseUnits = useMemo(
    () => items.filter((u) => u.base_unit_id == null && u.is_active),
    [items]
  );

  const selectedBaseUnit = useMemo(
    () => items.find((u) => u.id === (isPack ? newBaseUnitId : null)),
    [items, isPack, newBaseUnitId]
  );

  function handleNameChange(val: string) {
    setNewName(val);
  }

  function resetCreateForm() {
    setNewName('');
    setIsPack(false);
    setNewAllowsFractions(true);
    setNewBaseUnitId(null);
    setNewFactor('');
    setCreateError(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;

    if (isPack) {
      if (!newBaseUnitId) {
        setCreateError(t('catalogueSetup.units.baseUnitRequired' as MessageKey) || 'Please select a base unit.');
        return;
      }
      const factorNum = Number(newFactor);
      if (!newFactor.trim() || isNaN(factorNum) || factorNum <= 1) {
        setCreateError(t('catalogueSetup.units.factorInvalid' as MessageKey) || 'Holds quantity must be greater than 1.');
        return;
      }
    }

    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(
        name,
        isPack ? false : newAllowsFractions,
        null,
        isPack ? newBaseUnitId : null,
        isPack ? newFactor.trim() : null
      );
      resetCreateForm();
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: UnitLifecycleItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAllowsFractions(item.allows_fractions);
    const itemIsPack = item.base_unit_id != null;
    setEditIsPack(itemIsPack);
    setEditBaseUnitId(item.base_unit_id ?? null);
    setEditFactor(item.conversion_factor ? formatExactDecimal(item.conversion_factor) : '');
    setEditFactorLocked(item.usage_count > 0);
    setRowError(null);
  }

  async function commitEdit(id: number) {
    const name = editName.trim();
    if (!name || busyId != null) return;

    if (editIsPack) {
      if (!editBaseUnitId) {
        setRowError(t('catalogueSetup.units.baseUnitRequired' as MessageKey) || 'Please select a base unit.');
        return;
      }
      const factorNum = Number(editFactor);
      if (!editFactor.trim() || isNaN(factorNum) || factorNum <= 1) {
        setRowError(t('catalogueSetup.units.factorInvalid' as MessageKey) || 'Holds quantity must be greater than 1.');
        return;
      }
    }

    setBusyId(id);
    setRowError(null);
    try {
      if (onRename && !editIsPack) {
        await onRename(id, name, editAllowsFractions);
      } else if (onUpdate) {
        await onUpdate(
          id,
          name,
          editIsPack ? false : editAllowsFractions,
          null,
          editIsPack ? editBaseUnitId : null,
          editIsPack ? editFactor.trim() : null
        );
      }
      setEditingId(null);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(item: UnitLifecycleItem) {
    if (busyId != null) return;
    setBusyId(item.id);
    setRowError(null);
    try {
      await onToggleActive(item.id, !item.is_active);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    if (busyId != null) return;
    setBusyId(id);
    setRowError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setRowError(errorText(err));
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  }

  const confirmTarget = items.find((i) => i.id === confirmDeleteId) ?? null;

  return (
    <div className="sk-catalogue-setup__panel">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {rowError ? <Banner tone="error">{rowError}</Banner> : null}

      <form
        className="sk-form"
        onSubmit={handleCreate}
        aria-label={t('catalogueSetup.units.create')}
        data-testid="unit-create-form"
        style={{
          maxWidth: '860px',
          marginBottom: '1.25rem',
          gap: '10px',
        }}
      >
        {createError ? <Banner tone="error">{createError}</Banner> : null}

        {/* Unit Type Radio Selector - sleek inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2px' }}>
          <label className="sk-checkbox-row" style={{ cursor: 'pointer', margin: 0 }}>
            <input
              type="radio"
              name="unitType"
              checked={!isPack}
              onChange={() => {
                setIsPack(false);
                setNewBaseUnitId(null);
                setNewFactor('');
              }}
              disabled={creating}
              data-testid="unit-type-standard"
            />
            <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
              {t('catalogueSetup.units.typeStandard' as MessageKey) || 'Unité standard'}
            </span>
          </label>

          <label className="sk-checkbox-row" style={{ cursor: 'pointer', margin: 0 }}>
            <input
              type="radio"
              name="unitType"
              checked={isPack}
              onChange={() => {
                setIsPack(true);
                if (!newBaseUnitId && availableBaseUnits.length > 0) {
                  setNewBaseUnitId(availableBaseUnits[0].id);
                }
              }}
              disabled={creating}
              data-testid="unit-type-pack"
            />
            <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
              {t('catalogueSetup.units.typePack' as MessageKey) || "Boîte / Pack d'une autre unité"}
            </span>
          </label>
        </div>

        {/* Standard Unit Input Row */}
        {!isPack ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem 1rem' }}>
            <div style={{ flex: '1 1 260px', maxWidth: '340px' }}>
              <TextField
                id={`${formId}-name`}
                label={t('catalogueSetup.units.name')}
                value={newName}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={creating}
                placeholder="ex: Pièce, Kg, Litre..."
                required
              />
            </div>

            <div style={{ paddingBottom: '7px' }}>
              <label className="sk-checkbox-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={newAllowsFractions}
                  onChange={(e) => setNewAllowsFractions(e.target.checked)}
                  disabled={creating}
                  data-testid="coded-ref-create-flag"
                />
                <span style={{ fontSize: '0.85rem' }}>{t('catalogueSetup.units.allowsFractions')}</span>
              </label>
            </div>

            <div style={{ paddingBottom: '3px' }}>
              <Button
                type="submit"
                loading={creating}
                disabled={!newName.trim()}
                data-testid="unit-create-submit"
              >
                {t('catalogueSetup.units.create')}
              </Button>
            </div>
          </div>
        ) : (
          /* Pack Unit Input Row */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem 1rem' }}>
              <div style={{ flex: '1 1 220px', maxWidth: '300px' }}>
                <TextField
                  id={`${formId}-name`}
                  label={t('catalogueSetup.units.name')}
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={creating}
                  placeholder="ex: Boîte de 12, Carton de 24..."
                  required
                />
              </div>

              <div style={{ flex: '1 1 180px', maxWidth: '240px' }}>
                <label className="sk-field" style={{ margin: 0 }}>
                  <span>{t('catalogueSetup.units.baseUnit' as MessageKey) || 'Unité de base'}</span>
                  <select
                    className="sk-catalog2__select"
                    value={newBaseUnitId ?? ''}
                    onChange={(e) => setNewBaseUnitId(e.target.value ? Number(e.target.value) : null)}
                    disabled={creating}
                    style={{ width: '100%', height: '36px', padding: '0 0.5rem' }}
                    data-testid="unit-create-base-select"
                  >
                    <option value="">{t('catalogueSetup.units.baseUnitSelect' as MessageKey) || 'Choisir...'}</option>
                    {availableBaseUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ width: '110px' }}>
                <TextField
                  id={`${formId}-factor`}
                  label={t('catalogueSetup.units.conversionFactor' as MessageKey) || 'Quantité'}
                  value={newFactor}
                  onChange={(e) => setNewFactor(e.target.value)}
                  disabled={creating}
                  placeholder="12"
                  inputMode="decimal"
                />
              </div>

              <div style={{ paddingBottom: '3px' }}>
                <Button
                  type="submit"
                  loading={creating}
                  disabled={!newName.trim() || !newBaseUnitId || !newFactor.trim()}
                  data-testid="unit-create-submit"
                >
                  {t('catalogueSetup.units.create')}
                </Button>
              </div>
            </div>

            {/* Live sentence preview tag */}
            {selectedBaseUnit && newFactor.trim() && (
              <div
                style={{
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '4px',
                  color: '#1e40af',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                }}
                data-testid="unit-create-preview"
              >
                👉 1 {newName.trim() || 'Boîte'} = {newFactor.trim()} {selectedBaseUnit.name}
              </div>
            )}
          </div>
        )}
      </form>

      {loading ? null : items.length === 0 ? (
        <Banner tone="info">{t('catalogueSetup.units.empty')}</Banner>
      ) : (
        <div className="sk-table-wrap">
          <table className="sk-table" data-testid="units-table">
            <thead>
              <tr>
                <th>{t('catalogueSetup.units.code')}</th>
                <th>{t('catalogueSetup.units.name')}</th>
                <th>{t('catalogueSetup.units.type' as MessageKey) || 'Type / Contenu'}</th>
                <th>{t('catalogueSetup.common.status')}</th>
                <th className="sk-num">{t('catalogueSetup.common.usage')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editingId === item.id;
                const isBusy = busyId === item.id;
                const canDelete = item.usage_count === 0;
                const itemIsPack = item.base_unit_id != null;

                return (
                  <tr key={item.id} className={item.is_active ? '' : 'sk-row--inactive'}>
                    <td data-testid={`coded-ref-code-${item.id}`} style={{ fontWeight: 600 }}>
                      {item.code}
                    </td>

                    <td>
                      {isEditing ? (
                        <TextField
                          label=""
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={isBusy}
                        />
                      ) : (
                        item.name
                      )}
                    </td>

                    {/* Type and specification column */}
                    <td>
                      {isEditing ? (
                        editIsPack ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>1 =</span>
                              <input
                                type="text"
                                className="sk-catalog2__input"
                                value={editFactor}
                                onChange={(e) => setEditFactor(e.target.value)}
                                disabled={isBusy || editFactorLocked}
                                style={{ width: 60 }}
                              />
                              <span>×</span>
                              <select
                                className="sk-catalog2__select"
                                value={editBaseUnitId ?? ''}
                                onChange={(e) => setEditBaseUnitId(Number(e.target.value))}
                                disabled={isBusy || editFactorLocked}
                              >
                                {availableBaseUnits.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {editFactorLocked ? (
                              <span className="sk-muted" style={{ fontSize: '0.75rem', color: '#b45309' }}>
                                {t('catalogueSetup.units.factorLocked' as MessageKey) || 'Facteur verrouillé (utilisé dans le catalogue)'}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <label className="sk-checkbox-row">
                            <input
                              type="checkbox"
                              checked={editAllowsFractions}
                              onChange={(e) => setEditAllowsFractions(e.target.checked)}
                              disabled={isBusy}
                              data-testid={`coded-ref-edit-flag-${item.id}`}
                            />
                            <span>{t('catalogueSetup.units.allowsFractions')}</span>
                          </label>
                        )
                      ) : itemIsPack ? (
                        <span className="sk-badge sk-badge--info" data-testid={`unit-pack-badge-${item.id}`}>
                          📦 1 = {item.conversion_factor ? formatExactDecimal(item.conversion_factor) : ''} × {item.base_unit_name ?? item.base_unit_code}
                        </span>
                      ) : (
                        <span data-testid={`coded-ref-flag-${item.id}`}>
                          {item.allows_fractions
                            ? t('catalogueSetup.common.yes')
                            : t('catalogueSetup.common.no')}
                        </span>
                      )}
                    </td>

                    <td>
                      {item.is_active
                        ? t('catalogueSetup.common.active')
                        : t('catalogueSetup.common.inactive')}
                    </td>

                    <td className="sk-num">{item.usage_count}</td>

                    <td className="sk-catalogue-setup__actions">
                      {isEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => setEditingId(null)}
                            disabled={isBusy}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button
                            onClick={() => void commitEdit(item.id)}
                            loading={isBusy}
                            disabled={!editName.trim()}
                          >
                            {t('common.save')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => startEdit(item)}
                            disabled={busyId != null}
                            data-testid={`unit-edit-btn-${item.id}`}
                          >
                            {t('catalogueSetup.actions.rename')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => void handleToggle(item)}
                            loading={isBusy}
                            disabled={busyId != null}
                            data-testid={`unit-toggle-btn-${item.id}`}
                          >
                            {item.is_active
                              ? t('catalogueSetup.actions.deactivate')
                              : t('catalogueSetup.actions.activate')}
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => setConfirmDeleteId(item.id)}
                            disabled={busyId != null || !canDelete}
                            title={canDelete ? undefined : t('catalogueSetup.common.inUse', { count: item.usage_count })}
                            data-testid={`unit-delete-btn-${item.id}`}
                          >
                            {t('catalogueSetup.actions.delete')}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmTarget ? (
        <ConfirmDialog
          title={t('catalogueSetup.common.confirmDeleteTitle')}
          body={t('catalogueSetup.common.confirmDeleteBody', { name: confirmTarget.name })}
          confirmLabel={t('catalogueSetup.actions.delete')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={busyId === confirmTarget.id}
          onConfirm={() => void handleDelete(confirmTarget.id)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      ) : null}
    </div>
  );
}
