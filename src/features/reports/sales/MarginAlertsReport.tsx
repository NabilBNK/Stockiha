import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getMarginAlerts } from '../../../shared/ipc/reportsGateway';
import type { MarginAlerts } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod, type Period } from '../common/periods';
import { PeriodPicker } from '../common/PeriodPicker';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { formatQuantityWithPack } from '../common/quantity';
import { buildMarginAlertsModel } from '../common/printModels';
import { useReportCopy } from '../common/reportCopy';

const DEBOUNCE_MS = 400;

export function MarginAlertsReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);

  const [period, setPeriod] = useState<Period>(() => presetPeriod('THIS_MONTH'));
  const [thresholdInput, setThresholdInput] = useState('5');
  const [threshold, setThreshold] = useState(5);
  const [data, setData] = useState<MarginAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = Number(thresholdInput);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 50) setThreshold(parsed);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [thresholdInput]);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getMarginAlerts(token, period.from, period.to, threshold)
      .then((result) => {
        if (reqRef.current !== reqId) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqRef.current !== reqId) return;
        setError(err);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!token) return;
    load();
  }, [token, period.from, period.to, threshold]);

  async function handlePrint() {
    if (!data || !identity) return;
    const model = buildMarginAlertsModel({ period, copy, locale, todayText: period.to }, data);
    printDocumentA4(renderOfficialDocumentHtml(model, identity));
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const model = buildMarginAlertsModel({ period, copy, locale, todayText: period.to }, data);
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `margin-alerts-${period.from}_${period.to}.pdf`,
        bytes,
        filterName: 'PDF',
        extension: 'pdf',
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCsv() {
    if (!data) return;
    setExportBusy(true);
    try {
      const csv = toCsv(
        [
          { key: 'product_name', label: copy.salesByProduct },
          { key: 'variant_label', label: '' },
          { key: 'quantity_base', label: '', numeric: true },
          { key: 'net_revenue', label: copy.netSales, numeric: true },
          { key: 'cost', label: '', numeric: true },
          { key: 'gross_profit', label: copy.grossProfit, numeric: true },
          { key: 'margin_pct', label: copy.marginPct, numeric: true },
          { key: 'current_sale_price', label: '', numeric: true },
          { key: 'current_wac', label: '', numeric: true },
          { key: 'suggested_min_price', label: copy.suggestedMinPrice, numeric: true },
        ],
        data.rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `margin-alerts-${period.from}_${period.to}.csv`,
        bytes: csvBytes(csv),
        filterName: 'CSV',
        extension: 'csv',
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <>
      <PeriodPicker value={period} onChange={setPeriod} />
      <label>
        {copy.marginPct}
        <input
          type="number"
          min={0}
          max={50}
          data-testid="margin-threshold"
          value={thresholdInput}
          onChange={(event) => setThresholdInput(event.target.value)}
        />
      </label>
      <ReportFrame
        title={copy.marginAlerts}
        period={period}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        onRetry={load}
        onPrint={handlePrint}
        onPdf={handlePdf}
        onCsv={handleCsv}
        exportBusy={exportBusy}
      >
      {data ? (
        <ReportTable
          testId="table-margin-alerts"
          columns={[
            {
              key: 'product_name',
              label: copy.salesByProduct,
              align: 'start',
              render: (r) => (
                <span style={{ fontWeight: (r.below_cost_lines as number) > 0 ? 'bold' : 'normal' }}>
                  {r.product_name as string} — {r.variant_label as string}
                </span>
              ),
            },
            {
              key: 'quantity_base',
              label: '',
              align: 'end',
              render: (r) =>
                formatQuantityWithPack(
                  r.quantity_base as string,
                  r.base_unit_name as string,
                  r.pack_unit_name as string | null,
                  r.pack_factor as string | null,
                  locale,
                ),
            },
            { key: 'net_revenue', label: copy.netSales, align: 'end' },
            { key: 'cost', label: '', align: 'end' },
            { key: 'gross_profit', label: copy.grossProfit, align: 'end' },
            { key: 'margin_pct', label: copy.marginPct, align: 'end', render: (r) => (r.margin_pct as string | null) ?? '—' },
            { key: 'current_sale_price', label: '', align: 'end', render: (r) => (r.current_sale_price as string | null) ?? '—' },
            { key: 'current_wac', label: '', align: 'end', render: (r) => (r.current_wac as string | null) ?? '—' },
            {
              key: 'suggested_min_price',
              label: copy.suggestedMinPrice,
              align: 'end',
              render: (r) => (r.suggested_min_price as string | null) ?? '—',
            },
          ]}
          rows={data.rows}
        />
      ) : null}
      </ReportFrame>
    </>
  );
}
