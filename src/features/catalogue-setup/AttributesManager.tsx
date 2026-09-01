/**
 * WS-D-3 — Catalogue Setup's Attributes tab. Two-level lifecycle manager:
 * attributes, each expandable to its own values. Not to be confused with
 * src/features/products/AttributeManager.tsx, which belongs to the product
 * form's variant-attribute assignment flow and is unrelated, out of scope
 * for this task.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { AttributeValueLifecycleItem, ReferenceLifecycleItem } from '../../shared/ipc/dto';

export interface AttributesManagerProps {
  attributes: ReferenceLifecycleItem[];
  attributeValues: AttributeValueLifecycleItem[];
  loading: boolean;
  error: string | null;
  onCreateAttribute: (name: string) => Promise<void>;
  onRenameAttribute: (id: number, name: string) => Promise<void>;
  onToggleAttributeActive: (id: number, isActive: boolean) => Promise<void>;
  onDeleteAttribute: (id: number) => Promise<void>;
  onAddValue: (attributeId: number, value: string) => Promise<void>;
  onRenameValue: (id: number, value: string) => Promise<void>;
  onToggleValueActive: (id: number, isActive: boolean) => Promise<void>;
  onDeleteValue: (id: number) => Promise<void>;
}

export function AttributesManager({
  attributes, attributeValues, loading, error,
  onCreateAttribute, onRenameAttribute, onToggleAttributeActive, onDeleteAttribute,
  onAddValue, onRenameValue, onToggleValueActive, onDeleteValue,
}: AttributesManagerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [newAttrName, setNewAttrName] = useState('');
  const [creatingAttr, setCreatingAttr] = useState(false);
  const [createAttrError, setCreateAttrError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [editingAttrId, setEditingAttrId] = useState<number | null>(null);
  const [editingAttrName, setEditingAttrName] = useState('');

  const [busyAttrId, setBusyAttrId] = useState<number | null>(null);
  const [attrRowError, setAttrRowError] = useState<string | null>(null);
  const [confirmDeleteAttrId, setConfirmDeleteAttrId] = useState<number | null>(null);

  async function handleCreateAttribute(e: FormEvent) {
    e.preventDefault();
    const name = newAttrName.trim();
    if (!name || creatingAttr) return;
    setCreatingAttr(true);
    setCreateAttrError(null);
    try {
      await onCreateAttribute(name);
      setNewAttrName('');
    } catch (err) {
      setCreateAttrError(errorText(err));
    } finally {
      setCreatingAttr(false);
    }
  }

  function startEditAttr(item: ReferenceLifecycleItem) {
    setEditingAttrId(item.id);
    setEditingAttrName(item.name);
    setAttrRowError(null);
  }

  async function commitEditAttr(id: number) {
    const name = editingAttrName.trim();
    if (!name || busyAttrId != null) return;
    setBusyAttrId(id);
    setAttrRowError(null);
    try {
      await onRenameAttribute(id, name);
      setEditingAttrId(null);
    } catch (err) {
      setAttrRowError(errorText(err));
    } finally {
      setBusyAttrId(null);
    }
  }

  async function handleToggleAttr(item: ReferenceLifecycleItem) {
    if (busyAttrId != null) return;
    setBusyAttrId(item.id);
    setAttrRowError(null);
    try {
      await onToggleAttributeActive(item.id, !item.is_active);
    } catch (err) {
      setAttrRowError(errorText(err));
    } finally {
      setBusyAttrId(null);
    }
  }

  async function handleDeleteAttr(id: number) {
    if (busyAttrId != null) return;
    setBusyAttrId(id);
    setAttrRowError(null);
    try {
      await onDeleteAttribute(id);
      setConfirmDeleteAttrId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      setAttrRowError(errorText(err));
      setConfirmDeleteAttrId(null);
    } finally {
      setBusyAttrId(null);
    }
  }

  const confirmAttrTarget = attributes.find((a) => a.id === confirmDeleteAttrId) ?? null;

  return (
    <div className="sk-catalogue-setup__panel">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {attrRowError ? <Banner tone="error">{attrRowError}</Banner> : null}

      <form className="sk-form" onSubmit={handleCreateAttribute} aria-label={t('catalogueSetup.attributes.createAttribute')}>
        {createAttrError ? <Banner tone="error">{createAttrError}</Banner> : null}
        <div className="sk-form__grid">
          <TextField
            label={t('catalogueSetup.attributes.name')}
            value={newAttrName}
            onChange={(e) => setNewAttrName(e.target.value)}
            disabled={creatingAttr}
          />
        </div>
        <Button type="submit" loading={creatingAttr} disabled={!newAttrName.trim()}>
          {t('catalogueSetup.attributes.createAttribute')}
        </Button>
      </form>

      {loading ? null : attributes.length === 0 ? (
        <Banner tone="info">{t('catalogueSetup.attributes.empty')}</Banner>
      ) : (
        <div className="sk-catalogue-setup__attribute-list">
          {attributes.map((attribute) => {
            const isEditing = editingAttrId === attribute.id;
            const isBusy = busyAttrId === attribute.id;
            const canDelete = attribute.usage_count === 0;
            const isExpanded = expandedId === attribute.id;
            return (
              <div key={attribute.id} className="sk-card sk-catalogue-setup__attribute-card">
                <div className="sk-catalogue-setup__attribute-row">
                  <button
                    type="button"
                    className="sk-catalogue-setup__expand-toggle"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : attribute.id)}
                  >
                    <span aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                    {isEditing ? (
                      <TextField
                        label={t('catalogueSetup.attributes.name')}
                        value={editingAttrName}
                        onChange={(e) => setEditingAttrName(e.target.value)}
                        disabled={isBusy}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <strong>{attribute.name}</strong>
                    )}
                    <span>
                      {attribute.is_active
                        ? t('catalogueSetup.common.active')
                        : t('catalogueSetup.common.inactive')}
                    </span>
                  </button>
                  <div className="sk-catalogue-setup__actions">
                    {isEditing ? (
                      <>
                        <Button variant="secondary" onClick={() => setEditingAttrId(null)} disabled={isBusy}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          onClick={() => void commitEditAttr(attribute.id)}
                          loading={isBusy}
                          disabled={!editingAttrName.trim()}
                        >
                          {t('common.save')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => startEditAttr(attribute)} disabled={busyAttrId != null}>
                          {t('catalogueSetup.actions.rename')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleToggleAttr(attribute)}
                          loading={isBusy}
                          disabled={busyAttrId != null}
                        >
                          {attribute.is_active
                            ? t('catalogueSetup.actions.deactivate')
                            : t('catalogueSetup.actions.activate')}
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => setConfirmDeleteAttrId(attribute.id)}
                          disabled={busyAttrId != null || !canDelete}
                          title={canDelete ? undefined : t('catalogueSetup.common.inUse', { count: attribute.usage_count })}
                        >
                          {t('catalogueSetup.actions.delete')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded ? (
                  <AttributeValuesPanel
                    attributeId={attribute.id}
                    values={attributeValues.filter((v) => v.attribute_id === attribute.id)}
                    onAddValue={onAddValue}
                    onRenameValue={onRenameValue}
                    onToggleValueActive={onToggleValueActive}
                    onDeleteValue={onDeleteValue}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {confirmAttrTarget ? (
        <ConfirmDialog
          title={t('catalogueSetup.common.confirmDeleteTitle')}
          body={t('catalogueSetup.common.confirmDeleteBody', { name: confirmAttrTarget.name })}
          confirmLabel={t('catalogueSetup.actions.delete')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={busyAttrId === confirmAttrTarget.id}
          onConfirm={() => void handleDeleteAttr(confirmAttrTarget.id)}
          onCancel={() => setConfirmDeleteAttrId(null)}
        />
      ) : null}
    </div>
  );
}

function AttributeValuesPanel({
  attributeId, values, onAddValue, onRenameValue, onToggleValueActive, onDeleteValue,
}: {
  attributeId: number;
  values: AttributeValueLifecycleItem[];
  onAddValue: (attributeId: number, value: string) => Promise<void>;
  onRenameValue: (id: number, value: string) => Promise<void>;
  onToggleValueActive: (id: number, isActive: boolean) => Promise<void>;
  onDeleteValue: (id: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const value = newValue.trim();
    if (!value || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAddValue(attributeId, value);
      setNewValue('');
    } catch (err) {
      setAddError(errorText(err));
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: AttributeValueLifecycleItem) {
    setEditingId(item.id);
    setEditingValue(item.value);
    setRowError(null);
  }

  async function commitEdit(id: number) {
    const value = editingValue.trim();
    if (!value || busyId != null) return;
    setBusyId(id);
    setRowError(null);
    try {
      await onRenameValue(id, value);
      setEditingId(null);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(item: AttributeValueLifecycleItem) {
    if (busyId != null) return;
    setBusyId(item.id);
    setRowError(null);
    try {
      await onToggleValueActive(item.id, !item.is_active);
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
      await onDeleteValue(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setRowError(errorText(err));
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  }

  const confirmTarget = values.find((v) => v.id === confirmDeleteId) ?? null;

  return (
    <div className="sk-catalogue-setup__value-panel">
      {rowError ? <Banner tone="error">{rowError}</Banner> : null}

      {values.length === 0 ? (
        <Banner tone="info">{t('catalogueSetup.attributes.valuesEmpty')}</Banner>
      ) : (
        <table className="sk-table">
          <thead>
            <tr>
              <th>{t('catalogueSetup.attributes.value')}</th>
              <th>{t('catalogueSetup.common.status')}</th>
              <th className="sk-num">{t('catalogueSetup.common.usage')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {values.map((item) => {
              const isEditing = editingId === item.id;
              const isBusy = busyId === item.id;
              const canDelete = item.usage_count === 0;
              return (
                <tr key={item.id} className={item.is_active ? '' : 'sk-row--inactive'}>
                  <td>
                    {isEditing ? (
                      <TextField
                        label={t('catalogueSetup.attributes.value')}
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        disabled={isBusy}
                      />
                    ) : (
                      item.value
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
                        <Button variant="secondary" onClick={() => setEditingId(null)} disabled={isBusy}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          onClick={() => void commitEdit(item.id)}
                          loading={isBusy}
                          disabled={!editingValue.trim()}
                        >
                          {t('common.save')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => startEdit(item)} disabled={busyId != null}>
                          {t('catalogueSetup.actions.rename')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void handleToggle(item)}
                          loading={isBusy}
                          disabled={busyId != null}
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
      )}

      <form
        className="sk-form"
        onSubmit={handleAdd}
        aria-label={t('catalogueSetup.attributes.addValue')}
        style={{ marginBlockStart: '0.5rem' }}
      >
        {addError ? <Banner tone="error">{addError}</Banner> : null}
        <div className="sk-form__grid">
          <TextField
            label={t('catalogueSetup.attributes.value')}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            disabled={adding}
          />
        </div>
        <Button type="submit" loading={adding} disabled={!newValue.trim()}>
          {t('catalogueSetup.attributes.addValue')}
        </Button>
      </form>

      {confirmTarget ? (
        <ConfirmDialog
          title={t('catalogueSetup.common.confirmDeleteTitle')}
          body={t('catalogueSetup.common.confirmDeleteBody', { name: confirmTarget.value })}
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
