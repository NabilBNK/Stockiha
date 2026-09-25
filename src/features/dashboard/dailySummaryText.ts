// WS-I-3 STEP I3-09 — the "Copy today's summary for WhatsApp" text, pure and
// tested, in the app's three languages.
//
// Deviation (consistent with the WS-I-2 precedent in
// src/features/reports/finance/reminderText.ts): the plan's literal template
// lines end each amount in a literal " DA"/" دج" suffix, but
// `formatDisplayAmount` already appends a currency suffix (" DZD") to every
// amount everywhere else this app shows money — a second, different literal
// suffix here would show two currency markers per line and contradict every
// other report. Amounts below go through `formatDisplayAmount` with no
// extra literal suffix, exactly as `reminderText.ts` already established.

import { formatDisplayAmount, formatDisplayDate } from '../../shared/utils/formatters';

export interface BuildDailySummaryArgs {
  locale: 'fr' | 'ar' | 'en';
  shopName: string;
  date: string;
  netSales: string;
  saleCount: number;
  grossProfit: string;
  expected: string | null;
  receivables: string;
  overdue: string;
  lowStock: number;
}

const CASH_LINE: Record<BuildDailySummaryArgs['locale'], string> = {
  fr: 'Caisse : aucune session ouverte',
  ar: 'الصندوق: لا توجد حصة مفتوحة',
  en: 'Cash: no session open',
};

export function buildDailySummary(args: BuildDailySummaryArgs): string {
  const { locale, shopName, date, netSales, saleCount, grossProfit, expected, receivables, overdue, lowStock } = args;
  const dateText = formatDisplayDate(date, locale);
  const header = shopName ? `${shopName} — ` : '';

  const cashLine = expected === null ? CASH_LINE[locale] : null;

  if (locale === 'fr') {
    const lines = [
      `${header}Résumé du ${dateText}`,
      `Ventes : ${formatDisplayAmount(netSales)} (${saleCount} ventes)`,
      `Marge brute : ${formatDisplayAmount(grossProfit)}`,
      cashLine ?? `Caisse attendue : ${formatDisplayAmount(expected)}`,
      `Créances clients : ${formatDisplayAmount(receivables)} (dont ${formatDisplayAmount(overdue)} échus)`,
      `Stock bas : ${lowStock} articles`,
    ];
    return lines.join('\n');
  }

  if (locale === 'ar') {
    const lines = [
      `${header}ملخص يوم ${dateText}`,
      `المبيعات: ${formatDisplayAmount(netSales)} (${saleCount} عملية)`,
      `الربح الإجمالي: ${formatDisplayAmount(grossProfit)}`,
      cashLine ?? `النقد المتوقع في الصندوق: ${formatDisplayAmount(expected)}`,
      `ديون العملاء: ${formatDisplayAmount(receivables)} (منها ${formatDisplayAmount(overdue)} مستحقة)`,
      `مخزون منخفض: ${lowStock} منتجات`,
    ];
    return lines.join('\n');
  }

  const lines = [
    `${header}Summary for ${dateText}`,
    `Sales: ${formatDisplayAmount(netSales)} (${saleCount} sales)`,
    `Gross profit: ${formatDisplayAmount(grossProfit)}`,
    cashLine ?? `Cash expected: ${formatDisplayAmount(expected)}`,
    `Customer debts: ${formatDisplayAmount(receivables)} (${formatDisplayAmount(overdue)} overdue)`,
    `Low stock: ${lowStock} items`,
  ];
  return lines.join('\n');
}
