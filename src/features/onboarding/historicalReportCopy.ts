import type { HistoricalReportCode } from '../../shared/ipc/onboardingDto';
import { formatExactDzd } from './productMapping';

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */
/* French only for this release. Every visible string lives here rather than
 * inline in the markup, so a second language becomes another object of the
 * same shape rather than a rewrite of the component. There is deliberately no
 * language toggle yet — that is a later task.
 *
 * This table is shared by the on-screen reports and by their .xlsx / PDF
 * exports. That sharing is the point: WS-I-2's rule is that an export may never
 * show less than the screen shows, and the cheapest way to guarantee that is to
 * give both renderers one and only one source for every sentence. A string
 * changed for the screen is changed for the accountant's PDF in the same edit. */

export const FR = {
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
/* Export-only copy                                                           */
/* -------------------------------------------------------------------------- */
/* Sentences that exist only on a downloaded file — the cover block, the column
 * the accountant reads first, the reminder of where the figures come from.
 * Same shape and same French-only policy as `EXPORT_COPY` in
 * `historicalExports.ts`, which serves the older analytics export. */

export const REPORT_EXPORT_COPY = {
  documentTitle: 'Rapports du cahier',
  exportHeading: 'Exporter ce rapport',
  exportExplain:
    "Le fichier reprend exactement les chiffres affichés ci-dessus, sans nouveau calcul. Le classeur Excel contient de vrais nombres : votre comptable peut additionner une colonne directement.",
  exportXlsx: 'Exporter en Excel (.xlsx)',
  exportPdf: 'Exporter en PDF (A4)',
  exportBusy: 'Préparation du fichier…',
  exportFailed:
    "Le fichier n'a pas pu être créé. Réessayez, et prévenez votre responsable si le problème persiste.",
  /* Shown on the disabled export controls. Deliberately the SAME sentence the
   * screen already shows instead of the report: an export must never produce a
   * number the screen itself refuses to display. */
  exportRefusedMapping: FR.refusalMapping,
  exportRefusedNoBatch: FR.refusalNoBatch,
  exportRefusedTitle: FR.refusalTitle,

  periodAll: 'Toute la période',
  periodFrom: (date: string) => `À partir du ${date}`,
  periodTo: (date: string) => `Jusqu'au ${date}`,
  periodBetween: (from: string, to: string) => `Du ${from} au ${to}`,
  generatedAt: 'Édité le',
  source:
    "Source : cahier recopié, calculs effectués par la base de données. Montants en dinars algériens (DA).",
  page: (current: number, total: number) => `Page ${current} / ${total}`,
  sheetSummary: 'Rapport',
} as const;

/* -------------------------------------------------------------------------- */
/* Money and quantity formatting — string in, string out                      */
/* -------------------------------------------------------------------------- */
/* The database already rounded these to 2 decimals. This pads and groups them
 * as TEXT. It never calls Number(), parseFloat() or toFixed(), because the
 * moment a dinar figure becomes an IEEE-754 double it stops being exact.
 *
 * The screen and both exporters call these same two functions, so a figure
 * printed on the accountant's PDF is character-for-character the figure the
 * operator read on screen. */

export function money(value: string | null | undefined): string {
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
export function qty(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.trim();
  if (trimmed === '') return '—';
  const [whole] = trimmed.split('.');
  return formatExactDzd(whole);
}
