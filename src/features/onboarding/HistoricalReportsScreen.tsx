import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HistoricalCustomerDebtReport,
  HistoricalMonthlyTrendRow,
  HistoricalProfitAndLossReport,
  HistoricalPurchasesReport,
  HistoricalReportCode,
  HistoricalReportEnvelope,
  HistoricalSalesReport,
  HistoricalSellerRow,
  HistoricalSellersReport,
  HistoricalStockValuationReport,
  HistoricalSupplierDebtAndExpensesReport,
} from '../../shared/ipc/onboardingDto';
import { getHistoricalReport } from '../../shared/ipc/onboardingGateway';
import { FR, money, qty, REPORT_EXPORT_COPY as EX } from './historicalReportCopy';
import {
  exportHistoricalReportPdf,
  exportHistoricalReportXlsx,
  historicalReportExportRefusal,
} from './historicalReportExports';

interface Props {
  sessionToken: string;
  batchId: number;
}

/* -------------------------------------------------------------------------- */

const REPORT_CODES: HistoricalReportCode[] = [
  'PROFIT_AND_LOSS',
  'MONTHLY_TREND',
  'PURCHASES',
  'SALES',
  'SELLERS',
  'CUSTOMER_DEBT',
  'SUPPLIER_DEBT_AND_EXPENSES',
  'STOCK_VALUATION',
];

function MoneyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <th scope="row">{strong ? <strong>{label}</strong> : label}</th>
      <td className="sk-num">{strong ? <strong>{money(value)}</strong> : money(value)}</td>
    </tr>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="sk-num">{value}</td>
    </tr>
  );
}

/**
 * The two-tier honesty block. It takes all three figures at once and renders
 * all three: there is deliberately no way to call it with only one, because
 * showing the paper figure alone, or the computed figure alone, would let the
 * operator believe a number that the other one contradicts.
 */
function TwoTierBlock({
  recorded,
  gross,
  net,
  gapVsGross,
  gapVsNet,
}: {
  recorded: string;
  gross: string;
  net: string;
  gapVsGross: string;
  gapVsNet: string;
}) {
  return (
    <div className="sk-callout sk-callout--info" data-testid="historical-report-two-tier">
      <h4 className="sk-subsection-title">{FR.twoTierTitle}</h4>
      <div className="sk-table-wrapper">
        <table className="sk-table">
          <tbody>
            <MoneyRow label={FR.recordedBenefit} value={recorded} />
            <MoneyRow label={FR.computedGross} value={gross} />
            <MoneyRow label={FR.computedNet} value={net} />
            <MoneyRow label={FR.gapVsGross} value={gapVsGross} strong />
            <MoneyRow label={FR.gapVsNet} value={gapVsNet} strong />
          </tbody>
        </table>
      </div>
      <p className="sk-muted">{FR.twoTierExplain}</p>
    </div>
  );
}

