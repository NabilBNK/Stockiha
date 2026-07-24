/**
 * Slice 2 — base unit selection/creation + alternate unit management.
 */
import { useState, type FormEvent } from 'react';

import { Banner, Button, TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { useErrorText } from '../../shared/hooks/useErrorText';
import type { Unit, VariantAltUnit } from '../../shared/ipc/dto';

const FACTOR_RE = /^\d+(\.\d+)?$/;

interface Props {
  units: Unit[];
  baseUnitId: number | null;
  altUnits: VariantAltUnit[];
  onSetBase: (unitId: number) => Promise<void>;
  onCreateUnit: (code: string, name: string) => Promise<number>;
  onAddAlt: (unitId: number, factor: string) => Promise<void>;
  onRemoveAlt: (variantUnitId: number) => Promise<void>;
  busy?: boolean;
}

export function UnitManager({
  units, baseUnitId, altUnits,
  onSetBase, onCreateUnit, onAddAlt, onRemoveAlt, busy,
}: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();

  // Create unit state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState(false);
  const [creating, setCreating] = useState(false);

  // Separate states for base unit selector vs alt unit selector
  const [selectedBaseUnitId, setSelectedBaseUnitId] = useState<string>(baseUnitId ? String(baseUnitId) : '');
  const [altSelectedUnitId, setAltSelectedUnitId] = useState<string>('');
  const [altFactor, setAltFactor] = useState('');
  const [addAltError, setAddAltError] = useState<string | null>(null);
  const [addAltOk, setAddAltOk] = useState(false);
  const [addingAlt, setAddingAlt] = useState(false);

  const [baseError, setBaseError] = useState<string | null>(null);
  const [baseOk, setBaseOk] = useState(false);
  const [settingBase, setSettingBase] = useState(false);

  const [removingId, setRemovingId] = useState<number | null>(null);

  async function handleCreateUnit(e: FormEvent) {
    e.preventDefault();
    if (creating || !code.trim() || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    setCreateOk(false);
    try {
      await onCreateUnit(code.trim(), name.trim());
      setCode('');
      setName('');
      setCreateOk(true);
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleSetBase() {
    const id = parseInt(selectedBaseUnitId, 10) || 0;
    if (!id || settingBase) return;
    setSettingBase(true);
    setBaseError(null);
    setBaseOk(false);
    try {
      await onSetBase(id);
      setBaseOk(true);
    } catch (err) {
      setBaseError(errorText(err));
    } finally {
      setSettingBase(false);
    }
  }

  async function handleAddAlt(e: FormEvent) {
    e.preventDefault();
    const uid = parseInt(altSelectedUnitId, 10) || 0;
    if (!uid || !FACTOR_RE.test(altFactor) || addingAlt) return;
    setAddingAlt(true);
    setAddAltError(null);
    setAddAltOk(false);
    try {
      await onAddAlt(uid, altFactor);
      setAltFactor('');
      setAddAltOk(true);
    } catch (err) {
      setAddAltError(errorText(err));
    } finally {
      setAddingAlt(false);
    }
  }

  async function handleRemoveAlt(variantUnitId: number) {
    if (removingId != null) return;
    setRemovingId(variantUnitId);
    try {
      await onRemoveAlt(variantUnitId);
    } catch {
      // non-fatal
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <h3>{t('units.title')}</h3>

      {/* Create unit form */}
      <form className="sk-form" onSubmit={handleCreateUnit} aria-label={t('units.create')}>
        {createError ? <Banner tone="error">{createError}</Banner> : null}
        {createOk ? <Banner tone="success">{t('units.created')}</Banner> : null}
        <div className="sk-form__grid">
          <TextField label={t('units.code')} value={code} onChange={(e) => setCode(e.target.value)} disabled={creating || busy} />
          <TextField label={t('units.name')} value={name} onChange={(e) => setName(e.target.value)} disabled={creating || busy} />
        </div>
        <Button type="submit" loading={creating} disabled={!code.trim() || !name.trim() || busy}>
          {t('units.create')}
        </Button>
      </form>

      {/* Base unit selector */}
      <div style={{ marginBlockStart: '1rem' }}>
        <h4>{t('units.base')}</h4>
        {baseError ? <Banner tone="error">{baseError}</Banner> : null}
        {baseOk ? <Banner tone="success">{t('units.baseSet')}</Banner> : null}
        {units.length === 0 ? (
          <Banner tone="info">{t('units.empty')}</Banner>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <div className="sk-field">
              <label className="sk-field__label" htmlFor="base-unit-select">{t('units.base')}</label>
              <select
                id="base-unit-select"
                value={selectedBaseUnitId}
                onChange={(e) => setSelectedBaseUnitId(e.target.value)}
                disabled={settingBase || busy}
                className="sk-field__input"
              >
                <option value="">{t('common.none')}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                ))}
              </select>
            </div>
            <Button
              variant="secondary"
              onClick={() => void handleSetBase()}
              loading={settingBase}
              disabled={!selectedBaseUnitId || busy}
            >
              {t('units.setBase')}
            </Button>
          </div>
        )}
      </div>

      {/* Alternate units */}
      <div style={{ marginBlockStart: '1rem' }}>
        <h4>{t('units.altTitle')}</h4>

        {altUnits.length === 0 ? (
          <Banner tone="info">{t('units.empty')}</Banner>
        ) : (
          <table className="sk-table">
            <thead>
              <tr>
                <th>{t('units.code')}</th>
                <th className="sk-num">{t('units.factor')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {altUnits.map((au) => (
                <tr key={au.id}>
                  <td>{au.unit_code}</td>
                  <td className="sk-num">{au.conversion_factor}</td>
                  <td>
                    <Button
                      variant="danger"
                      onClick={() => void handleRemoveAlt(au.id)}
                      loading={removingId === au.id}
                      disabled={removingId != null || busy}
                    >
                      {t('units.removeAlt')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          onSubmit={handleAddAlt}
          style={{ marginBlockStart: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}
          aria-label={t('units.addAlt')}
        >
          {addAltError ? <Banner tone="error">{addAltError}</Banner> : null}
          {addAltOk ? <Banner tone="success">{t('units.altAdded')}</Banner> : null}
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="alt-unit-select">{t('units.title')}</label>
            <select
              id="alt-unit-select"
              value={altSelectedUnitId}
              onChange={(e) => setAltSelectedUnitId(e.target.value)}
              disabled={addingAlt || busy}
              className="sk-field__input"
            >
              <option value="">{t('common.none')}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </select>
          </div>
          <TextField
            label={t('units.factor')}
            value={altFactor}
            inputMode="decimal"
            onChange={(e) => setAltFactor(e.target.value)}
            error={altFactor !== '' && !FACTOR_RE.test(altFactor) ? t('variants.invalidFactor') : undefined}
            disabled={addingAlt || busy}
          />
          <Button
            type="submit"
            loading={addingAlt}
            disabled={!altSelectedUnitId || !FACTOR_RE.test(altFactor) || busy}
            data-testid="add-alt-unit-btn"
          >
            {t('units.addAlt')}
          </Button>
        </form>
      </div>
    </div>
  );
}
