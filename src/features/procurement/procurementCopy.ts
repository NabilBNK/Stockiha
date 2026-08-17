import type { Locale } from '../../shared/i18n';

export type ProcurementCopy = {
  refresh: string;
  cancel: string;
  close: string;
  loading: string;
  actions: string;
  status: string;
  supplier: string;
  warehouse: string;
  purchaseOrder: string;
  receipt: string;
  document: string;
  journal: string;
  amount: string;
  date: string;
  note: string;
  product: string;
  quantity: string;
  unitCost: string;
  total: string;
  createInvoice: string;
  invoiceTitle: string;
  invoiceEmpty: string;
  invoiceDraftCreated: string;
  invoiceConfirmed: string;
  confirmInvoice: string;
  receiptLine: string;
  availableToInvoice: string;
  noInvoiceLines: string;
  landedCost: string;
  allocateLandedCost: string;
  allocationMethod: string;
  byQuantity: string;
  byValue: string;
  equalPerLine: string;
  landedCostPosted: string;
  alreadyAllocated: string;
  noReceipts: string;
  receiptsTitle: string;
  returnTitle: string;
  returnSubtitle: string;
  newReturn: string;
  returnEmpty: string;
  returnDraftCreated: string;
  returnConfirmed: string;
  confirmReturn: string;
  reason: string;
  defective: string;
  excess: string;
  wrongItem: string;
  returnable: string;
  payablesTitle: string;
  outstandingTotal: string;
  noPayables: string;
  originalAmount: string;
  outstanding: string;
  dueDate: string;
  paySupplier: string;
  paymentAmount: string;
  paymentMethod: string;
  cash: string;
  bank: string;
  check: string;
  paymentPosted: string;
  paymentHistory: string;
  noPayments: string;
  processing: string;
  confirmPayment: string;
  openPeriodRequired: string;
  requestUncertain: string;
  quantityExceedsAvailable: string;
  quantityExceedsReturnable: string;
  paymentExceedsOutstanding: string;
  receiptJournal: string;
  clearing: string;
  inventoryValue: string;
  variance: string;
  code: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  taxId: string;
  address: string;
  active: string;
  inactive: string;
  edit: string;
  activate: string;
  deactivate: string;
  newSupplier: string;
  editSupplier: string;
  newPurchaseOrder: string;
  createPurchaseOrderDraft: string;
  destinationWarehouse: string;
  orderLines: string;
  unit: string;
  subtotalPreview: string;
  addLine: string;
  remove: string;
  saveDraft: string;
  poNumber: string;
  created: string;
  view: string;
  confirmOrder: string;
  receiveGoods: string;
  cancelOrder: string;
  orderDetail: string;
  ordered: string;
  received: string;
  remaining: string;
  confirmGoodsReceipt: string;
  receiptDate: string;
  receiveNow: string;
  previouslyReceived: string;
  confirming: string;
  optionalNote: string;
  newPurchase: string;
  confirmPurchase: string;
  purchaseConfirmed: string;
  purchasesTitle: string;
  purchaseNumber: string;
  directPurchase: string;
  purchaseOrderOrigin: string;
  origin: string;
  searchReceiptsPlaceholder: string;
  allOrigins: string;
  allSuppliers: string;
  allWarehouses: string;
  totalReceipts: string;
  totalValue: string;
  directPurchases: string;
  viewDetails: string;
  receiptDetail: string;
  accountingImpact: string;
  inventoryMerchandise: string;
  grniAccount: string;
  balancedJournal: string;
  viewJournal: string;
  exportXlsx: string;
  noReceiptsSubtitle: string;
  retry: string;
};

