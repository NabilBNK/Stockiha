import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation, type MessageKey } from '../../shared/i18n';
import {
  paperbookPreviewImport,
  paperbookCommitImport,
} from '../../shared/ipc/gateway';
import type {
  PaperBookPreviewDto,
  PaperBookIssue,
} from '../../shared/ipc/dto';

interface Props {
  sessionToken: string;
  onImportSuccess: () => void;
}

export const ImportTab: React.FC<Props> = ({ sessionToken, onImportSuccess }) => {
  const { t } = useTranslation();

  const [filePath, setFilePath] = useState<string>('');
  const [preview, setPreview] = useState<PaperBookPreviewDto | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handlePickFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
        title: t('paperbook.import.browsing'),
      });

      if (typeof selected === 'string') {
        loadPreview(selected);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const loadPreview = async (path: string) => {
    setFilePath(path);
    setLoadingPreview(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setWarningsAcknowledged(false);

    try {
      const res = await paperbookPreviewImport(sessionToken, path);
      setPreview(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCommit = async () => {
    if (!preview || !filePath) return;
    setImporting(true);
    setErrorMsg(null);

    try {
      const res = await paperbookCommitImport(
        sessionToken,
        filePath,
        preview.file_sha256,
        warningsAcknowledged
      );

      setSuccessMsg(
        t('paperbook.import.success', {
          txns: String(res.txn_count),
          lines: String(res.line_count),
          replaced: String(res.replaced_txn_count),
        })
      );
      setPreview(null);
      setFilePath('');
      onImportSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const formatIssueMessage = (issue: PaperBookIssue): string => {
    const rawMsg = t(issue.message_key as MessageKey);
    // Replace contextual placeholders like {unitPrice}, {date}, etc.
    let text = rawMsg || issue.code;
    if (issue.context) {
      for (const [k, v] of Object.entries(issue.context)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };

  const summary = preview?.summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Notifications */}
      {errorMsg && (
        <div style={{ padding: '14px 18px', background: 'var(--sk-danger-soft)', color: 'var(--sk-danger)', borderRadius: '10px', fontWeight: 600 }}>
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div style={{ padding: '14px 18px', background: 'var(--sk-ok-soft, rgba(16,185,129,0.1))', color: 'var(--sk-ok, #059669)', borderRadius: '10px', fontWeight: 700 }}>
          ✓ {successMsg}
        </div>
      )}

      {/* File Dropzone / Picker */}
      <div
        className="sk-paperbook-dropzone"
        onClick={handlePickFile}
      >
        <div className="sk-paperbook-dropzone__icon">📄</div>
        <div>
          <strong style={{ fontSize: '1rem', color: 'var(--sk-text)' }}>
            {filePath ? filePath.split(/[/\\]/).pop() : t('paperbook.import.dropzone')}
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--sk-muted)' }}>
            {filePath || 'Click to select .xlsx file'}
          </p>
        </div>
        <button
          type="button"
          className="sk-btn sk-btn--secondary sk-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            handlePickFile();
          }}
          disabled={loadingPreview}
        >
          {loadingPreview ? t('common.loading') : t('paperbook.import.browsing')}
        </button>
      </div>

      {loadingPreview && (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--sk-muted)' }}>
          <p>{t('common.loading')} Validating Excel transactions...</p>
        </div>
      )}

      {/* Preview Section */}
      {preview && !loadingPreview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* File Meta Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '14px 18px',
              background: 'var(--sk-surface)',
              border: '1px solid var(--sk-border)',
              borderRadius: '10px',
              fontSize: '0.82rem',
            }}
          >
            <div>
              <span style={{ color: 'var(--sk-muted)' }}>{t('paperbook.import.filename')}: </span>
              <strong>{preview.file_name}</strong>
              {preview.sheet_name && (
                <span style={{ marginInlineStart: '10px', color: 'var(--sk-muted)' }}>
                  ({t('paperbook.import.sheet')}: <strong>{preview.sheet_name}</strong>)
                </span>
              )}
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--sk-muted)' }}>
              SHA256: {preview.file_sha256 ? `${preview.file_sha256.slice(0, 16)}…` : '—'}
            </div>
          </div>

          {/* Active Batch & Reassurance Banners */}
          {preview.current_import && (
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--sk-surface-soft)',
                border: '1px solid var(--sk-border)',
                borderRadius: '8px',
                fontSize: '0.82rem',
              }}
            >
              <strong>{t('paperbook.import.replace_warning', {
                count: String(preview.current_import.txn_count || 0),
                manualCount: String(preview.manual_count),
              })}</strong>
            </div>
          )}

          {preview.same_as_current && (
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--sk-warn-soft, rgba(245,158,11,0.1))',
                border: '1px solid var(--sk-warn)',
                borderRadius: '8px',
                color: 'var(--sk-warn)',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              ⚠ {t('paperbook.import.same_file_notice')}
            </div>
          )}

          {/* Validation Errors */}
          {preview.error_total > 0 && (
            <div
              style={{
                padding: '16px',
                background: 'var(--sk-surface)',
                border: '1px solid var(--sk-danger)',
                borderRadius: '10px',
              }}
            >
              <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: 'var(--sk-danger)', fontWeight: 800 }}>
                ✕ {t('paperbook.import.errors_title', { count: String(preview.error_total) })}
              </h3>

              <div className="sk-paperbook-table-container">
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th style={{ width: '8%' }}>Row</th>
                      <th style={{ width: '8%' }}>Col</th>
                      <th style={{ width: '18%' }}>Code</th>
                      <th style={{ width: '66%' }}>Message & Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((err, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700 }}>{err.row ?? '—'}</td>
                        <td style={{ fontWeight: 700 }}>{err.col ?? '—'}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: 'var(--sk-danger)' }}>
                            {err.code}
                          </span>
                        </td>
                        <td>{formatIssueMessage(err)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h3 style={{ margin: '4px 0 0', fontSize: '1rem', fontWeight: 800 }}>
                {t('paperbook.import.summary.title')}
              </h3>

              <div className="sk-paperbook-kpis">
                <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--primary">
                  <div className="sk-paperbook-kpi-label">{t('paperbook.import.summary.txns')}</div>
                  <div className="sk-paperbook-kpi-value">{summary.transactions}</div>
                  <div className="sk-paperbook-kpi-sub">
                    {summary.sell} {t('paperbook.import.summary.sells')} · {summary.buy} {t('paperbook.import.summary.buys')} · {summary.expense} {t('paperbook.import.summary.expenses')}
                  </div>
                </div>

                <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--success">
                  <div className="sk-paperbook-kpi-label">{t('paperbook.import.summary.sell_total')}</div>
                  <div className="sk-paperbook-kpi-value">{Number(summary.sell_total).toLocaleString()} DZD</div>
                  <div className="sk-paperbook-kpi-sub">
                    {summary.date_min && summary.date_max ? `${summary.date_min} to ${summary.date_max}` : '—'}
                  </div>
                </div>

                <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--info">
                  <div className="sk-paperbook-kpi-label">{t('paperbook.import.summary.buy_total')}</div>
                  <div className="sk-paperbook-kpi-value">{Number(summary.buy_total).toLocaleString()} DZD</div>
                  <div className="sk-paperbook-kpi-sub">{summary.lines} total item lines</div>
                </div>

                <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--warning">
                  <div className="sk-paperbook-kpi-label">{t('paperbook.import.summary.expense_total')}</div>
                  <div className="sk-paperbook-kpi-value">{Number(summary.expense_total).toLocaleString()} DZD</div>
                  <div className="sk-paperbook-kpi-sub">Operating expenditures</div>
                </div>

                <div className="sk-paperbook-kpi-card sk-paperbook-kpi-card--primary">
                  <div className="sk-paperbook-kpi-label">{t('paperbook.import.summary.benefit_total')}</div>
                  <div className="sk-paperbook-kpi-value">{Number(summary.sell_benefit_total).toLocaleString()} DZD</div>
                  <div className="sk-paperbook-kpi-sub">
                    {t('paperbook.import.summary.benefit_coverage', {
                      count: String(summary.sells_with_benefit),
                      amount: `${Number(summary.sell_total_with_benefit).toLocaleString()} DZD`,
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Warnings Section */}
          {preview.warning_total > 0 && (
            <div
              style={{
                padding: '16px',
                background: 'var(--sk-surface)',
                border: '1px solid var(--sk-warn, #f59e0b)',
                borderRadius: '10px',
              }}
            >
              <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#d97706', fontWeight: 800 }}>
                ⚠ {t('paperbook.import.warnings_title', { count: String(preview.warning_total) })}
              </h3>

              <div className="sk-paperbook-table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                <table className="sk-paperbook-table">
                  <thead>
                    <tr>
                      <th style={{ width: '8%' }}>Row</th>
                      <th style={{ width: '22%' }}>Code</th>
                      <th style={{ width: '70%' }}>Notice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.warnings.map((w, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700 }}>{w.row ?? '—'}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.74rem', color: '#d97706' }}>
                            {w.code}
                          </span>
                        </td>
                        <td>{formatIssueMessage(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="ack-warnings"
                  checked={warningsAcknowledged}
                  onChange={(e) => setWarningsAcknowledged(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="ack-warnings" style={{ fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer' }}>
                  {t('paperbook.import.acknowledge_warnings', { count: String(preview.warning_total) })}
                </label>
              </div>
            </div>
          )}

          {/* Commit Action */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px' }}>
            <button
              type="button"
              className="sk-btn sk-btn--primary"
              style={{ minHeight: '44px', padding: '0 24px', fontSize: '0.92rem' }}
              disabled={
                !preview.can_import ||
                preview.error_total > 0 ||
                (preview.warning_total > 0 && !warningsAcknowledged) ||
                importing
              }
              onClick={handleCommit}
            >
              {importing
                ? t('paperbook.import.importing')
                : t('paperbook.import.btn_import', { count: String(summary?.transactions || 0) })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
