import { useEffect } from 'react';
import { useI18n, type Locale } from '../shared/i18n';
import type { AppView } from './AppShell';

export interface PageGuideInfo {
  title: string;
  summary: string;
  keyActions: string[];
  tip?: string;
}

const PAGE_GUIDES: Record<Locale, Record<AppView, PageGuideInfo>> = {
  fr: {
    dashboard: {
      title: 'Tableau de bord',
      summary: 'Vue d’ensemble en temps réel de votre activité commerciale, de la valeur de votre stock et de vos indicateurs financiers clés.',
      keyActions: [
        'Suivre le chiffre d’affaires, la marge brute et le panier moyen du jour ou du mois.',
        'Consulter les alertes de stock critique et de créances clients en retard.',
        'Visualiser les graphiques d’évolution des ventes et des produits phares.',
      ],
      tip: 'Cliquez directement sur les cartes KPI ou les boutons d’accès rapide pour naviguer vers les écrans détaillés.',
    },
    pos: {
      title: 'Point de vente (Caisse)',
      summary: 'Interface de caisse rapide et tactile pour enregistrer les ventes au comptant, scanner les articles et encaisser les clients.',
      keyActions: [
        'Scanner le code-barres ou rechercher un produit pour l’ajouter au panier.',
        'Ajuster les quantités, appliquer une remise ou associer un client pour une vente à crédit.',
        'Encaisser par espèces et imprimer immédiatement le ticket de caisse.',
      ],
      tip: 'Assurez-vous d’avoir ouvert une session de caisse avant de commencer les encaissements.',
    },
    session: {
      title: 'Sessions de caisse',
      summary: 'Gestion des shifts de caisse : ouverture avec fond de caisse, suivi des mouvements d’espèces et clôture journalière.',
      keyActions: [
        'Ouvrir une session avec le montant du fond de caisse initial.',
        'Enregistrer les entrées et sorties d’espèces exceptionnelles avec justification.',
        'Clôturer la session en comptant les espèces réelles et imprimer le rapport Z.',
      ],
      tip: 'Le système compare automatiquement les espèces théoriques et réelles pour détecter les écarts de caisse.',
    },
    documents: {
      title: 'Documents de vente',
      summary: 'Registre et consultation de tous les documents commerciaux émis (tickets de vente, factures et avoirs).',
      keyActions: [
        'Rechercher et filtrer les documents par date, type, statut ou numéro.',
        'Réimprimer un ticket ou télécharger une facture officielle au format PDF A4.',
        'Consulter le détail des lignes et les écritures comptables associées.',
      ],
      tip: 'Les documents validés sont immuables pour garantir la conformité comptable et l’auditabilité.',
    },
    customers: {
      title: 'Clients',
      summary: 'Répertoire des clients, suivi des plafonds de crédit, encours et encaissements des créances.',
      keyActions: [
        'Créer et modifier les fiches clients et leurs coordonnées.',
        'Configurer les limites de crédit et les délais de paiement autorisés.',
        'Enregistrer les règlements de créances et consulter l’extrait de compte client.',
      ],
      tip: 'Le système bloque automatiquement les ventes à crédit si le client dépasse son plafond ou présente un retard de paiement.',
    },
    purchases: {
      title: 'Achats & Réceptions',
      summary: 'Gestion des approvisionnements auprès des fournisseurs, bons de commande, réceptions et factures d’achat.',
      keyActions: [
        'Créer un bon de commande ou enregistrer une réception directe de marchandises.',
        'Mettre à jour automatiquement le coût moyen pondéré (PUMP/WAC) et le stock disponible.',
        'Enregistrer les paiements fournisseurs et les retours d’articles.',
      ],
      tip: 'Chaque réception validée met à jour la valorisation de votre stock et génère l’écriture comptable correspondante.',
    },
    suppliers: {
      title: 'Fournisseurs',
      summary: 'Annuaire des fournisseurs, gestion des conditions d’achat et suivi des dettes fournisseurs.',
      keyActions: [
        'Ajouter et gérer les fiches coordonnées de vos fournisseurs.',
        'Consulter le solde des dettes et l’historique des achats effectués.',
        'Préparer les règlements et bons de commande associés.',
      ],
      tip: 'Maintenir les informations de contact à jour facilite la passation des commandes d’approvisionnement.',
    },
    products: {
      title: 'Catalogue produits',
      summary: 'Gestion centrale du catalogue articles, des variantes, des conditionnements (packs) et des prix de vente.',
      keyActions: [
        'Créer et modifier des produits avec leurs codes-barres et SKU.',
        'Définir les prix de vente, la TVA et le stock d’alerte minimum.',
        'Configurer les unités de vente par carton/paquet (packs) et leurs coefficients.',
      ],
      tip: 'Le stock négatif est strictement empêché par le système pour préserver la vérité comptable.',
    },
    inventory: {
      title: 'Inventaire & Stocks',
      summary: 'Suivi en temps réel des niveaux de stock physiques, valeur financière globale et localisation en entrepôt.',
      keyActions: [
        'Consulter les quantités en stock et la valeur financière valorisée au PUMP (WAC).',
        'Filtrer par catégorie, statut ou seuil de rupture de stock.',
        'Préparer les audits de stock physique avant inventaire.',
      ],
      tip: 'Utilisez la recherche par code-barres pour localiser instantanément un article et son stock disponible.',
    },
    stock: {
      title: 'Réceptions stock',
      summary: 'Réception et entrée physique de marchandises en stock avec calcul automatique du coût unitaire moyen.',
      keyActions: [
        'Enregistrer l’arrivée de marchandises avec ou sans bon d’achat préalable.',
        'Mettre à jour immédiatement les quantités disponibles en rayon et en réserve.',
        'Vérifier la mise à jour automatique de la valeur d’inventaire.',
      ],
      tip: 'La validation d’une entrée de stock est définitive et met à jour le PUMP du magasin.',
    },
    adjustment: {
      title: 'Ajustements stock',
      summary: 'Ajustements et régularisations de stock pour aligner le stock théorique sur le stock compté physiquement.',
      keyActions: [
        'Déclarer des pertes, casses, expirations ou gains d’inventaire constatés.',
        'Justifier chaque ajustement par un motif obligatoire pour l’audit.',
        'Valider l’ajustement pour générer l’écriture comptable de régularisation.',
      ],
      tip: 'Seuls les utilisateurs autorisés peuvent valider des ajustements de stock.',
    },
    catalogueSetup: {
      title: 'Configuration catalogue',
      summary: 'Configuration des référentiels du catalogue (catégories d’articles, unités de mesure et attributs).',
      keyActions: [
        'Structurer les catégories et sous-catégories de produits.',
        'Définir les unités de mesure (pièce, kg, litre, mètre) et leurs conversions.',
        'Configurer les attributs personnalisés (taille, couleur, marque).',
      ],
      tip: 'Une bonne organisation des catégories améliore la lisibilité de vos rapports de vente.',
    },
    reports: {
      title: 'Rapports & Statistiques',
      summary: 'Centre d’analyse de la performance commerciale, des marges, des alertes de rentabilité et requêtes personnalisées.',
      keyActions: [
        'Analyser les ventes par produit, catégorie, vendeur et créneau horaire.',
        'Identifier les produits à faible marge nécessitant un ajustement de prix.',
        'Personnaliser des rapports sur n’importe quelle période et exporter en PDF ou CSV.',
      ],
      tip: 'Utilisez l’onglet « Rapport personnalisé » pour explorer l’historique complet de vos transactions.',
    },
    journals: {
      title: 'Journaux comptables',
      summary: 'Journal général des écritures comptables en partie double, pièces justificatives et contrôle d’équilibre.',
      keyActions: [
        'Consulter chaque écriture comptable générée par les ventes, achats et règlements.',
        'Vérifier l’équilibre strict débit/crédit de chaque écriture (balance = 0).',
        'Imprimer la pièce comptable officielle A4 ou télécharger son justificatif PDF.',
      ],
      tip: 'Les écritures validées sont immuables pour garantir la conformité comptable.',
    },
    historical_finance: {
      title: 'Livre papier (historique)',
      summary: 'Consultation et archivage des registres financiers historiques et livres papier importés.',
      keyActions: [
        'Rechercher dans les écritures et mouvements antérieurs au passage numérique.',
        'Consulter les totaux et historiques comptables archivés.',
        'Comparer les exercices passés avec l’exercice en cours.',
      ],
      tip: 'Les données d’archives sont isolées et n’affectent pas les soldes du grand livre en direct.',
    },
    settings: {
      title: 'Paramètres du système',
      summary: 'Configuration du système, gestion des utilisateurs, sauvegardes, imprimantes et paramètres généraux.',
      keyActions: [
        'Gérer les utilisateurs, leurs rôles et leurs permissions d’accès.',
        'Configurer les imprimantes de caisse (ESC/POS) et les tiroirs-caisses.',
        'Déclencher ou programmer des sauvegardes complètes de la base de données.',
      ],
      tip: 'Effectuez des sauvegardes régulières pour protéger vos données contre toute panne matérielle.',
    },
    opening_state: {
      title: 'Bilan d’ouverture',
      summary: 'Saisie et initialisation des soldes initiaux, du capital, des stocks et des créances/dettes au démarrage.',
      keyActions: [
        'Saisir les comptes d’actif (trésorerie, créances clients, valeur de stock initiale).',
        'Saisir les comptes de passif et capitaux propres (capital social, dettes fournisseurs).',
        'Vérifier l’égalité stricte entre l’actif et le passif avant transmission.',
      ],
      tip: 'Le bilan d’ouverture établit la base comptable irréversible de votre exercice.',
    },
    opening_state_application: {
      title: 'Application du bilan d’ouverture',
      summary: 'Revue, validation définitive et génération des écritures d’ouverture officielles dans le grand livre.',
      keyActions: [
        'Vérifier l’intégrité et la concordance des données de l’état d’ouverture saisi.',
        'Appliquer le bilan d’ouverture pour générer les écritures inaugurales du journal.',
        'Initialiser les soldes de départ pour les ventes, achats et la trésorerie.',
      ],
      tip: 'L’application du bilan d’ouverture est une opération unique qui fige la situation initiale.',
    },
  },
  ar: {
    dashboard: {
      title: 'لوحة التحكم',
      summary: 'نظرة عامة فورية وشاملة على نشاطك التجاري، قيمة المخزون، والمؤشرات المالية الحيوية.',
      keyActions: [
        'متابعة رقم الأعمال، هامش الربح، ومتوسط سلة المشتريات لليوم أو الشهر.',
        'الاطلاع على تنبيهات المخزون المنخفض ومستحقات العملاء المتأخرة.',
        'استعراض المخططات البيانية لتحليل المبيعات وأداء المنتجات الأكثر مبيعاً.',
      ],
      tip: 'انقر على بطاقات المؤشرات (KPI) للانتقال السريع إلى الشاشات والتقارير التفصيلية.',
    },
    pos: {
      title: 'نقطة البيع (الصندوق)',
      summary: 'واجهة نقطة بيع سريعة ومناسبة للشاشات اللمسية لتسجيل المبيعات، مسح الباركود، وتحصيل المدفوعات.',
      keyActions: [
        'مسح الباركود أو البحث عن المنتجات لإضافتها فوراً إلى السلة.',
        'تعديل الكميات، تطبيق الخصومات، أو تحديد عميل للمبيعات بالآجل.',
        'تحصيل الدفع نقداً وطباعة وصل البيع الحراري فوراً.',
      ],
      tip: 'تأكد من فتح جلسة صندوق (Cash Session) قبل الشروع في عمليات البيع.',
    },
    session: {
      title: 'جلسات الصندوق',
      summary: 'إدارة جلسات الصندوق : فتح الوردية برصيد افتتاحي، متابعة حركات السحب والإيداع، والإغلاق اليومي.',
      keyActions: [
        'فتح الجلسة بتحديد رصيد الصندوق الافتتاحي.',
        'تسجيل عمليات السحب والإيداع النقدي مع توثيق الأسباب.',
        'إغلاق الجلسة بعد جرد النقد الفعلي وطباعة تقرير الإغلاق (Z).',
      ],
      tip: 'يقارن النظام آلياً بين الرصيد النظري والفعلي لكشف أي فائض أو عجز في الصندوق بدقة.',
    },
    documents: {
      title: 'مستندات البيع',
      summary: 'سجل شامل لجميع المستندات التجارية الصادرة (وصولات البيع، الفواتير، وسندات الإرجاع).',
      keyActions: [
        'البحث والتصفية حسب التاريخ، نوع المستند، أو الرقم التسلسلي.',
        'إعادة طباعة الوصولات أو تحميل الفواتير الرسمية بصيغة PDF قياس A4.',
        'فحص تفاصيل البنود والقيود المحاسبية المرتبطة بكل مستند.',
      ],
      tip: 'المستندات المؤكدة غير قابلة للتعديل للحفاظ على النزاهة والامتثال المحاسبي.',
    },
    customers: {
      title: 'العملاء',
      summary: 'دليل العملاء والزبائن، إدارة سقوف الائتمان، ومتابعة الديون والتحصيلات.',
      keyActions: [
        'إضافة وتعديل بيانات العملاء وعناوين الاتصال.',
        'ضبط سقف الائتمان (Credit limit) وأقصى مدة استحقاق مسموحة.',
        'تسجيل تحصيل الديون ومراجعة كشف حساب العميل التفصيلي.',
      ],
      tip: 'يقوم النظام بحظر البيع بالآجل تلقائياً إذا تجاوز العميل سقفه الائتماني أو تأخر عن موعد السداد.',
    },
    purchases: {
      title: 'المشتريات والتوريد',
      summary: 'إدارة المشتريات من الموردين، أوامر الشراء، أذونات الاستلام، وفواتير التوريد.',
      keyActions: [
        'إنشاء طلبات الشراء أو تسجيل استلام البضائع مباشرة في المستودع.',
        'تحديث متوسط التكلفة المرجح (WAC) والكميات المتوفرة بالمخزون آلياً.',
        'تسجيل دفعات الموردين وتوثيق مرتجعات البضائع.',
      ],
      tip: 'كل استلام بضائع مؤكد يولد قيوداً محاسبية مزدوجة في دفتر اليومية آلياً.',
    },
    suppliers: {
      title: 'الموردون',
      summary: 'دليل الموردين، شروط التوريد، ومتابعة الحسابات والمستحقات الدائنة.',
      keyActions: [
        'إضافة وتعديل بيانات الموردين وأرقام الاتصال.',
        'مراجعة رصيد الديون وتاريخ عمليات الشراء السابقة.',
        'إعداد المدفوعات وتجهيز طلبيات التوريد القادمة.',
      ],
      tip: 'تحديث بيانات الموردين يسرّع إجراءات استلام السلع وإدارة الشراء.',
    },
    products: {
      title: 'المنتجات والكتالوج',
      summary: 'الإدارة المركزية لكتالوج المنتجات، الأصناف، العبوات والطرود (Packs)، وأسعار البيع.',
      keyActions: [
        'إنشاء وتعديل المنتجات وأكواد الباركود ورمز SKU.',
        'تحديد أسعار البيع، نسب الضريبة، وحد المخزون الأدنى للتنبيه.',
        'إعداد عبوات البيع بالكرتون أو الطرد وربطها بالوحدة الأساسية.',
      ],
      tip: 'يمنع النظام تماماً بيع كميات سالبة لضمان دقة المخزون والنزاهة الحسابية.',
    },
    inventory: {
      title: 'المخزون والجرد',
      summary: 'متابعة كميات المخزون المتوفرة، القيمة المالية الإجمالية، والتتبع بالمستودع.',
      keyActions: [
        'عرض الكميات المتاحة وقيمتها المالية محسوبة بالتكلفة المتوسطة (WAC).',
        'التصفية حسب الفئة، الحالة، أو المواد المشرفة على النفاد.',
        'تدقيق المخزون والتحضير لعمليات الجرد الدورية.',
      ],
      tip: 'استخدم المسح بالباركود للوصول المباشر إلى بطاقة المنتج والكمية الفعلية.',
    },
    stock: {
      title: 'استلام المخزون',
      summary: 'استلام وتسجيل دخول البضائع والسلع إلى المستودع مع احتساب متوسط التكلفة.',
      keyActions: [
        'تسجيل دخول المواد إلى المستودع بناءً على الشراء أو التوريد.',
        'زيادة الكميات المتوفرة للبيع فوراً على الرفوف وفي المخزن.',
        'التحقق من تحديث تقييم المخزون المالي والتكلفة المرجحة.',
      ],
      tip: 'تأكيد استلام المخزون عملية نهائية ترفع الرصيد وتحدث تكلفة الشراء تلقائياً.',
    },
    adjustment: {
      title: 'تسوية المخزون',
      summary: 'تسويات وتصحيحات المخزون لمطابقة الرصيد الدفتري مع الجرد الفعلي على أرض الواقع.',
      keyActions: [
        'تسجيل الفروقات الناتجة عن التلف، الكسر، انتهاء الصلاحية أو الفائض.',
        'توثيق سبب التسوية الإلزامي لضمان الرقابة والتدقيق الداخلي.',
        'ترحيل التسوية لتوليد القيود المحاسبية التعديلية اللازمة.',
      ],
      tip: 'تتطلب تسوية المخزون صلاحيات إدارية لضمان سلامة العمليات المحاسبية.',
    },
    catalogueSetup: {
      title: 'إعداد الكتالوج',
      summary: 'إعداد هيكل الكتالوج وتصنيفات المنتجات، وحدات القياس، والسمات الأساسية.',
      keyActions: [
        'تنظيم الفئات الرئيسية والفرعية لتصنيف السلع والبضائع.',
        'تحديد وحدات القياس (قطعة، كغ، لتر، متر) ومعاملات التحويل بينها.',
        'تخصيص السمات والمواصفات (الحجم، اللون، العلامة التجارية).',
      ],
      tip: 'التصنيف المنظم للمنتجات يمنحك تقارير بيعية دقيقة وتجربة كاشير أسرع.',
    },
    reports: {
      title: 'التقارير والإحصائيات',
      summary: 'مركز التقارير والتحليلات التجارية، أداء المبيعات، نسب الهوامش، ومستكشف التقارير المخصصة.',
      keyActions: [
        'تحليل المبيعات حسب المنتج، الفئة، الكاشير، وأوقات الذروة.',
        'اكتشاف المنتجات ذات الهامش المنخفض لتعديل أسعارها فوراً.',
        'تخصيص أي تقرير حسب أي فترة زمنية وتصديره بصيغة PDF أو CSV.',
      ],
      tip: 'استخدم تبويب « تقرير مخصص » لاستخراج واستكشاف أي بيانات تريدها بكل مرونة.',
    },
    journals: {
      title: 'اليومية والقيود',
      summary: 'دفتر اليومية العام للقيود المحاسبية بالقيد المزدوج، سندات القيد، وفحص التوازن المالي.',
      keyActions: [
        'مراجعة جميع القيود المحاسبية المنشأة تلقائياً من المبيعات والمشتريات والمدفوعات.',
        'التحقق من التوازن الصارم بين المدين والدائن في كل قيد (Debit = Credit).',
        'طباعة سند القيد المحاسبي الرسمي قياس A4 أو تصديره إلى ملف PDF.',
      ],
      tip: 'القيود المحاسبية المنشورة نهائية وغير قابلة للحذف لضمان معايير المحاسبة المعتمدة.',
    },
    historical_finance: {
      title: 'دفتر ورقي (أرشيف)',
      summary: 'أرشيف الدفاتر الورقية والسجلات المالية التاريخية المستوردة قبل النظام الرقمي.',
      keyActions: [
        'البحث في القيود والمعاملات السابقة لعملية التحول الرقمي.',
        'استعراض المجاميع والأرصدة التاريخية المحفوظة للأرشفة.',
        'مقارنة نتائج الفترات السابقة مع النشاط التشغيلي الحالي.',
      ],
      tip: 'البيانات الأرشيفية مخصصة للاطلاع والمطابقة ولا تؤثر على الأرصدة الحية الحالية.',
    },
    settings: {
      title: 'إعدادات النظام',
      summary: 'إعدادات النظام، إدارة المستخدمين والصلاحيات، النسخ الاحتياطي، وطابعات الإيصالات.',
      keyActions: [
        'إدارة حسابات المستخدمين، كلمات المرور، ومستويات الصلاحيات.',
        'ضبط طابعات الوصولات الحرارية (ESC/POS) ودرج النقود الإلكتروني.',
        'إجراء نسخ احتياطي شامل لقاعدة البيانات وجدولته تلقائياً.',
      ],
      tip: 'يُنصح بإجراء نسخ احتياطي بانتظام لحماية بياناتك المالية من أي عطل غير متوقع.',
    },
    opening_state: {
      title: 'الميزانية الافتتاحية',
      summary: 'تسجيل الأرصدة الافتتاحية، رأس المال، المخزون الأولي، ومستحقات الديون عند إطلاق النظام.',
      keyActions: [
        'إدخال أرصدة الأصول (السيولة النقدية، مستحقات العملاء، وقيمة المخزون الأولي).',
        'إدخال أرصدة الخصوم وحقوق الملكية (رأس المال، ديون الموردين).',
        'التحقق من التوازن التام بين الأصول والخصوم قبل إرسال الميزانية.',
      ],
      tip: 'تشكل الميزانية الافتتاحية الأساس المحاسبي غير القابل للتعديل لسنتك المالية.',
    },
    opening_state_application: {
      title: 'اعتماد الميزانية الافتتاحية',
      summary: 'مراجعة وتأكيد قيود الميزانية الافتتاحية وترحيلها نهائياً إلى دفتر الأستاذ العام.',
      keyActions: [
        'التدقيق النهائي في صحة وتطابق بيانات الميزانية الافتتاحية المسجلة.',
        'تطبيق واعتماد الميزانية لتوليد القيود المحاسبية الافتتاحية في دفتر اليومية.',
        'تهيئة الأرصدة الابتدائية لبدء عمليات البيع والشراء وإدارة الخزينة.',
      ],
      tip: 'اعتماد الميزانية الافتتاحية إجراء يتم مرة واحدة فقط ليثبت الأرصدة البداية للمؤسسة.',
    },
  },
  en: {
    dashboard: {
      title: 'Dashboard',
      summary: 'Real-time overview of business performance, inventory valuation, and core financial health metrics.',
      keyActions: [
        'Track daily and monthly revenue, gross profit, and average basket.',
        'Review critical low-stock alerts and overdue customer credit warnings.',
        'Inspect graphical trends for revenue trajectory and top-selling items.',
      ],
      tip: 'Click directly on KPI cards or quick-action buttons to jump straight to detailed screens.',
    },
    pos: {
      title: 'Point of Sale (Till)',
      summary: 'Fast touchscreen till interface for barcode scanning, cart building, and immediate cash sales checkout.',
      keyActions: [
        'Scan barcodes or search products to instantly populate the cart.',
        'Adjust quantities, apply discounts, or link a customer for credit sales.',
        'Collect payments and automatically generate physical thermal receipts.',
      ],
      tip: 'Ensure an active cash session is opened prior to processing sales transactions.',
    },
    session: {
      title: 'Cash Sessions',
      summary: 'Cash session control: opening float verification, drawer drops/payouts, and end-of-shift reconciliation.',
      keyActions: [
        'Open a shift by verifying initial opening float on hand.',
        'Record manual cash drawer inflows or payouts with mandatory audit reasons.',
        'Close shift by entering counted cash and print the official Z-report.',
      ],
      tip: 'The system automatically compares counted cash against theoretical register totals to spot variances.',
    },
    documents: {
      title: 'Sales Documents',
      summary: 'Central repository of all issued sales receipts, invoices, credit notes, and cancellations.',
      keyActions: [
        'Search and filter documents by date range, type, or serial number.',
        'Reprint receipts or download official A4 PDF invoices.',
        'Review line items and trace linked double-entry ledger vouchers.',
      ],
      tip: 'Confirmed documents are strictly immutable to uphold accounting integrity and tax compliance.',
    },
    customers: {
      title: 'Customers',
      summary: 'Customer directory, credit limit enforcement, receivables tracking, and payment collection.',
      keyActions: [
        'Add and maintain customer contact profiles and fiscal identifiers.',
        'Configure credit limits and allowable payment terms.',
        'Record receivables payments and inspect customer ledger statements.',
      ],
      tip: 'Credit sales are automatically blocked if customer exposure exceeds their credit limit or overdue threshold.',
    },
    purchases: {
      title: 'Purchases & Receipts',
      summary: 'Procurement workflows with suppliers, purchase orders, goods receipts, and vendor bills.',
      keyActions: [
        'Create purchase orders or register direct stock deliveries.',
        'Automatically recompute warehouse weighted average cost (WAC) and balances.',
        'Record vendor payments and document supplier returns.',
      ],
      tip: 'Confirming a receipt updates inventory valuation and posts balanced double-entry journals.',
    },
    suppliers: {
      title: 'Suppliers',
      summary: 'Vendor directory, procurement terms, and accounts payable balance tracking.',
      keyActions: [
        'Add and update supplier contact details and business terms.',
        'Monitor outstanding payable balances and historical purchase activity.',
        'Prepare supplier disbursements and purchase requisitions.',
      ],
      tip: 'Keeping supplier terms and contacts accurate speeds up inventory replenishment.',
    },
    products: {
      title: 'Products & Catalog',
      summary: 'Central item catalog, variant configurations, multi-unit packs, and sales pricing.',
      keyActions: [
        'Create and update items, barcodes, and SKU identifiers.',
        'Define retail prices, tax rates, and minimum stock alerts.',
        'Configure carton and pack hierarchies linked to base units.',
      ],
      tip: 'Confirmed negative stock is strictly forbidden to preserve reliable accounting valuation.',
    },
    inventory: {
      title: 'Inventory Tracking',
      summary: 'Real-time on-hand stock quantities, total inventory valuation, and warehouse location tracking.',
      keyActions: [
        'View on-hand quantities and financial inventory value based on WAC.',
        'Filter by category, stock status, or replenishment threshold.',
        'Audit stock balances ahead of physical count routines.',
      ],
      tip: 'Scan barcodes to instantly view an item’s stock card and current available balance.',
    },
    stock: {
      title: 'Stock Receipts',
      summary: 'Physical stock intake and receiving with automated average cost recalculation.',
      keyActions: [
        'Record warehouse deliveries against purchase orders or direct intake.',
        'Immediately make incoming stock available for sale.',
        'Verify automatic inventory valuation adjustments.',
      ],
      tip: 'Confirming a stock receipt is definitive and updates warehouse unit costs.',
    },
    adjustment: {
      title: 'Stock Adjustments',
      summary: 'Inventory adjustments to reconcile theoretical system counts with physical warehouse inventory.',
      keyActions: [
        'Log damages, theft, spoilage, shrinkage, or unrecorded receipts.',
        'Provide mandatory explanation reasons for internal audit trails.',
        'Post adjustments to generate balanced financial gain/loss journals.',
      ],
      tip: 'Adjustments require supervisor permissions to ensure data safety and control.',
    },
    catalogueSetup: {
      title: 'Catalog Setup',
      summary: 'Master taxonomies, product categories, measurement units, and custom variant attributes.',
      keyActions: [
        'Structure product categories and subcategories.',
        'Define units of measure (piece, kg, liter) and conversion rates.',
        'Set up custom variant attributes (size, color, brand).',
      ],
      tip: 'Logical categorization improves cashier efficiency and report clarity.',
    },
    reports: {
      title: 'Reports & Analytics',
      summary: 'Commercial sales reporting, margin analysis, busy hours, and custom transaction reporting.',
      keyActions: [
        'Analyze sales performance by product, category, cashier, and hour.',
        'Identify low-margin items requiring retail price adjustment.',
        'Generate custom date range queries and export to PDF or CSV.',
      ],
      tip: 'Use the Custom Report tab to query and analyze any transaction dataset on demand.',
    },
    journals: {
      title: 'Accounting Journals',
      summary: 'General ledger double-entry journal vouchers, source evidence, and balance verification.',
      keyActions: [
        'Audit every balanced journal entry posted from sales, purchases, and cash flows.',
        'Verify debit/credit balance equilibrium across all lines.',
        'Print official A4 journal vouchers or export certified PDF documents.',
      ],
      tip: 'Posted journal entries are immutable to guarantee complete fiscal auditability.',
    },
    historical_finance: {
      title: 'Paper Book (History)',
      summary: 'Archived records and historical paper ledger books imported prior to system migration.',
      keyActions: [
        'Search historical entries and transactions prior to system migration.',
        'Inspect legacy balances and certified financial records.',
        'Audit past financial periods without affecting live operations.',
      ],
      tip: 'Archived historical records are isolated and do not alter active live ledgers.',
    },
    settings: {
      title: 'Settings',
      summary: 'System configuration, user management, database backups, receipt printers, and preferences.',
      keyActions: [
        'Manage user accounts, roles, and granular security permissions.',
        'Configure receipt printers (ESC/POS) and cash drawer kickers.',
        'Run and schedule full PostgreSQL database backups.',
      ],
      tip: 'Regular database backups protect against hardware failure and ensure business continuity.',
    },
    opening_state: {
      title: 'Opening Balance Sheet',
      summary: 'Entry and setup of initial account balances, capital, opening stock, and payables/receivables at go-live.',
      keyActions: [
        'Enter asset balances (cash on hand, bank, customer receivables, opening inventory).',
        'Enter liability and equity balances (capital, supplier payables).',
        'Verify that total assets strictly match total liabilities and equity.',
      ],
      tip: 'The opening balance sheet forms the immutable financial foundation for the accounting period.',
    },
    opening_state_application: {
      title: 'Apply Opening Balance',
      summary: 'Final review, official approval, and posting of inaugural opening journal entries to the general ledger.',
      keyActions: [
        'Review data integrity and reconciliation of the entered opening balances.',
        'Apply the opening state to generate the inaugural journal entries.',
        'Initialize baseline balances for active sales, procurement, and treasury operations.',
      ],
      tip: 'Applying the opening balance is a one-time operation that finalizes your initial financial state.',
    },
  },
};

