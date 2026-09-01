/**
 * WS-D-3 — generic list/create/rename/toggle/delete widget for a flat,
 * name-only reference table (used by the Categories tab). Deletion is
 * disabled client-side when usage_count > 0 for a clean UX, but the
 * server-side check remains the actual authority: a delete that slips
 * through (e.g. usage changed since the last fetch) still surfaces its
 * translated error instead of silently failing.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { ReferenceLifecycleItem } from '../../shared/ipc/dto';

export interface SimpleReferenceManagerProps {
  items: ReferenceLifecycleItem[];
  loading: boolean;
  error: string | null;
  nameLabel: string;
  createLabel: string;
  emptyText: string;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onToggleActive: (id: number, isActive: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function SimpleReferenceManager({
  items, loading, error, nameLabel, createLabel, emptyText,
  onCreate, onRename, onToggleActive, onDelete,
}: SimpleReferenceManagerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(name);
      setNewName('');
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: ReferenceLifecycleItem) {
    setEditingId(item.id);
    setEditingName(item.name);
    setRowError(null);
  }

  async function commitEdit(id: number) {
    const name = editingName.trim();
    if (!name || busyId != null) return;
    setBusyId(id);
    setRowError(null);
    try {
      await onRename(id, name);
      setEditingId(null);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(item: ReferenceLifecycleItem) {
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

      <form className="sk-form" onSubmit={handleCreate} aria-label={createLabel}>
        {createError ? <Banner tone="error">{createError}</Banner> : null}
        <div className="sk-form__grid">
          <TextField
            label={nameLabel}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
          />
        </div>
        <Button type="submit" loading={creating} disabled={!newName.trim()}>
          {createLabel}
        </Button>
      </form>

      {loading ? null : items.length === 0 ? (
        <Banner tone="info">{emptyText}</Banner>
      ) : (
        <div className="sk-table-wrap">
          <table className="sk-table">
            <thead>
              <tr>
                <th>{nameLabel}</th>
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
                return (
                  <tr key={item.id} className={item.is_active ? '' : 'sk-row--inactive'}>
                    <td>
                      {isEditing ? (
                        <TextField
                          label={nameLabel}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          disabled={isBusy}
                        />
                      ) : (
                        item.name
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
                            disabled={!editingName.trim()}
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
                          >
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
