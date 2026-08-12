import type { Locale } from '../i18n';

/**
 * String-safe exact money formatter.
 * Formats "1050.00" -> "1,050.00 DZD" without floating-point math or precision loss.
 */
export function formatDisplayAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const str = String(amount).trim();
  if (str === '0' || str === '0.00') return '0.00 DZD';

  const parts = str.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decPart = parts.length > 1 ? parts[1] : '00';
  const paddedDec = decPart.length === 1 ? `${decPart}0` : decPart;

  return `${intPart}.${paddedDec} DZD`;
}

/**
 * Formats a date string (YYYY-MM-DD or ISO string) into readable format according to locale.
 * e.g. "2026-08-12" -> "12 Aug 2026" (en), "12 août 2026" (fr), "12 أغسطس 2026" (ar).
 */
export function formatDisplayDate(dateStr: string | null | undefined, locale: Locale = 'en'): string {
  if (!dateStr) return '—';

  const cleanDateStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const parts = cleanDateStr.split('-');
  if (parts.length !== 3) return dateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return dateStr;

  const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthNamesFr = [
    'janv.',
    'févr.',
    'mars',
    'avr.',
    'mai',
    'juin',
    'juil.',
    'août',
    'sept.',
    'oct.',
    'nov.',
    'déc.',
  ];
  const monthNamesAr = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ];

  if (locale === 'ar') {
    return `${day} ${monthNamesAr[month]} ${year}`;
  }
  if (locale === 'fr') {
    return `${day} ${monthNamesFr[month]} ${year}`;
  }
  return `${day} ${monthNamesEn[month]} ${year}`;
}

/**
 * Human-readable document type labels across supported locales.
 */
export function humanDocumentType(type: string | null | undefined, locale: Locale = 'en'): string {
  if (!type) return '—';

  const LABELS: Record<string, Record<Locale, string>> = {
    PURCHASE_ORDER: { en: 'Purchase Order', fr: 'Bon de commande', ar: 'طلب شراء' },
    PURCHASE_RECEIPT: { en: 'Purchase Receipt', fr: 'Bon de réception', ar: 'وصل استلام شراء' },
    SUPPLIER_INVOICE: { en: 'Supplier Invoice', fr: 'Facture fournisseur', ar: 'فاتورة المورد' },
    PURCHASE_RETURN: { en: 'Supplier Return', fr: 'Retour fournisseur', ar: 'إرجاع للمورد' },
    SUPPLIER_PAYMENT: { en: 'Supplier Payment', fr: 'Paiement fournisseur', ar: 'دفع للمورد' },
    CASH_SALE: { en: 'Cash Sale', fr: 'Vente au comptant', ar: 'بيع نقدي' },
    CREDIT_SALE: { en: 'Credit Sale', fr: 'Vente à crédit', ar: 'بيع بالآجل' },
    CUSTOMER_PAYMENT: { en: 'Customer Payment', fr: 'Paiement client', ar: 'دفع العميل' },
    STOCK_RECEIPT: { en: 'Stock Receipt', fr: 'Entrée de stock', ar: 'وصل استلام مخزون' },
    STOCK_ADJUSTMENT: { en: 'Stock Adjustment', fr: 'Ajustement de stock', ar: 'تعديل مخزون' },
    JOURNAL_ENTRY: { en: 'Journal Entry', fr: 'Écriture comptable', ar: 'قيد محاسبي' },
  };

  return LABELS[type]?.[locale] ?? type;
}

/**
 * Human-readable status & output labels across supported locales.
 */
export function humanStatus(status: string | null | undefined, locale: Locale = 'en'): string {
  if (!status) return '—';

  const STATUS_LABELS: Record<string, Record<Locale, string>> = {
    POSTED: { en: 'Posted', fr: 'Validé', ar: 'مرحل' },
    DRAFT: { en: 'Draft', fr: 'Brouillon', ar: 'مسودة' },
    REVERSED: { en: 'Reversed', fr: 'Annulé', ar: 'معكوس' },
    CANCELLED: { en: 'Cancelled', fr: 'Annulé', ar: 'ملغى' },
    COMPLETED: { en: 'Completed', fr: 'Terminé', ar: 'مكتمل' },
    BALANCED: { en: 'Balanced', fr: 'Équilibré', ar: 'متوازن' },
    UNBALANCED: { en: 'Unbalanced', fr: 'Déséquilibré', ar: 'غير متوازن' },
    NOT_APPLICABLE: { en: 'Not applicable', fr: 'Non applicable', ar: 'غير خاضع' },
    NOT_PRINTED: { en: 'Not printed', fr: 'Non imprimé', ar: 'غير مطبوع' },
    NOT_GENERATED: { en: 'Not generated', fr: 'Non généré', ar: 'غير منشأ' },
  };

  return STATUS_LABELS[status]?.[locale] ?? status;
}
