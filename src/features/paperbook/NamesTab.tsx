import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../shared/i18n';
import {
  paperbookListNames,
  paperbookNameSuggestions,
  paperbookSetNameMap,
  paperbookRemoveNameMap,
  paperbookDismissSuggestion,
  paperbookAutocomplete,
} from '../../shared/ipc/gateway';
import type {
  PaperBookNameRowDto,
  PaperBookSuggestionDto,
} from '../../shared/ipc/dto';

interface Props {
  sessionToken: string;
}

type CleanField = 'party' | 'product' | 'brand' | 'details';

export const NamesTab: React.FC<Props> = ({ sessionToken }) => {
  const { t } = useTranslation();

  const [activeField, setActiveField] = useState<CleanField>('party');
  const [search, setSearch] = useState<string>('');
  const [names, setNames] = useState<PaperBookNameRowDto[]>([]);
  const [suggestions, setSuggestions] = useState<PaperBookSuggestionDto[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Rename Modal state
  const [renameTarget, setRenameTarget] = useState<PaperBookNameRowDto | null>(null);
  const [standardLabel, setStandardLabel] = useState<string>('');
  const [savingRename, setSavingRename] = useState<boolean>(false);
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [namesRes, suggestionsRes] = await Promise.all([
        paperbookListNames(sessionToken, activeField, search.trim() || undefined, 100, 0),
        paperbookNameSuggestions(sessionToken, activeField),
      ]);

      setNames(namesRes.names);
      setSuggestions(suggestionsRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, activeField, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMerge = async (rawKey: string, targetLabel: string) => {
    try {
      await paperbookSetNameMap(sessionToken, activeField, rawKey, targetLabel);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDismiss = async (keyA: string, keyB: string) => {
    try {
      await paperbookDismissSuggestion(sessionToken, activeField, keyA, keyB);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReset = async (rawKey: string) => {
    try {
      await paperbookRemoveNameMap(sessionToken, activeField, rawKey);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenRename = (row: PaperBookNameRowDto) => {
    setRenameTarget(row);
    setStandardLabel(row.effective_label);
    setAcSuggestions([]);
  };

  const handleStandardLabelChange = async (val: string) => {
    setStandardLabel(val);
    if (val.trim().length >= 1) {
      try {
        const list = await paperbookAutocomplete(sessionToken, activeField, val.trim(), 8);
        setAcSuggestions(list);
      } catch {
        setAcSuggestions([]);
      }
    } else {
      setAcSuggestions([]);
    }
  };

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !standardLabel.trim()) return;

    setSavingRename(true);
    try {
      await paperbookSetNameMap(
        sessionToken,
        activeField,
        renameTarget.raw_key,
        standardLabel.trim()
      );
      setRenameTarget(null);
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRename(false);
    }
  };

  const fields: { id: CleanField; label: string }[] = [
    { id: 'party', label: t('paperbook.names.field_party') },
    { id: 'product', label: t('paperbook.names.field_product') },
    { id: 'brand', label: t('paperbook.names.field_brand') },
    { id: 'details', label: t('paperbook.names.field_details') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Intro & Field Selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '16px 20px',
          background: 'var(--sk-surface)',
          border: '1px solid var(--sk-border)',
          borderRadius: '10px',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>
            {t('paperbook.names.title')}
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--sk-muted)' }}>
            {t('paperbook.names.desc')}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {fields.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`sk-btn sk-btn--sm ${activeField === f.id ? 'sk-btn--primary' : 'sk-btn--secondary'}`}
              onClick={() => {
                setActiveField(f.id);
                setSearch('');
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'var(--sk-danger-soft)', color: 'var(--sk-danger)', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      {/* Section 1: Similar Name Suggestions */}
      {suggestions.length > 0 && (
        <div
          style={{
            padding: '16px 20px',
            background: 'var(--sk-surface)',
            border: '1px solid var(--sk-primary-soft, rgba(59,130,246,0.3))',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: '0.96rem', fontWeight: 800, color: 'var(--sk-primary)' }}>
              ✦ {t('paperbook.names.suggestions_title', { count: String(suggestions.length) })}
            </h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--sk-muted)' }}>
              {t('paperbook.names.suggestions_desc')}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {suggestions.map((s, idx) => (
              <div key={idx} className="sk-paperbook-suggestion-card">
                <div className="sk-paperbook-pair">
                  <div className="sk-paperbook-name-pill">
                    {s.label_a} <small>({s.usage_a}x)</small>
                  </div>
                  <span style={{ color: 'var(--sk-muted)', fontSize: '0.8rem' }}>⇄</span>
                  <div className="sk-paperbook-name-pill">
                    {s.label_b} <small>({s.usage_b}x)</small>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="sk-btn sk-btn--secondary sk-btn--sm"
                    title={`Merge both to "${s.label_a}"`}
                    onClick={() => handleMerge(s.key_b, s.label_a)}
                  >
                    {t('paperbook.names.merge_to', { label: s.label_a })}
                  </button>
                  <button
                    type="button"
                    className="sk-btn sk-btn--secondary sk-btn--sm"
                    title={`Merge both to "${s.label_b}"`}
                    onClick={() => handleMerge(s.key_a, s.label_b)}
                  >
                    {t('paperbook.names.merge_to', { label: s.label_b })}
                  </button>
                  <button
                    type="button"
                    className="sk-btn sk-btn--ghost sk-btn--sm"
                    onClick={() => handleDismiss(s.key_a, s.key_b)}
                  >
                    {t('paperbook.names.dismiss_btn')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: All Distinct Names */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>
            {t('paperbook.names.all_names_title', { count: String(names.length) })}
          </h3>

          <div className="sk-paperbook-search" style={{ minWidth: '220px' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('paperbook.names.search_placeholder')}
            />
          </div>
        </div>

        <div className="sk-paperbook-table-container">
          <table className="sk-paperbook-table">
            <thead>
              <tr>
                <th style={{ width: '35%' }}>{t('paperbook.names.col_raw')}</th>
                <th style={{ width: '35%' }}>{t('paperbook.names.col_effective')}</th>
                <th style={{ width: '15%', textAlign: 'right' }}>{t('paperbook.names.col_usage')}</th>
                <th style={{ width: '15%', textAlign: 'right' }}>{t('paperbook.names.col_action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && names.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: 'var(--sk-muted)' }}>
                    {t('common.loading')}
                  </td>
                </tr>
              ) : names.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: 'var(--sk-muted)' }}>
                    {t('paperbook.names.no_names')}
                  </td>
                </tr>
              ) : (
                names.map((n) => (
                  <tr key={n.raw_key} style={{ cursor: 'default' }}>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.84rem' }}>{n.raw_label}</span>
                    </td>
                    <td>
                      <strong>{n.effective_label}</strong>
                      {n.is_mapped && (
                        <span
                          style={{
                            marginInlineStart: '8px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: 'var(--sk-primary-soft)',
                            color: 'var(--sk-primary)',
                          }}
                        >
                          {t('paperbook.names.status_mapped')}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(n.usage_count).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="sk-btn sk-btn--secondary sk-btn--sm"
                          onClick={() => handleOpenRename(n)}
                        >
                          {t('paperbook.names.rename_btn')}
                        </button>
                        {n.is_mapped && (
                          <button
                            type="button"
                            className="sk-btn sk-btn--ghost sk-btn--sm"
                            title={t('paperbook.names.reset_tooltip')}
                            onClick={() => handleReset(n.raw_key)}
                          >
                            {t('paperbook.names.reset_btn')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rename Modal */}
      {renameTarget && (
        <div className="sk-paperbook-modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="sk-paperbook-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sk-paperbook-modal__header">
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                {t('paperbook.names.rename_modal_title')}
              </h2>
            </div>

            <form onSubmit={handleSaveRename}>
              <div className="sk-paperbook-modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--sk-muted)' }}>
                  {t('paperbook.names.rename_modal_desc', { count: String(renameTarget.usage_count) })}
                </p>

                <div>
                  <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--sk-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    {t('paperbook.names.col_raw')}
                  </span>
                  <div style={{ padding: '8px 12px', background: 'var(--sk-surface-soft)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                    {renameTarget.raw_label}
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px' }}>
                    {t('paperbook.names.target_label')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={standardLabel}
                    onChange={(e) => handleStandardLabelChange(e.target.value)}
                    onBlur={() => setTimeout(() => setAcSuggestions([]), 200)}
                    placeholder={t('paperbook.names.standardized_name_placeholder')}
                    style={{
                      width: '100%',
                      height: '40px',
                      padding: '0 12px',
                      border: '1px solid var(--sk-border)',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                    }}
                  />
                  {acSuggestions.length > 0 && (
                    <ul
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 60,
                        margin: '2px 0 0',
                        padding: '4px 0',
                        listStyle: 'none',
                        background: 'var(--sk-surface)',
                        border: '1px solid var(--sk-border)',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        maxHeight: '160px',
                        overflowY: 'auto',
                      }}
                    >
                      {acSuggestions.map((s, idx) => (
                        <li
                          key={idx}
                          onMouseDown={() => {
                            setStandardLabel(s);
                            setAcSuggestions([]);
                          }}
                          style={{
                            padding: '6px 12px',
                            cursor: 'pointer',
                            fontSize: '0.82rem',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sk-surface-hover)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="sk-paperbook-modal__footer">
                <button
                  type="button"
                  className="sk-btn sk-btn--secondary"
                  onClick={() => setRenameTarget(null)}
                  disabled={savingRename}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="sk-btn sk-btn--primary"
                  disabled={savingRename || !standardLabel.trim()}
                >
                  {savingRename ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
