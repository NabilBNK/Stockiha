// WS-I-2 §6 — the WhatsApp reminder text for a customer who owes money
// (A11: copied to the clipboard, no messaging integration exists).

import { formatDisplayAmount, formatDisplayDate } from '../../../shared/utils/formatters';
import type { Locale } from '../../../shared/i18n';

export interface BuildReminderTextArgs {
  locale: Locale;
  name: string;
  shopName: string;
  shopPhone: string;
  totalOpen: string;
  overdueTotal: string;
  oldestDueDate: string | null;
}

// `formatDisplayAmount` already appends the currency unit ("1,000.00 DZD" —
// this app's one shared exact-money formatter, DZD not DA), so the
// plan's literal " DA"/" دج" suffix around {amount}/{overdue} would
// double up the currency in the customer-facing text. Dropped here; every
// other word of the plan's templates is unchanged.
const TEMPLATES: Record<Locale, { withOverdue: string; withoutOverdue: string }> = {
  fr: {
    withOverdue:
      'Bonjour {name}, nous vous rappelons amicalement que votre solde chez {shop} est de {amount}, dont {overdue} échus depuis le {date}. Merci de régulariser dès que possible.{shopLine}',
    withoutOverdue:
      'Bonjour {name}, nous vous rappelons amicalement que votre solde chez {shop} est de {amount}. Merci.{shopLine}',
  },
  ar: {
    withOverdue:
      'السلام عليكم {name}، نذكّركم بلطف بأن رصيدكم لدى {shop} هو {amount}، منها {overdue} مستحقة منذ {date}. نرجو التسوية في أقرب وقت.{shopLine}',
    withoutOverdue:
      'السلام عليكم {name}، نذكّركم بلطف بأن رصيدكم لدى {shop} هو {amount}. شكرًا.{shopLine}',
  },
  en: {
    withOverdue:
      'Hello {name}, a friendly reminder that your balance with {shop} is {amount}, of which {overdue} has been due since {date}. Please settle it as soon as possible.{shopLine}',
    withoutOverdue:
      'Hello {name}, a friendly reminder that your balance with {shop} is {amount}. Thank you.{shopLine}',
  },
};

export function buildReminderText(args: BuildReminderTextArgs): string {
  const { locale, name, shopName, shopPhone, totalOpen, overdueTotal, oldestDueDate } = args;
  const hasOverdue = Number(overdueTotal) > 0;
  const template = hasOverdue ? TEMPLATES[locale].withOverdue : TEMPLATES[locale].withoutOverdue;
  // The trailing "{shop} — {phone}" sign-off is one unit, gated on phone
  // (shop name alone, mid-sentence, is assumed always configured — WS-M-1
  // requires it in Settings → Printing).
  const shopLine = shopPhone ? ` ${shopName} — ${shopPhone}` : '';

  return template
    .replace('{name}', name)
    .replace(/\{shop\}/g, shopName)
    .replace('{amount}', formatDisplayAmount(totalOpen))
    .replace('{overdue}', formatDisplayAmount(overdueTotal))
    .replace('{date}', formatDisplayDate(oldestDueDate, locale))
    .replace('{shopLine}', shopLine);
}
