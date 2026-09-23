/**
 * WS-M-2 (§M2-02): column/section labels shared by the per-kind model
 * builders, keyed by print locale (never the app locale). These are
 * builder-level labels -- distinct from the fixed strings in
 * `printStrings.ts`, which are printed by the renderers themselves.
 */
import type { PrintLocale } from '../officialDocument';

export interface ModelLabels {
  designation: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  subtotal: string;
  discount: string;
  total: string;
  customer: string;
  supplier: string;
  cashier: string;
  paymentMethod: string;
  workstation: string;
  reason: string;
  note: string;
  originalDocument: string;
  account: string;
  label: string;
  debit: string;
  credit: string;
  totalDebit: string;
  totalCredit: string;
  number: string;
  type: string;
  date: string;
  party: string;
  amount: string;
  status: string;
  source: string;
  period: string;
  generatedOn: string;
  journal: string;
  warehouse: string;
}

const fr: ModelLabels = {
  designation: 'Désignation',
  quantity: 'Quantité',
  unitPrice: 'Prix unitaire',
  lineTotal: 'Montant',
  subtotal: 'Sous-total',
  discount: 'Remise',
  total: 'Total',
  customer: 'Client',
  supplier: 'Fournisseur',
  cashier: 'Caissier',
  paymentMethod: 'Mode de paiement',
  workstation: 'Poste',
  reason: 'Motif',
  note: 'Note',
  originalDocument: 'Document original',
  account: 'Compte',
  label: 'Libellé',
  debit: 'Débit',
  credit: 'Crédit',
  totalDebit: 'Total débit',
  totalCredit: 'Total crédit',
  number: 'Numéro',
  type: 'Type',
  date: 'Date',
  party: 'Tiers',
  amount: 'Montant',
  status: 'Statut',
  source: 'Origine',
  period: 'Période',
  generatedOn: 'Généré le',
  journal: 'Journal',
  warehouse: 'Entrepôt',
};

const ar: ModelLabels = {
  designation: 'البيان',
  quantity: 'الكمية',
  unitPrice: 'سعر الوحدة',
  lineTotal: 'المبلغ',
  subtotal: 'المجموع الفرعي',
  discount: 'الخصم',
  total: 'الإجمالي',
  customer: 'الزبون',
  supplier: 'المورد',
  cashier: 'أمين الصندوق',
  paymentMethod: 'طريقة الدفع',
  workstation: 'الجهاز',
  reason: 'السبب',
  note: 'ملاحظة',
  originalDocument: 'المستند الأصلي',
  account: 'الحساب',
  label: 'البيان',
  debit: 'مدين',
  credit: 'دائن',
  totalDebit: 'إجمالي المدين',
  totalCredit: 'إجمالي الدائن',
  number: 'الرقم',
  type: 'النوع',
  date: 'التاريخ',
  party: 'الطرف',
  amount: 'المبلغ',
  status: 'الحالة',
  source: 'المصدر',
  period: 'الفترة',
  generatedOn: 'أُنشئ في',
  journal: 'القيد',
  warehouse: 'المستودع',
};

const en: ModelLabels = {
  designation: 'Description',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  lineTotal: 'Amount',
  subtotal: 'Subtotal',
  discount: 'Discount',
  total: 'Total',
  customer: 'Customer',
  supplier: 'Supplier',
  cashier: 'Cashier',
  paymentMethod: 'Payment method',
  workstation: 'Workstation',
  reason: 'Reason',
  note: 'Note',
  originalDocument: 'Original document',
  account: 'Account',
  label: 'Label',
  debit: 'Debit',
  credit: 'Credit',
  totalDebit: 'Total debit',
  totalCredit: 'Total credit',
  number: 'Number',
  type: 'Type',
  date: 'Date',
  party: 'Party',
  amount: 'Amount',
  status: 'Status',
  source: 'Source',
  period: 'Period',
  generatedOn: 'Generated on',
  journal: 'Journal',
  warehouse: 'Warehouse',
};

const LABELS: Record<PrintLocale, ModelLabels> = { fr, ar, en };

export function getModelLabels(locale: PrintLocale): ModelLabels {
  return LABELS[locale];
}