const UI_COPY: Record<Locale, { guideBadge: string; keyActions: string; proTip: string; close: string; ariaClose: string }> = {
  fr: {
    guideBadge: 'Guide d’utilisation',
    keyActions: 'Opérations clés :',
    proTip: 'Astuce :',
    close: 'Compris',
    ariaClose: 'Fermer le guide',
  },
  ar: {
    guideBadge: 'دليل الاستخدام',
    keyActions: 'العمليات الأساسية :',
    proTip: 'نصيحة عملية :',
    close: 'فهمت',
    ariaClose: 'إغلاق الدليل',
  },
  en: {
    guideBadge: 'Page Guide',
    keyActions: 'Key Operations:',
    proTip: 'Pro-tip:',
    close: 'Got it',
    ariaClose: 'Close guide',
  },
};

export function PageGuideModal({
  view,
  onClose,
}: {
  view: AppView;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const activeLocaleGuides = PAGE_GUIDES[locale] ?? PAGE_GUIDES.fr ?? PAGE_GUIDES.en;
  const guide = activeLocaleGuides[view] ?? PAGE_GUIDES.fr[view] ?? PAGE_GUIDES.en[view] ?? PAGE_GUIDES.en.dashboard;
  const copy = UI_COPY[locale] ?? UI_COPY.fr ?? UI_COPY.en;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="sk-modal-overlay"
      data-testid="page-guide-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sk-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header className="sk-guide-dialog__header">
          <div className="sk-guide-dialog__header-text">
            <span className="sk-badge sk-badge--info">{copy.guideBadge}</span>
            <h2 id="guide-title" className="sk-guide-dialog__title">
              {guide.title}
            </h2>
          </div>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={copy.ariaClose}
          >
            ×
          </button>
        </header>

        <div className="sk-guide-dialog__body">
          <p className="sk-guide-dialog__summary">{guide.summary}</p>

          <div className="sk-guide-dialog__section">
            <h4 className="sk-guide-dialog__section-title">{copy.keyActions}</h4>
            <ul className="sk-guide-dialog__list">
              {guide.keyActions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>

          {guide.tip ? (
            <div className="sk-guide-dialog__tip-card">
              <span className="sk-guide-dialog__tip-icon" aria-hidden="true">💡</span>
              <div className="sk-guide-dialog__tip-text">
                <strong>{copy.proTip}</strong> {guide.tip}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="sk-guide-dialog__footer">
          <button
            type="button"
            className="sk-button sk-button--primary"
            onClick={onClose}
            data-testid="page-guide-close-btn"
          >
            {copy.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
