/**
 * WS-M-2 (spec §5.5): fixed strings printed by the shared A4 engine, keyed by
 * the print locale (never the app locale -- see §A4 / useOfficialDocumentContext).
 * WS-M-4 reviews the wording; this file uses exactly the strings the
 * specification lists.
 */
import type { PrintLocale } from './officialDocument';

export interface PrintStringKeys {
  page: string;
  of: string;
  noLines: string;
  amountInWords: string;
  dinars: string;
  centimes: string;
  nif: string;
  nis: string;
  rc: string;
  ai: string;
  rib: string;
  phone: string;
  email: string;
  web: string;
  printedOn: string;
  madeWith: string;
}

const fr: PrintStringKeys = {
  page: 'Page',
  of: 'sur',
  noLines: 'Aucune ligne.',
  amountInWords: 'Arrêtée la présente pièce à la somme de :',
  dinars: 'dinars algériens',
  centimes: 'centimes',
  nif: 'NIF',
  nis: 'NIS',
  rc: 'RC',
  ai: 'AI',
  rib: 'RIB',
  phone: 'Tél.',
  email: 'E-mail',
  web: 'Site',
  printedOn: 'Imprimé le',
  madeWith: 'Édité avec Stockiha',
};

const ar: PrintStringKeys = {
  page: 'صفحة',
  of: 'من',
  noLines: 'لا توجد أسطر.',
  amountInWords: 'أوقفت هذه الوثيقة على مبلغ:',
  dinars: 'دينار جزائري',
  centimes: 'سنتيم',
  nif: 'رقم التعريف الجبائي (NIF)',
  nis: 'رقم التعريف الإحصائي (NIS)',
  rc: 'السجل التجاري (RC)',
  ai: 'رقم المادة (AI)',
  rib: 'الحساب البنكي (RIB)',
  phone: 'الهاتف',
  email: 'البريد الإلكتروني',
  web: 'الموقع',
  printedOn: 'طُبع في',
  madeWith: 'أُصدر بواسطة Stockiha',
};

const en: PrintStringKeys = {
  page: 'Page',
  of: 'of',
  noLines: 'No lines.',
  amountInWords: 'This document is closed at the amount of:',
  dinars: 'Algerian dinars',
  centimes: 'centimes',
  nif: 'NIF',
  nis: 'NIS',
  rc: 'RC',
  ai: 'AI',
  rib: 'RIB',
  phone: 'Tel.',
  email: 'E-mail',
  web: 'Web',
  printedOn: 'Printed on',
  madeWith: 'Made with Stockiha',
};

const PRINT_STRINGS: Record<PrintLocale, PrintStringKeys> = { fr, ar, en };

export function getPrintStrings(locale: PrintLocale): PrintStringKeys {
  return PRINT_STRINGS[locale];
}