export const PROCUREMENT_COPY: Record<Locale, ProcurementCopy> = {
  en: {
    newPurchase: 'New purchase', confirmPurchase: 'Confirm purchase', purchaseConfirmed: 'Direct purchase posted successfully.',
    purchasesTitle: 'Purchases & goods receipts', purchaseNumber: 'Purchase #',
    directPurchase: 'Direct Purchase', purchaseOrderOrigin: 'Purchase Order', origin: 'Origin',
    searchReceiptsPlaceholder: 'Search receipt #, supplier, journal…',
    allOrigins: 'All origins', allSuppliers: 'All suppliers', allWarehouses: 'All warehouses',
    totalReceipts: 'Total Receipts', totalValue: 'Total Value', directPurchases: 'Direct Purchases',
    viewDetails: 'View details', receiptDetail: 'Purchase Receipt Detail', accountingImpact: 'Accounting Impact',
    inventoryMerchandise: 'Inventory Merchandise (Debit)', grniAccount: 'Goods Received Not Invoiced (Credit)',
    balancedJournal: 'Balanced Entry (Debit = Credit)', viewJournal: 'View Journal',
    exportXlsx: 'Export Excel (.xlsx)',
    noReceiptsSubtitle: 'Confirmed Direct Purchases and physical goods receipts will appear here.',
    retry: 'Retry',
    refresh: 'Refresh', cancel: 'Cancel', close: 'Close', loading: 'Loading…', actions: 'Actions',
    status: 'Status', supplier: 'Supplier', warehouse: 'Warehouse', purchaseOrder: 'Purchase order',
    receipt: 'Receipt', document: 'Document', journal: 'Journal', amount: 'Amount', date: 'Date',
    note: 'Note / reference', product: 'Product / variant', quantity: 'Quantity', unitCost: 'Unit cost', total: 'Total',
    createInvoice: 'New supplier invoice', invoiceTitle: 'Supplier invoices', invoiceEmpty: 'No supplier invoices found.',
    invoiceDraftCreated: 'Supplier invoice draft created.', invoiceConfirmed: 'Supplier invoice posted.',
    confirmInvoice: 'Confirm invoice', receiptLine: 'Matched receipt line', availableToInvoice: 'Available to invoice',
    noInvoiceLines: 'No uninvoiced receipt lines are available for this purchase order.', landedCost: 'Landed cost',
    allocateLandedCost: 'Allocate landed cost', allocationMethod: 'Allocation method', byQuantity: 'By received quantity',
    byValue: 'By receipt value', equalPerLine: 'Equal per line', landedCostPosted: 'Landed cost posted.',
    alreadyAllocated: 'Already allocated', noReceipts: 'No purchase receipts yet', receiptsTitle: 'Purchase Receipts & History',
    returnTitle: 'Supplier returns & debit notes', returnSubtitle: 'Return received goods through an auditable stock and accounting posting.',
    newReturn: 'New return', returnEmpty: 'No supplier returns found.', returnDraftCreated: 'Supplier return draft created.',
    returnConfirmed: 'Supplier return posted.', confirmReturn: 'Confirm return', reason: 'Reason', defective: 'Defective / damaged goods',
    excess: 'Excess delivery', wrongItem: 'Wrong item', returnable: 'Returnable quantity', payablesTitle: 'Supplier payables',
    outstandingTotal: 'Total outstanding', noPayables: 'No open supplier payables.', originalAmount: 'Original amount',
    outstanding: 'Outstanding', dueDate: 'Due date', paySupplier: 'Pay supplier', paymentAmount: 'Payment amount',
    paymentMethod: 'Payment method', cash: 'Cash', bank: 'Bank transfer', check: 'Check', paymentPosted: 'Supplier payment posted.',
    paymentHistory: 'Payment history', noPayments: 'No supplier payments found.', processing: 'Processing…',
    confirmPayment: 'Confirm payment', openPeriodRequired: 'An open fiscal period is required.',
    requestUncertain: 'The request was not confirmed. Retry uses the same request identity.', receiptJournal: 'Receipt journal',
    quantityExceedsAvailable: 'Invoice quantity cannot exceed the uninvoiced receipt quantity.',
    quantityExceedsReturnable: 'Return quantity cannot exceed the net received quantity.',
    paymentExceedsOutstanding: 'Payment cannot exceed the selected outstanding liability.',
    clearing: 'Clearing', inventoryValue: 'Inventory value', variance: 'Variance', code: 'Code', name: 'Name',
    contact: 'Contact', phone: 'Phone', email: 'Email', taxId: 'Tax ID (NIF / NIS)', address: 'Address',
    active: 'Active', inactive: 'Inactive', edit: 'Edit', activate: 'Activate', deactivate: 'Deactivate',
    newSupplier: 'New supplier', editSupplier: 'Edit supplier', newPurchaseOrder: 'New purchase order',
    createPurchaseOrderDraft: 'Create purchase order draft', destinationWarehouse: 'Destination warehouse', orderLines: 'Order lines', unit: 'Unit',
    subtotalPreview: 'Subtotal preview', addLine: 'Add line', remove: 'Remove', saveDraft: 'Save draft', poNumber: 'PO number', created: 'Created',
    view: 'View', confirmOrder: 'Confirm order', receiveGoods: 'Receive goods', cancelOrder: 'Cancel order', orderDetail: 'Purchase order detail',
    ordered: 'Ordered', received: 'Received', remaining: 'Remaining', confirmGoodsReceipt: 'Confirm goods receipt', receiptDate: 'Receipt date',
    receiveNow: 'Receive now', previouslyReceived: 'Previously received', confirming: 'Confirming…', optionalNote: 'Optional purchase-order note',
  },
  fr: {
    newPurchase: 'Nouvel achat', confirmPurchase: 'Confirmer l’achat', purchaseConfirmed: 'Achat direct enregistré avec succès.',
    purchasesTitle: 'Achats et réceptions de marchandises', purchaseNumber: 'N° Achat',
    directPurchase: 'Achat direct', purchaseOrderOrigin: 'Commande d’achat', origin: 'Origine',
    searchReceiptsPlaceholder: 'Rechercher n° réception, fournisseur, journal…',
    allOrigins: 'Toutes origines', allSuppliers: 'Tous les fournisseurs', allWarehouses: 'Tous les dépôts',
    totalReceipts: 'Total Réceptions', totalValue: 'Valeur Totale', directPurchases: 'Achats Directs',
    viewDetails: 'Voir détails', receiptDetail: 'Détail du Bon de Réception', accountingImpact: 'Impact Comptable',
    inventoryMerchandise: 'Stock Marchandises (Débit)', grniAccount: 'Factures Non Parvenues / FNP (Crédit)',
    balancedJournal: 'Écriture Équilibrée (Débit = Crédit)', viewJournal: 'Voir le journal',
    exportXlsx: 'Exporter Excel (.xlsx)',
    noReceiptsSubtitle: 'Les achats directs confirmés et les réceptions de marchandises apparaîtront ici.',
    retry: 'Réessayer',
    refresh: 'Actualiser', cancel: 'Annuler', close: 'Fermer', loading: 'Chargement…', actions: 'Actions',
    status: 'Statut', supplier: 'Fournisseur', warehouse: 'Dépôt', purchaseOrder: "Commande d’achat",
    receipt: 'Réception', document: 'Document', journal: 'Journal', amount: 'Montant', date: 'Date',
    note: 'Note / référence', product: 'Produit / variante', quantity: 'Quantité', unitCost: 'Coût unitaire', total: 'Total',
    createInvoice: 'Nouvelle facture fournisseur', invoiceTitle: 'Factures fournisseurs', invoiceEmpty: 'Aucune facture fournisseur.',
    invoiceDraftCreated: 'Brouillon de facture créé.', invoiceConfirmed: 'Facture fournisseur comptabilisée.',
    confirmInvoice: 'Confirmer la facture', receiptLine: 'Ligne de réception rapprochée', availableToInvoice: 'Disponible à facturer',
    noInvoiceLines: 'Aucune ligne de réception non facturée pour cette commande.', landedCost: 'Frais d’approche',
    allocateLandedCost: 'Affecter les frais d’approche', allocationMethod: 'Méthode de répartition', byQuantity: 'Selon la quantité reçue',
    byValue: 'Selon la valeur reçue', equalPerLine: 'Répartition égale', landedCostPosted: 'Frais d’approche comptabilisés.',
    alreadyAllocated: 'Déjà affectés', noReceipts: 'Aucun bon de réception pour le moment', receiptsTitle: 'Bons de Réception et Historique',
    returnTitle: 'Retours fournisseurs et notes de débit', returnSubtitle: 'Retourner les marchandises reçues avec une écriture stock et comptable traçable.',
    newReturn: 'Nouveau retour', returnEmpty: 'Aucun retour fournisseur.', returnDraftCreated: 'Brouillon de retour créé.',
    returnConfirmed: 'Retour fournisseur comptabilisé.', confirmReturn: 'Confirmer le retour', reason: 'Motif', defective: 'Marchandise défectueuse / endommagée',
    excess: 'Livraison excédentaire', wrongItem: 'Article incorrect', returnable: 'Quantité retournable', payablesTitle: 'Dettes fournisseurs',
    outstandingTotal: 'Total restant', noPayables: 'Aucune dette fournisseur ouverte.', originalAmount: 'Montant initial',
    outstanding: 'Restant', dueDate: 'Échéance', paySupplier: 'Payer le fournisseur', paymentAmount: 'Montant du paiement',
    paymentMethod: 'Mode de paiement', cash: 'Espèces', bank: 'Virement bancaire', check: 'Chèque', paymentPosted: 'Paiement fournisseur comptabilisé.',
    paymentHistory: 'Historique des paiements', noPayments: 'Aucun paiement fournisseur.', processing: 'Traitement…',
    confirmPayment: 'Confirmer le paiement', openPeriodRequired: 'Une période comptable ouverte est requise.',
    requestUncertain: 'La demande n’a pas été confirmée. Une nouvelle tentative réutilise la même identité.', receiptJournal: 'Journal de réception',
    quantityExceedsAvailable: 'La quantité facturée ne peut pas dépasser la quantité reçue non facturée.',
    quantityExceedsReturnable: 'La quantité retournée ne peut pas dépasser la quantité nette reçue.',
    paymentExceedsOutstanding: 'Le paiement ne peut pas dépasser la dette sélectionnée restante.',
    clearing: 'Apurement', inventoryValue: 'Valeur du stock', variance: 'Écart', code: 'Code', name: 'Nom',
    contact: 'Contact', phone: 'Téléphone', email: 'E-mail', taxId: 'Identifiant fiscal (NIF / NIS)', address: 'Adresse',
    active: 'Actif', inactive: 'Inactif', edit: 'Modifier', activate: 'Activer', deactivate: 'Désactiver',
    newSupplier: 'Nouveau fournisseur', editSupplier: 'Modifier le fournisseur', newPurchaseOrder: "Nouvelle commande d’achat",
    createPurchaseOrderDraft: "Créer un brouillon de commande", destinationWarehouse: 'Dépôt de destination', orderLines: 'Lignes de commande', unit: 'Unité',
    subtotalPreview: 'Sous-total provisoire', addLine: 'Ajouter une ligne', remove: 'Retirer', saveDraft: 'Enregistrer le brouillon', poNumber: 'N° commande', created: 'Créée le',
    view: 'Voir', confirmOrder: 'Confirmer la commande', receiveGoods: 'Réceptionner', cancelOrder: 'Annuler la commande', orderDetail: 'Détail de la commande',
    ordered: 'Commandé', received: 'Reçu', remaining: 'Restant', confirmGoodsReceipt: 'Confirmer la réception', receiptDate: 'Date de réception',
    receiveNow: 'Réception actuelle', previouslyReceived: 'Déjà reçu', confirming: 'Confirmation…', optionalNote: 'Note facultative de commande',
  },
  ar: {
    newPurchase: 'شراء جديد', confirmPurchase: 'تأكيد الشراء', purchaseConfirmed: 'تم تسجيل الشراء المباشر بنجاح.',
    purchasesTitle: 'المشتريات واستلام البضائع', purchaseNumber: 'رقم الشراء',
    directPurchase: 'شراء مباشر', purchaseOrderOrigin: 'أمر شراء', origin: 'المصدر',
    searchReceiptsPlaceholder: 'بحث برقم الاستلام، المورد، القيد…',
    allOrigins: 'جميع المصادر', allSuppliers: 'جميع الموردين', allWarehouses: 'جميع المخازن',
    totalReceipts: 'إجمالي الاستلامات', totalValue: 'القيمة الإجمالية', directPurchases: 'المشتريات المباشرة',
    viewDetails: 'عرض التفاصيل', receiptDetail: 'تفاصيل وصل الاستلام', accountingImpact: 'الأثر المحاسبي',
    inventoryMerchandise: 'مخزون البضائع (مدين)', grniAccount: 'بضاعة مستلمة غير مفوترة (دائن)',
    balancedJournal: 'قيد متوازن (مدين = دائن)', viewJournal: 'عرض القيد',
    exportXlsx: 'تصدير إكسل (.xlsx)',
    noReceiptsSubtitle: 'ستظهر هنا المشتريات المباشرة المؤكدة واستلامات البضائع الفعلية.',
    retry: 'إعادة المحاولة',
    refresh: 'تحديث', cancel: 'إلغاء', close: 'إغلاق', loading: 'جارٍ التحميل…', actions: 'الإجراءات',
    status: 'الحالة', supplier: 'المورد', warehouse: 'المخزن', purchaseOrder: 'أمر الشراء',
    receipt: 'الاستلام', document: 'المستند', journal: 'القيد', amount: 'المبلغ', date: 'التاريخ',
    note: 'ملاحظة / مرجع', product: 'المنتج / الصنف', quantity: 'الكمية', unitCost: 'تكلفة الوحدة', total: 'المجموع',
    createInvoice: 'فاتورة مورد جديدة', invoiceTitle: 'فواتير الموردين', invoiceEmpty: 'لا توجد فواتير موردين.',
    invoiceDraftCreated: 'تم إنشاء مسودة فاتورة المورد.', invoiceConfirmed: 'تم ترحيل فاتورة المورد.',
    confirmInvoice: 'تأكيد الفاتورة', receiptLine: 'سطر الاستلام المطابق', availableToInvoice: 'المتاح للفوترة',
    noInvoiceLines: 'لا توجد أسطر استلام غير مفوترة لهذا الأمر.', landedCost: 'تكاليف الاستيراد والنقل',
    allocateLandedCost: 'توزيع التكاليف الإضافية', allocationMethod: 'طريقة التوزيع', byQuantity: 'حسب الكمية المستلمة',
    byValue: 'حسب قيمة الاستلام', equalPerLine: 'بالتساوي على الأسطر', landedCostPosted: 'تم ترحيل التكاليف الإضافية.',
    alreadyAllocated: 'موزعة مسبقاً', noReceipts: 'لا توجد وصولات استلام حتى الآن', receiptsTitle: 'وصولات الاستلام والسجل',
    returnTitle: 'مرتجعات الموردين وإشعارات الخصم', returnSubtitle: 'إرجاع البضاعة المستلمة مع حركة مخزون وقيد محاسبي قابلين للتتبع.',
    newReturn: 'مرتجع جديد', returnEmpty: 'لا توجد مرتجعات موردين.', returnDraftCreated: 'تم إنشاء مسودة المرتجع.',
    returnConfirmed: 'تم ترحيل مرتجع المورد.', confirmReturn: 'تأكيد المرتجع', reason: 'السبب', defective: 'بضاعة تالفة / معيبة',
    excess: 'كمية زائدة', wrongItem: 'صنف خاطئ', returnable: 'الكمية القابلة للإرجاع', payablesTitle: 'ديون الموردين',
    outstandingTotal: 'إجمالي المتبقي', noPayables: 'لا توجد ديون موردين مفتوحة.', originalAmount: 'المبلغ الأصلي',
    outstanding: 'المتبقي', dueDate: 'تاريخ الاستحقاق', paySupplier: 'دفع للمورد', paymentAmount: 'مبلغ الدفع',
    paymentMethod: 'طريقة الدفع', cash: 'نقداً', bank: 'تحويل بنكي', check: 'شيك', paymentPosted: 'تم ترحيل دفعة المورد.',
    paymentHistory: 'سجل الدفعات', noPayments: 'لا توجد دفعات موردين.', processing: 'جارٍ التنفيذ…',
    confirmPayment: 'تأكيد الدفع', openPeriodRequired: 'يجب توفر فترة محاسبية مفتوحة.',
    requestUncertain: 'لم يتم تأكيد الطلب. ستستخدم المحاولة الجديدة نفس معرّف الطلب.', receiptJournal: 'قيد الاستلام',
    quantityExceedsAvailable: 'لا يمكن أن تتجاوز كمية الفاتورة كمية الاستلام غير المفوترة.',
    quantityExceedsReturnable: 'لا يمكن أن تتجاوز كمية المرتجع صافي الكمية المستلمة.',
    paymentExceedsOutstanding: 'لا يمكن أن تتجاوز الدفعة الدين المتبقي المحدد.',
    clearing: 'التسوية', inventoryValue: 'قيمة المخزون', variance: 'الفرق', code: 'الرمز', name: 'الاسم',
    contact: 'جهة الاتصال', phone: 'الهاتف', email: 'البريد الإلكتروني', taxId: 'المعرف الجبائي (NIF / NIS)', address: 'العنوان',
    active: 'نشط', inactive: 'غير نشط', edit: 'تعديل', activate: 'تفعيل', deactivate: 'تعطيل',
    newSupplier: 'مورد جديد', editSupplier: 'تعديل المورد', newPurchaseOrder: 'أمر شراء جديد',
    createPurchaseOrderDraft: 'إنشاء مسودة أمر شراء', destinationWarehouse: 'المخزن المستلم', orderLines: 'أسطر الطلب', unit: 'الوحدة',
    subtotalPreview: 'المجموع الفرعي المبدئي', addLine: 'إضافة سطر', remove: 'حذف', saveDraft: 'حفظ المسودة', poNumber: 'رقم أمر الشراء', created: 'تاريخ الإنشاء',
    view: 'عرض', confirmOrder: 'تأكيد الأمر', receiveGoods: 'استلام البضاعة', cancelOrder: 'إلغاء الأمر', orderDetail: 'تفاصيل أمر الشراء',
    ordered: 'المطلوب', received: 'المستلم', remaining: 'المتبقي', confirmGoodsReceipt: 'تأكيد استلام البضاعة', receiptDate: 'تاريخ الاستلام',
    receiveNow: 'الكمية المستلمة الآن', previouslyReceived: 'المستلم سابقاً', confirming: 'جارٍ التأكيد…', optionalNote: 'ملاحظة اختيارية لأمر الشراء',
  },
};
