// WS-I-3 §7.5 — slow movers: stock sitting unsold for 30/60/90/180 days.

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../shared/i18n';
import { useSession } from '../../../shared/session/SessionContext';
import { getSlowMovers } from '../../../shared/ipc/reportsGateway';
import type { SlowMoverRow, SlowMovers } from '../../../shared/ipc/reportsDto';
import { useOfficialDocumentContext } from '../../../shared/documents/useOfficialDocumentContext';
import { printDocumentA4, saveDocumentFileWithDialog } from '../../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, renderOfficialDocumentPdf } from '../../../shared/documents/officialDocument';
import { presetPeriod } from '../common/periods';
import { formatReportCopy, useReportCopy } from '../common/reportCopy';
import { ReportFrame } from '../common/ReportFrame';
import { ReportTable } from '../common/ReportTable';
import { csvBytes, toCsv } from '../common/csv';
import { fetchAllPages } from '../common/exportAll';
import { formatQuantityWithPack } from '../common/quantity';
import { buildSlowMoversModel } from '../common/printModels';

type Days = 30 | 60 | 90 | 180;
const LIMIT = 50;
const DEBOUNCE_MS = 400;

export function SlowMoversReport() {
  const { locale } = useI18n();
  const copy = useReportCopy();
  const { user } = useSession();
  const token = user?.token ?? '';
  const { identity } = useOfficialDocumentContext(token);
  const period = presetPeriod('TODAY');

  const [days, setDays] = useState<Days>(90);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SlowMovers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [capped, setCapped] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function load() {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    getSlowMovers(token, days, search || null, LIMIT, offset)
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
  }, [token, days, search, offset]);

  async function collectAll(): Promise<SlowMoverRow[]> {
    const { rows, capped: wasCapped } = await fetchAllPages<SlowMoverRow>((pageOffset, pageLimit) =>
      getSlowMovers(token, days, search || null, pageLimit, pageOffset),
    );
    setCapped(wasCapped);
    return rows;
  }

  async function handlePrint() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildSlowMoversModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      printDocumentA4(renderOfficialDocumentHtml(model, identity));
    } finally {
      setExportBusy(false);
    }
  }

  async function handlePdf() {
    if (!data || !identity) return;
    setExportBusy(true);
    try {
      const rows = await collectAll();
      const model = buildSlowMoversModel(
        { period, copy, locale, todayText: period.to },
        { ...data, rows, total_count: rows.length },
      );
      const bytes = await renderOfficialDocumentPdf(model, identity);
      await saveDocumentFileWithDialog({
        defaultFileName: `slow-movers-${days}d-${period.to}.pdf`,
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
      const rows = await collectAll();
      const csv = toCsv(
        [
          { key: 'product_name', label: copy.slowMovers },
          { key: 'variant_label', label: '' },
          { key: 'sku', label: 'SKU' },
          { key: 'on_hand', label: copy.onHand, numeric: true },
          { key: 'stock_value', label: copy.stockValue, numeric: true },
          { key: 'last_sale_date', label: copy.lastSale },
          { key: 'days_since_last_sale', label: copy.daysSince, numeric: true },
          { key: 'last_purchase_date', label: copy.lastPurchase },
        ],
        rows,
        locale,
      );
      await saveDocumentFileWithDialog({
        defaultFileName: `slow-movers-${days}d-${period.to}.csv`,
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
      <div className="sk-reports-filter-card sk-reports-filter-card--compact">
        <div className="sk-reports-filter-grid">
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-4">
            <span className="sk-reports-filter-label">{copy.slowMovers}</span>
            <select
              className="sk-field__input"
              data-testid="slow-days"
              value={days}
              onChange={(event) => {
                setOffset(0);
                setDays(Number(event.target.value) as Days);
              }}
            >
              <option value={30}>{copy.slowDays30}</option>
              <option value={60}>{copy.slowDays60}</option>
              <option value={90}>{copy.slowDays90}</option>
              <option value={180}>{copy.slowDays180}</option>
            </select>
          </div>
          <div className="sk-reports-filter-cell sk-reports-filter-cell--col-6">
            <span className="sk-reports-filter-label">{copy.search}</span>
            <input
              type="search"
              className="sk-field__input"
              data-testid="slow-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        </div>
      </div>
      {data ? (
        <p data-testid="slow-movers-banner">
          {formatReportCopy(copy.slowMoversBanner, {
            count: String(data.totals.variant_count),
            value: data.totals.stock_value,
          })}
        </p>
      ) : null}
      {capped ? <p>{copy.exportCapped}</p> : null}
      <ReportFrame
        title={copy.slowMovers}
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
            testId="table-slow-movers"
            columns={[
              { key: 'product_name', label: copy.slowMovers, align: 'start' },
              { key: 'variant_label', label: '', align: 'start' },
              { key: 'sku', label: 'SKU', align: 'start' },
              {
                key: 'on_hand',
                label: copy.onHand,
                align: 'end',
                render: (r) => formatQuantityWithPack(r.on_hand, r.base_unit_name, r.pack_unit_name, r.pack_factor, locale),
              },
              { key: 'stock_value', label: copy.stockValue, align: 'end' },
              { key: 'last_sale_date', label: copy.lastSale, align: 'start', render: (r) => r.last_sale_date ?? copy.neverSold },
              { key: 'days_since_last_sale', label: copy.daysSince, align: 'end', render: (r) => r.days_since_last_sale ?? '—' },
              { key: 'last_purchase_date', label: copy.lastPurchase, align: 'start', render: (r) => r.last_purchase_date ?? '—' },
            ]}
            rows={data.rows}
            totals={{ product_name: 'Total', stock_value: data.totals.stock_value }}
            page={{ offset, limit: LIMIT, total: data.total_count, onPage: setOffset }}
          />
        ) : null}
      </ReportFrame>
    </>
  );
}
