/**
 * WS-D-3 — generic list/create/rename/toggle/delete widget for a flat
 * reference table that carries both a code and a name (Brands, Units).
 * Same behaviour as SimpleReferenceManager; see that file for the
 * client-disable-plus-server-authority delete note.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, ConfirmDialog, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';

export interface CodedReferenceItem {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  usage_count: number;
}

export interface CodedReferenceManagerProps {
  items: CodedReferenceItem[];
  loading: boolean;
  error: string | null;
  codeLabel: string;
  nameLabel: string;
  createLabel: string;
  emptyText: string;
  onCreate: (code: string, name: string) => Promise<void>;
  onRename: (id: number, code: string, name: string) => Promise<void>;
  onToggleActive: (id: number, isActive: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function CodedReferenceManager({
  items, loading, error, codeLabel, nameLabel, createLabel, emptyText,
  onCreate, onRename, onToggleActive, onDelete,
}: CodedReferenceManagerProps) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingCode, setEditingCode] = useState('');
  const [editingName, setEditingName] = useState('');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(code, name);
      setNewCode('');
      setNewName('');
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: CodedReferenceItem) {
    setEditingId(item.id);
    setEditingCode(item.code);
    setEditingName(item.name);
    setRowError(null);
  }

  async function commitEdit(id: number) {
    const code = editingCode.trim();
    const name = editingName.trim();
    if (!code || !name || busyId != null) return;
    setBusyId(id);
    setRowError(null);
    try {
      await onRename(id, code, name);
      setEditingId(null);
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(item: CodedReferenceItem) {
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
            label={codeLabel}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            disabled={creating}
          />
          <TextField
            label={nameLabel}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
          />
        </div>
        <Button type="submit" loading={creating} disabled={!newCode.trim() || !newName.trim()}>
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
                <th>{codeLabel}</th>
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
                          label={codeLabel}
                          value={editingCode}
                          onChange={(e) => setEditingCode(e.target.value)}
                          disabled={isBusy}
                        />
                      ) : (
                        item.code
                      )}
                    </td>
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
                            disabled={!editingCode.trim() || !editingName.trim()}
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