function ProfitAndLossTable({ report }: { report: HistoricalProfitAndLossReport }) {
  return (
    <div data-testid="historical-report-profit-and-loss">
      <div className="sk-table-wrapper">
        <table className="sk-table">
          <thead>
            <tr>
              <th scope="col">{FR.figure}</th>
              <th scope="col">{FR.amount}</th>
            </tr>
          </thead>
          <tbody>
            <MoneyRow label={FR.revenue} value={report.revenueDzd} />
            <MoneyRow label={FR.cogs} value={report.cogsDzd} />
            <MoneyRow label={FR.grossProfit} value={report.grossProfitDzd} strong />
            <MoneyRow label={FR.expenses} value={report.expensesDzd} />
            <MoneyRow label={FR.netProfit} value={report.netProfitDzd} strong />
            <MoneyRow label={FR.purchases} value={report.purchasesDzd} />
            <MoneyRow label={FR.customerDebt} value={report.customerDebtDzd} />
            <MoneyRow label={FR.supplierDebt} value={report.supplierDebtDzd} />
            <MoneyRow label={FR.unpaidExpenses} value={report.unpaidExpensesDzd} />
          </tbody>
        </table>
      </div>
      <p className="sk-muted">{FR.headlineNote}</p>

      {/* The cost-free split is a first-class section, not a warning banner:
          these sales are a permanent feature of a shop that held stock before
          its paper records began. */}
      <div className="sk-section-block" data-testid="historical-report-cost-free-split">
        <h4 className="sk-subsection-title">{FR.splitTitle}</h4>

        <h5>{FR.withCostTitle}</h5>
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <tbody>
              <MoneyRow label={FR.revenueWithCost} value={report.revenueWithCostDzd} />
              <MoneyRow label={FR.cogs} value={report.cogsDzd} />
              <MoneyRow
                label={FR.grossOnCosted}
                value={report.grossProfitOnCostedSalesDzd}
                strong
              />
              <CountRow label={FR.linesWithCost} value={report.saleLinesWithCostCount} />
            </tbody>
          </table>
        </div>

        <h5>{FR.withoutCostTitle}</h5>
        <p className="sk-callout sk-callout--warning">{FR.withoutCostExplain}</p>
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <tbody>
              <MoneyRow
                label={FR.revenueWithoutCost}
                value={report.revenueWithoutCostDzd}
                strong
              />
              <CountRow label={FR.linesWithoutCost} value={report.saleLinesWithoutCostCount} />
              <CountRow label={FR.reasonNoPurchase} value={report.costFreeNoPurchaseCount} />
              <CountRow label={FR.reasonNoQuantity} value={report.costFreeNoQuantityCount} />
            </tbody>
          </table>
        </div>

        <h5>{FR.totalRevenueTitle}</h5>
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <tbody>
              <MoneyRow label={FR.revenueWithCost} value={report.revenueWithCostDzd} />
              <MoneyRow label={FR.revenueWithoutCost} value={report.revenueWithoutCostDzd} />
              <MoneyRow label={FR.totalRevenueTitle} value={report.revenueDzd} strong />
            </tbody>
          </table>
        </div>
        <p className="sk-muted">{FR.totalRevenueExplain}</p>
      </div>

      {/* Always all three figures together, never one alone. */}
      <TwoTierBlock
        recorded={report.recordedBenefitDzd}
        gross={report.grossProfitDzd}
        net={report.netProfitDzd}
        gapVsGross={report.gapVsGrossDzd}
        gapVsNet={report.gapVsNetDzd}
      />

      <div className="sk-section-block">
        <h4 className="sk-subsection-title">{FR.countsTitle}</h4>
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <tbody>
              <CountRow label={FR.saleLineCount} value={report.saleLineCount} />
              <CountRow label={FR.monthCount} value={report.monthCount} />
              <CountRow label={FR.withBenefit} value={report.salesWithRecordedBenefitCount} />
              <CountRow label={FR.withoutBenefit} value={report.salesWithoutRecordedBenefitCount} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MonthlyTrendTable({ rows }: { rows: HistoricalMonthlyTrendRow[] }) {
  if (rows.length === 0) return <p className="sk-muted">{FR.trendEmpty}</p>;
  return (
    <div className="sk-table-wrapper" data-testid="historical-report-monthly-trend">
      <table className="sk-table">
        <thead>
          <tr>
            <th scope="col">{FR.month}</th>
            <th scope="col">{FR.purchases}</th>
            <th scope="col">{FR.revenue}</th>
            <th scope="col">{FR.cogs}</th>
            <th scope="col">{FR.grossProfit}</th>
            <th scope="col">{FR.expenses}</th>
            <th scope="col">{FR.netProfit}</th>
            {/* The two-tier pair, per month. */}
            <th scope="col">{FR.recordedBenefit}</th>
            <th scope="col">{FR.gapVsGross}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month}>
              <th scope="row">{row.month}</th>
              <td className="sk-num">{money(row.purchasesDzd)}</td>
              <td className="sk-num">{money(row.salesDzd)}</td>
              <td className="sk-num">{money(row.cogsDzd)}</td>
              <td className="sk-num">{money(row.grossProfitDzd)}</td>
              <td className="sk-num">{money(row.expensesDzd)}</td>
              <td className="sk-num">{money(row.netProfitDzd)}</td>
              <td className="sk-num">{money(row.recordedBenefitDzd)}</td>
              <td className="sk-num">{money(row.gapVsGrossDzd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sk-muted">{FR.twoTierExplain}</p>
      <p className="sk-muted">{FR.headlineNote}</p>
    </div>
  );
}

/** Shared shape for reports 3 and 4: a party grouping and a product grouping. */
function GroupedTables({
  partyHeading,
  partyLabel,
  unspecifiedPartyLabel,
  partyRows,
  productHeading,
  productRows,
  showUnpaid,
  testId,
}: {
  partyHeading: string;
  partyLabel: string;
  unspecifiedPartyLabel: string;
  partyRows: {
    party: string | null;
    totalDzd: string;
    quantity: string;
    lineCount: number;
    transactionCount: number;
    unpaidDzd?: string;
  }[];
  productHeading: string;
  productRows: {
    canonicalKey: string;
    label: string;
    totalDzd: string;
    quantity: string;
    lineCount: number;
    transactionCount: number;
  }[];
  showUnpaid?: boolean;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <h4 className="sk-subsection-title">{partyHeading}</h4>
      {partyRows.length === 0 ? (
        <p className="sk-muted">{FR.emptyRows}</p>
      ) : (
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <thead>
              <tr>
                <th scope="col">{partyLabel}</th>
                <th scope="col">{FR.amount}</th>
                {showUnpaid === true && <th scope="col">{FR.unpaidColumn}</th>}
                <th scope="col">{FR.quantity}</th>
                <th scope="col">{FR.lines}</th>
                <th scope="col">{FR.operations}</th>
              </tr>
            </thead>
            <tbody>
              {partyRows.map((row) => (
                <tr key={row.party ?? '__unspecified__'}>
                  <th scope="row">{row.party ?? <em>{unspecifiedPartyLabel}</em>}</th>
                  <td className="sk-num">{money(row.totalDzd)}</td>
                  {showUnpaid === true && <td className="sk-num">{money(row.unpaidDzd)}</td>}
                  <td className="sk-num">{qty(row.quantity)}</td>
                  <td className="sk-num">{row.lineCount}</td>
                  <td className="sk-num">{row.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="sk-subsection-title">{productHeading}</h4>
      <p className="sk-muted">{FR.canonicalNote}</p>
      {productRows.length === 0 ? (
        <p className="sk-muted">{FR.emptyRows}</p>
      ) : (
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <thead>
              <tr>
                <th scope="col">{FR.product}</th>
                <th scope="col">{FR.amount}</th>
                <th scope="col">{FR.quantity}</th>
                <th scope="col">{FR.lines}</th>
                <th scope="col">{FR.operations}</th>
              </tr>
            </thead>
            <tbody>
              {productRows.map((row) => (
                <tr key={row.canonicalKey}>
                  <th scope="row">{row.label}</th>
                  <td className="sk-num">{money(row.totalDzd)}</td>
                  <td className="sk-num">{qty(row.quantity)}</td>
                  <td className="sk-num">{row.lineCount}</td>
                  <td className="sk-num">{row.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PurchasesTable({ report }: { report: HistoricalPurchasesReport }) {
  return (
    <>
      <div className="sk-table-wrapper">
        <table className="sk-table">
          <tbody>
            <MoneyRow label={FR.total} value={report.totalDzd} strong />
            <tr>
              <th scope="row">{FR.quantity}</th>
              <td className="sk-num">{qty(report.totalQuantity)}</td>
            </tr>
            <CountRow label={FR.operations} value={report.transactionCount} />
            <CountRow label={FR.supplier} value={report.supplierCount} />
            <CountRow label={FR.product} value={report.productCount} />
            <MoneyRow
              label={FR.unspecifiedSupplier}
              value={report.unspecifiedSupplierTotalDzd}
            />
          </tbody>
        </table>
      </div>
      <GroupedTables
        testId="historical-report-purchases"
        partyHeading={FR.bySupplierTitle}
        partyLabel={FR.supplier}
        unspecifiedPartyLabel={FR.unspecifiedSupplier}
        partyRows={report.bySupplier}
        productHeading={FR.byProductPurchaseTitle}
        productRows={report.byProduct}
      />
    </>
  );
}

function SalesTable({ report }: { report: HistoricalSalesReport }) {
  return (
    <>
      <div className="sk-table-wrapper">
        <table className="sk-table">
          <tbody>
            <MoneyRow label={FR.total} value={report.totalDzd} strong />
            <tr>
              <th scope="row">{FR.quantity}</th>
              <td className="sk-num">{qty(report.totalQuantity)}</td>
            </tr>
            <CountRow label={FR.operations} value={report.transactionCount} />
            <CountRow label={FR.customer} value={report.customerCount} />
            <CountRow label={FR.product} value={report.productCount} />
            <MoneyRow
              label={FR.unspecifiedCustomer}
              value={report.unspecifiedCustomerTotalDzd}
            />
          </tbody>
        </table>
      </div>
      <GroupedTables
        testId="historical-report-sales"
        partyHeading={FR.byCustomerTitle}
        partyLabel={FR.customer}
        unspecifiedPartyLabel={FR.unspecifiedCustomer}
        partyRows={report.byCustomer}
        showUnpaid
        productHeading={FR.byProductSaleTitle}
        productRows={report.byProduct}
      />
    </>
  );
}

function SellerRanking({ title, rows }: { title: string; rows: HistoricalSellerRow[] }) {
  return (
    <div className="sk-section-block">
      <h4 className="sk-subsection-title">{title}</h4>
      {rows.length === 0 ? (
        <p className="sk-muted">{FR.sellersEmpty}</p>
      ) : (
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <thead>
              <tr>
                <th scope="col">{FR.product}</th>
                <th scope="col">{FR.quantitySold}</th>
                <th scope="col">{FR.revenue}</th>
                <th scope="col">{FR.margin}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.canonicalKey}>
                  <th scope="row">{row.label}</th>
                  <td className="sk-num">{qty(row.quantitySold)}</td>
                  <td className="sk-num">{money(row.revenueDzd)}</td>
                  {/* Never a computed figure when the cost is unknown: a
                      missing cost read as zero would show a 100 % margin. */}
                  <td className="sk-num">
                    {row.marginKnown ? money(row.marginDzd) : <em>{FR.unknownMargin}</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SellersTable({ report }: { report: HistoricalSellersReport }) {
  return (
    <div data-testid="historical-report-sellers">
      <p className="sk-muted">{FR.sellersIntro}</p>
      <SellerRanking title={FR.bestByQuantity} rows={report.bestByQuantity} />
      <SellerRanking title={FR.worstByQuantity} rows={report.worstByQuantity} />
      <SellerRanking title={FR.bestByMargin} rows={report.bestByMargin} />
      <SellerRanking title={FR.worstByMargin} rows={report.worstByMargin} />
      {report.unknownMargin.length > 0 && (
        <div data-testid="historical-report-unknown-margin">
          <p className="sk-callout sk-callout--warning">{FR.unknownMarginExplain}</p>
          <SellerRanking title={FR.unknownMarginTitle} rows={report.unknownMargin} />
        </div>
      )}
    </div>
  );
}

/** Reports 6 and 7 share one debt table: a single lifetime balance per party. */
function DebtTable({
  rows,
  partyLabel,
  emptyLabel,
  totalDzd,
  partyCount,
  transactionCount,
  testId,
}: {
  rows: {
    party: string | null;
    balanceDzd: string;
    transactionCount: number;
    oldestDate: string;
    newestDate: string;
  }[];
  partyLabel: string;
  emptyLabel: string;
  totalDzd: string;
  partyCount: number;
  transactionCount: number;
  testId: string;
}) {
  if (rows.length === 0) return <p className="sk-muted">{emptyLabel}</p>;
  return (
    <div className="sk-table-wrapper" data-testid={testId}>
      <table className="sk-table">
        <thead>
          <tr>
            <th scope="col">{partyLabel}</th>
            <th scope="col">{FR.balance}</th>
            <th scope="col">{FR.transactions}</th>
            <th scope="col">{FR.oldest}</th>
            <th scope="col">{FR.newest}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.party ?? '__unspecified__'}>
              <th scope="row">{row.party ?? <em>{FR.unspecifiedParty}</em>}</th>
              <td className="sk-num">{money(row.balanceDzd)}</td>
              <td className="sk-num">{row.transactionCount}</td>
              <td>{row.oldestDate}</td>
              <td>{row.newestDate}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">
              <strong>{FR.debtTotal}</strong>
            </th>
            <td className="sk-num">
              <strong>{money(totalDzd)}</strong>
            </td>
            <td className="sk-num">{transactionCount}</td>
            <td colSpan={2}>{FR.debtPartyCount(partyCount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CustomerDebtTable({ report }: { report: HistoricalCustomerDebtReport }) {
  return (
    <div>
      <p className="sk-muted">{FR.debtExplain}</p>
      <DebtTable
        testId="historical-report-customer-debt"
        rows={report.rows}
        partyLabel={FR.customer}
        emptyLabel={FR.debtEmpty}
        totalDzd={report.totalDzd}
        partyCount={report.partyCount}
        transactionCount={report.transactionCount}
      />
    </div>
  );
}

function SupplierDebtAndExpensesTable({
  report,
}: {
  report: HistoricalSupplierDebtAndExpensesReport;
}) {
  return (
    <div data-testid="historical-report-supplier-debt-and-expenses">
      <h4 className="sk-subsection-title">{FR.supplierSectionTitle}</h4>
      <p className="sk-muted">{FR.supplierDebtExplain}</p>
      <DebtTable
        testId="historical-report-supplier-debt"
        rows={report.supplier.rows}
        partyLabel={FR.supplier}
        emptyLabel={FR.supplierDebtEmpty}
        totalDzd={report.supplier.totalDzd}
        partyCount={report.supplier.partyCount}
        transactionCount={report.supplier.transactionCount}
      />

      <h4 className="sk-subsection-title">{FR.expensesTitle}</h4>
      <p className="sk-muted">{FR.expensesExplain}</p>
      {report.expenses.rows.length === 0 ? (
        <p className="sk-muted">{FR.expensesEmpty}</p>
      ) : (
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <thead>
              <tr>
                <th scope="col">{FR.category}</th>
                <th scope="col">{FR.amount}</th>
                <th scope="col">{FR.unpaidColumn}</th>
                <th scope="col">{FR.lines}</th>
                <th scope="col">{FR.operations}</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.rows.map((row) => (
                <tr key={row.category ?? '__uncategorized__'}>
                  <th scope="row">{row.category ?? <em>{FR.uncategorized}</em>}</th>
                  <td className="sk-num">{money(row.totalDzd)}</td>
                  <td className="sk-num">{money(row.unpaidDzd)}</td>
                  <td className="sk-num">{row.lineCount}</td>
                  <td className="sk-num">{row.transactionCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  <strong>{FR.total}</strong>
                </th>
                <td className="sk-num">
                  <strong>{money(report.expenses.totalDzd)}</strong>
                </td>
                <td className="sk-num">{money(report.expenses.unpaidTotalDzd)}</td>
                <td className="sk-num">{report.expenses.lineCount}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function StockValuationTable({ report }: { report: HistoricalStockValuationReport }) {
  return (
    <div data-testid="historical-report-stock-valuation">
      <p className="sk-muted">{FR.stockIntro}</p>
      {report.asOfDate !== null && <p className="sk-muted">{FR.stockAsOf(report.asOfDate)}</p>}

      {report.rows.length === 0 ? (
        <p className="sk-muted">{FR.stockEmpty}</p>
      ) : (
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <thead>
              <tr>
                <th scope="col">{FR.product}</th>
                <th scope="col">{FR.stockQuantity}</th>
                <th scope="col">{FR.stockUnitCost}</th>
                <th scope="col">{FR.stockValue}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.canonicalKey}>
                  <th scope="row">{row.label}</th>
                  <td className="sk-num">{qty(row.quantity)}</td>
                  <td className="sk-num">{money(row.unitCostDzd)}</td>
                  <td className="sk-num">{money(row.valueDzd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  <strong>{FR.stockTotal}</strong>
                </th>
                <td className="sk-num">
                  <strong>{qty(report.totalQuantity)}</strong>
                </td>
                <td />
                <td className="sk-num">
                  <strong>{money(report.totalValueDzd)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="sk-section-block">
        <h4 className="sk-subsection-title">{FR.stockProofTitle}</h4>
        <div className="sk-table-wrapper">
          <table className="sk-table">
            <tbody>
              <MoneyRow label={FR.stockProof} value={report.totalPurchasedDzd} />
              <MoneyRow label={FR.stockProofCogs} value={report.totalCogsDzd} />
              <MoneyRow label={FR.stockProofStock} value={report.totalValueDzd} />
              <MoneyRow label={FR.stockProofResidual} value={report.balanceResidualDzd} strong />
            </tbody>
          </table>
        </div>
        <p
          className={`sk-callout ${report.balances ? 'sk-callout--info' : 'sk-callout--danger'}`}
        >
          {report.balances ? FR.stockProofOk : FR.stockProofFail}
        </p>
      </div>
    </div>
  );
}

/**
 * WS-I — the eight core reports over the recopied paper ledger.
 *
 * Three rules this screen exists to enforce, and never bends:
 *
 *   - a report whose figures come from a purchase cost renders NOTHING numeric
 *     while the product mapping is incomplete. The database decides that, not
 *     this component: `canRender` arrives false and `report` arrives null, so
 *     there is no number here to display even by mistake. A report that reads
 *     only amounts, names and payment status stays available, and says why;
 *   - wherever a profit appears, the paper's own figure, the computed figure
 *     and the gap between them appear together, with the reason they differ;
 *   - a sale with no known purchase cost is never priced at zero. Its revenue
 *     is reported in its own section, and any product it touches reports an
 *     unknown margin rather than a fictitious 100 % one.
 *
 * Every amount is an exact decimal string from PostgreSQL `numeric`. This file
 * formats them as text and never does arithmetic on them.
 */
export function HistoricalReportsScreen({ sessionToken, batchId }: Props) {
  const [code, setCode] = useState<HistoricalReportCode>('PROFIT_AND_LOSS');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [envelope, setEnvelope] = useState<HistoricalReportEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setExportError(null);
    try {
      const result = await getHistoricalReport(sessionToken, {
        reportCode: code,
        batchId,
        dateFrom: dateFrom === '' ? null : dateFrom,
        dateTo: dateTo === '' ? null : dateTo,
      });
      setEnvelope(result);
      setError(null);
    } catch {
      setEnvelope(null);
      setError(FR.loadError);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, batchId, code, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = envelope?.readiness ?? null;

  const refusalDetails = useMemo(() => {
    if (readiness === null) return [];
    const details: string[] = [];
    if (readiness.unresolvedDescriptionCount > 0) {
      details.push(
        FR.refusalUnresolved(
          readiness.unresolvedDescriptionCount,
          readiness.distinctDescriptionCount,
        ),
      );
    }
    if (readiness.sellWithoutCostSourceCount > 0) {
      details.push(
        FR.refusalNoCost(
          readiness.sellWithoutCostSourceCount,
          readiness.sellWithoutCostSourceValueDzd,
        ),
      );
    }
    return details;
  }, [readiness]);

  /* The export gate is the READINESS gate, read again rather than decided
   * again: when the database refused to compute the report there is no payload
   * to format, and the buttons must say so with the very sentence the screen
   * already shows in place of the figures. */
  const exportRefusal = historicalReportExportRefusal(envelope);

  const runExport = useCallback(
    async (format: 'xlsx' | 'pdf') => {
      if (envelope === null || historicalReportExportRefusal(envelope) !== null) return;
      setExporting(format);
      setExportError(null);
      try {
        if (format === 'xlsx') exportHistoricalReportXlsx(envelope);
        else await exportHistoricalReportPdf(envelope);
      } catch {
        setExportError(EX.exportFailed);
      } finally {
        setExporting(null);
      }
    },
    [envelope],
  );

  return (
    <div className="sk-section-block" data-testid="historical-reports">
      <h3 className="sk-subsection-title">{FR.title}</h3>
      <p className="sk-muted">{FR.intro}</p>

      {/* ---- report chooser ------------------------------------------------ */}
      <div className="sk-stack" role="tablist" aria-label={FR.title}>
        {REPORT_CODES.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === code}
            className={`sk-button ${item === code ? '' : 'sk-button--secondary'}`}
            onClick={() => setCode(item)}
          >
            {FR.tabs[item]}
          </button>
        ))}
      </div>

      {/* ---- free date range ----------------------------------------------- */}
      <fieldset className="sk-section-block">
        <legend>{FR.periodTitle}</legend>
        <label>
          {FR.from}{' '}
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            data-testid="historical-report-date-from"
          />
        </label>{' '}
        <label>
          {FR.to}{' '}
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            data-testid="historical-report-date-to"
          />
        </label>{' '}
        <button
          type="button"
          className="sk-button sk-button--secondary"
          onClick={() => {
            setDateFrom('');
            setDateTo('');
          }}
        >
          {FR.reset}
        </button>
      </fieldset>

      {loading && <p className="sk-muted">{FR.loading}</p>}
      {error !== null && <p className="sk-callout sk-callout--danger">{error}</p>}

      {/* ---- the refusal --------------------------------------------------- */}
      {!loading && envelope !== null && !envelope.canRender && (
        <div className="sk-callout sk-callout--warning" data-testid="historical-report-refusal">
          <p>
            <strong>{FR.refusalTitle}</strong>
          </p>
          <p>{envelope.refusalReason === 'NO_BATCH' ? FR.refusalNoBatch : FR.refusalMapping}</p>
          {refusalDetails.length > 0 && (
            <ul>
              {refusalDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* A report that does not consume cost stays available while the mapping
          is unfinished, but says so rather than looking fully settled. */}
      {!loading &&
        envelope !== null &&
        envelope.canRender &&
        readiness !== null &&
        !readiness.isComplete && (
          <p
            className="sk-callout sk-callout--warning"
            data-testid="historical-report-mapping-notice"
          >
            {FR.mappingUnfinishedNotice}
          </p>
        )}

      {/* ---- export -------------------------------------------------------- */}
      {!loading && envelope !== null && (
        <div className="sk-section-block" data-testid="historical-report-export">
          <h4 className="sk-subsection-title">{EX.exportHeading}</h4>
          <p className="sk-muted">{EX.exportExplain}</p>
          <div className="sk-stack">
            <button
              type="button"
              className="sk-button sk-button--secondary"
              disabled={exportRefusal !== null || exporting !== null}
              onClick={() => void runExport('xlsx')}
              data-testid="historical-report-export-xlsx"
            >
              {EX.exportXlsx}
            </button>{' '}
            <button
              type="button"
              className="sk-button sk-button--secondary"
              disabled={exportRefusal !== null || exporting !== null}
              onClick={() => void runExport('pdf')}
              data-testid="historical-report-export-pdf"
            >
              {EX.exportPdf}
            </button>
          </div>
          {exporting !== null && <p className="sk-muted">{EX.exportBusy}</p>}
          {exportError !== null && (
            <p className="sk-callout sk-callout--danger">{exportError}</p>
          )}
          {/* Deliberately the same sentence as the refusal block above: an
              export must never produce a number the screen itself hides. */}
          {exportRefusal !== null && (
            <p
              className="sk-callout sk-callout--warning"
              data-testid="historical-report-export-refusal"
            >
              {exportRefusal}
            </p>
          )}
        </div>
      )}

      {/* ---- the report ---------------------------------------------------- */}
      {!loading && envelope !== null && envelope.canRender && envelope.report !== null && (
        <>
          {code === 'PROFIT_AND_LOSS' && (
            <ProfitAndLossTable report={envelope.report as HistoricalProfitAndLossReport} />
          )}
          {code === 'MONTHLY_TREND' && (
            <MonthlyTrendTable rows={envelope.report as HistoricalMonthlyTrendRow[]} />
          )}
          {code === 'PURCHASES' && (
            <PurchasesTable report={envelope.report as HistoricalPurchasesReport} />
          )}
          {code === 'SALES' && <SalesTable report={envelope.report as HistoricalSalesReport} />}
          {code === 'SELLERS' && (
            <SellersTable report={envelope.report as HistoricalSellersReport} />
          )}
          {code === 'CUSTOMER_DEBT' && (
            <CustomerDebtTable report={envelope.report as HistoricalCustomerDebtReport} />
          )}
          {code === 'SUPPLIER_DEBT_AND_EXPENSES' && (
            <SupplierDebtAndExpensesTable
              report={envelope.report as HistoricalSupplierDebtAndExpensesReport}
            />
          )}
          {code === 'STOCK_VALUATION' && (
            <StockValuationTable report={envelope.report as HistoricalStockValuationReport} />
          )}
        </>
      )}
    </div>
  );
}
