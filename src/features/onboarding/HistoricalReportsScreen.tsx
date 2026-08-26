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
import { formatExactDzd } from './productMapping';

interface Props {
  sessionToken: string;
  batchId: number;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */
/* French only for this release. Every visible string lives here rather than
 * inline in the markup, so a second language becomes another object of the
 * same shape rather than a rewrite of the component. There is deliberately no
 * language toggle yet — that is a later task. */

const FR = {
  title: 'Rapports du cahier',
  intro:
    "Ces rapports sont calculés à partir du cahier recopié, une fois tous les articles regroupés. Tous les montants sont en dinars (DA), calculés par la base de données, jamais par l'écran.",

  tabs: {
    PROFIT_AND_LOSS: 'Résultat de la période',
    MONTHLY_TREND: 'Évolution mois par mois',
    PURCHASES: 'Achats',
    SALES: 'Ventes',
    SELLERS: 'Ce qui se vend le mieux',
    CUSTOMER_DEBT: 'Ce que les clients doivent',
    SUPPLIER_DEBT_AND_EXPENSES: 'Fournisseurs et dépenses',
    STOCK_VALUATION: 'Stock restant et sa valeur',
  } satisfies Record<HistoricalReportCode, string>,

  periodTitle: 'Période',
  from: 'Du',
  to: 'Au',
  reset: 'Toute la période',
  loading: 'Calcul en cours…',
  loadError:
    "Le rapport n'a pas pu être calculé. Réessayez, et prévenez votre responsable si le problème persiste.",

  /* The readiness refusal. A wrong number is worse than no number. */
  refusalTitle: 'Ce rapport ne peut pas encore être calculé.',
  refusalMapping:
    "Certains articles écrits dans le cahier n'ont pas encore été regroupés. Tant que ce n'est pas terminé, une vente pourrait être comptée sans son prix d'achat, et le bénéfice affiché serait faux. Retournez à l'écran « Regrouper les articles du cahier », plus haut sur cette page, et confirmez les lignes restantes.",
  refusalNoBatch:
    "Aucun cahier n'a encore été recopié. Importez d'abord le fichier du cahier, puis revenez ici.",
  /* Shown on a report that does not depend on the coût d'achat, and can
   * therefore be trusted even while the regroupement is unfinished. */
  mappingUnfinishedNotice:
    "Le regroupement des articles n'est pas terminé, mais ce rapport n'en dépend pas : il ne lit que les montants, les noms et la mention « payé / non payé ». Les rapports qui utilisent le coût d'achat, eux, restent indisponibles tant que le regroupement n'est pas fini.",
  refusalUnresolved: (n: number, total: number) =>
    `${n} façon(s) d'écrire un article sur ${total} n'ont pas encore été confirmées.`,
  refusalNoCost: (n: number, value: string) =>
    `${n} article(s) vendu(s) n'ont aucun achat correspondant dans le cahier (${money(value)} DA de ventes).`,

  /* The two-tier honesty block. */
  twoTierTitle: 'Bénéfice noté sur le cahier et bénéfice calculé',
  twoTierExplain:
    "Ces deux chiffres ne sont pas censés être identiques : le bénéfice du cahier est une note écrite à la main sur chaque vente, tandis que le bénéfice calculé retire le coût d'achat réel des articles vendus et, pour le résultat net, les dépenses.",
  recordedBenefit: 'Bénéfice noté sur le cahier',
  computedGross: 'Bénéfice calculé (marge brute)',
  computedNet: 'Résultat net calculé',
  gapVsGross: 'Écart (cahier − marge brute)',
  gapVsNet: 'Écart (cahier − résultat net)',

  /* Report 1. */
  revenue: 'Ventes',
  purchases: 'Achats',
  cogs: "Coût d'achat des articles vendus",
  grossProfit: 'Marge brute',
  expenses: 'Dépenses',
  netProfit: 'Résultat net',
  customerDebt: 'Dû par les clients',
  supplierDebt: 'Dû aux fournisseurs',
  unpaidExpenses: 'Dépenses non payées',
  figure: 'Chiffre',
  amount: 'Montant (DA)',
  headlineNote:
    "Les totaux ci-dessus sont exactement la somme des lignes du tableau « Évolution mois par mois » : si vous additionnez la colonne à la main, vous retrouvez le même chiffre au centime près.",

  /* Report 1 — the cost-free split. */
  splitTitle: "Ventes avec et sans prix d'achat connu",
  withCostTitle: "Ventes dont le prix d'achat est connu",
  revenueWithCost: 'Ventes concernées',
  grossOnCosted: 'Marge brute sur ces ventes',
  withoutCostTitle: "Ventes sans aucun achat enregistré",
  withoutCostExplain:
    "Le profit sur ces ventes ne peut pas être calculé — aucun achat n'est enregistré pour ces produits. C'est normal : le magasin avait déjà du stock avant le début du cahier. Ces ventes sont comptées dans le chiffre d'affaires, mais elles n'ont ni coût ni marge, et elles ne sont jamais comptées comme du bénéfice.",
  revenueWithoutCost: 'Ventes concernées',
  linesWithCost: 'Lignes de vente concernées',
  linesWithoutCost: 'Lignes de vente concernées',
  reasonNoPurchase: "Dont : aucun achat de cet article avant la vente",
  reasonNoQuantity: 'Dont : aucune quantité écrite sur la ligne',
  totalRevenueTitle: 'Total des ventes',
  totalRevenueExplain:
    'Ventes avec prix d\'achat connu + ventes sans achat enregistré = total des ventes de la période.',

  countsTitle: 'Précisions sur le calcul',
  saleLineCount: 'Lignes de vente',
  monthCount: 'Mois couverts',
  withBenefit: 'Ventes avec un bénéfice noté',
  withoutBenefit: 'Ventes sans bénéfice noté',

  /* Report 2. */
  month: 'Mois',
  trendEmpty: 'Aucune opération sur la période choisie.',

  /* Reports 3 and 4. */
  supplier: 'Fournisseur',
  customer: 'Client',
  product: 'Article',
  quantity: 'Quantité',
  lines: 'Lignes',
  operations: 'Opérations',
  total: 'Total',
  unpaidColumn: 'Dont non payé (DA)',
  bySupplierTitle: 'Achats par fournisseur',
  byProductPurchaseTitle: 'Achats par article',
  byCustomerTitle: 'Ventes par client',
  byProductSaleTitle: 'Ventes par article',
  unspecifiedSupplier: 'Fournisseur non précisé',
  unspecifiedCustomer: 'Client non précisé',
  canonicalNote:
    "Chaque article est nommé par le regroupement confirmé, pas par l'orthographe écrite sur la ligne : deux façons d'écrire le même article ne peuvent pas apparaître comme deux articles.",
  emptyRows: 'Aucune opération sur la période choisie.',

  /* Report 5. */
  sellersIntro:
    "Classement des articles vendus. Le classement par quantité n'a besoin d'aucun prix d'achat. Le classement par marge, lui, en a besoin : un article dont une seule vente n'a aucun achat enregistré est affiché « marge inconnue » et n'entre pas dans ce classement, car compter son coût à zéro le placerait en tête avec une marge de 100 %.",
  bestByQuantity: 'Les plus vendus (quantité)',
  worstByQuantity: 'Les moins vendus (quantité)',
  bestByMargin: 'Les plus rentables (marge)',
  worstByMargin: 'Les moins rentables (marge)',
  unknownMarginTitle: 'Articles dont la marge est inconnue',
  unknownMarginExplain:
    "Ces articles ont au moins une vente sans achat enregistré. Leur quantité vendue est exacte ; leur marge, elle, ne peut pas être calculée.",
  unknownMargin: 'marge inconnue',
  quantitySold: 'Quantité vendue',
  margin: 'Marge (DA)',
  sellersEmpty: 'Aucune vente sur la période choisie.',

  /* Report 6 and 7 — debt. */
  debtExplain:
    "Il s'agit du total des ventes marquées « non payé » pour chaque client, depuis le début. Le cahier ne note aucun paiement partiel et aucune date d'échéance : ce chiffre est donc un solde unique par client, sans échelonnement et sans retard calculé.",
  supplierDebtExplain:
    "Il s'agit du total des achats marqués « non payé » pour chaque fournisseur, depuis le début. Comme pour les clients, le cahier ne note ni paiement partiel ni date d'échéance : c'est un solde unique par fournisseur, sans échelonnement et sans retard calculé.",
  balance: 'Solde dû (DA)',
  transactions: 'Opérations',
  oldest: 'Plus ancienne',
  newest: 'Plus récente',
  unspecifiedParty: 'Non précisé',
  debtTotal: 'Total dû',
  debtEmpty: 'Aucune vente non payée sur la période choisie.',
  supplierDebtEmpty: 'Aucun achat non payé sur la période choisie.',
  debtPartyCount: (n: number) => `${n} nom(s) précisé(s).`,

  /* Report 7 — expenses. */
  expensesTitle: 'Dépenses par catégorie',
  expensesExplain:
    "Les dépenses sont regroupées par le texte que vous avez écrit vous-même dans la colonne « Custom Details » du cahier. Il n'existe pas de liste de catégories dans le logiciel : ce sont vos propres mots, repris tels quels.",
  category: 'Catégorie écrite',
  uncategorized: 'Sans catégorie écrite',
  expensesEmpty: 'Aucune dépense sur la période choisie.',
  supplierSectionTitle: 'Ce que vous devez aux fournisseurs',

  /* Report 8. */
  stockIntro:
    "Ce qu'il reste en stock d'après le cahier, article par article, et ce que ce stock a coûté (coût moyen pondéré).",
  stockAsOf: (date: string) =>
    `Situation au ${date}, c'est-à-dire après la dernière opération recopiée. Un stock est une position, pas un mouvement : le filtre de période ne s'applique donc pas à ce rapport.`,
  stockQuantity: 'Quantité restante',
  stockValue: 'Valeur (DA)',
  stockUnitCost: 'Coût moyen unitaire (DA)',
  stockTotal: 'Total du stock',
  stockEmpty: 'Aucun stock restant.',
  stockProofTitle: 'Vérification',
  stockProof: 'Total acheté',
  stockProofCogs: "Coût d'achat des articles vendus",
  stockProofStock: 'Valeur du stock restant',
  stockProofResidual: 'Écart',
  stockProofOk:
    "Total acheté = coût des articles vendus + valeur du stock restant. Aucun dinar n'est perdu en route.",
  stockProofFail:
    "Attention : total acheté ≠ coût des articles vendus + valeur du stock restant. Prévenez votre responsable.",
} as const;

/* -------------------------------------------------------------------------- */
/* Money and quantity formatting — string in, string out                      */
/* -------------------------------------------------------------------------- */
/* The database already rounded these to 2 decimals. This pads and groups them
 * as TEXT. It never calls Number(), parseFloat() or toFixed(), because the
 * moment a dinar figure becomes an IEEE-754 double it stops being exact. */

function money(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.trim();
  if (trimmed === '') return '—';
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  const twoDecimals = `${fraction}00`.slice(0, 2);
  return formatExactDzd(`${negative ? '-' : ''}${whole}.${twoDecimals}`);
}

/** Quantities are whole units; they are grouped but never given decimals. */
function qty(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.trim();
  if (trimmed === '') return '—';
  const [whole] = trimmed.split('.');
  return formatExactDzd(whole);
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

  const load = useCallback(async () => {
    setLoading(true);
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
