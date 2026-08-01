import { useEffect, useState } from 'react';

import { Banner, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type { DrawerOperationPolicy } from '../../shared/ipc/drawerDto';
import {
  listDrawerOperationPolicy,
  updateDrawerOperationPolicy,
} from '../../shared/ipc/drawerGateway';

interface Props {
  sessionToken: string;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Settings',
    subtitle: 'Cash drawer eligibility',
    help: 'Enabled operations queue one drawer pulse only after the financial transaction posts successfully. Printing and reprinting never open the drawer.',
    enabled: 'Enabled',
    disabled: 'Disabled',
    readOnly: 'Only the administrator can change drawer policy. Current values are shown read-only.',
    saved: 'Drawer policy updated.',
    future: 'Prepared for a future posting workflow',
  },
  fr: {
    title: 'Paramètres',
    subtitle: 'Éligibilité de l’ouverture du tiroir',
    help: 'Une opération activée crée une seule impulsion du tiroir après validation réussie de l’écriture financière. L’impression et la réimpression n’ouvrent jamais le tiroir.',
    enabled: 'Activé',
    disabled: 'Désactivé',
    readOnly: 'Seul l’administrateur peut modifier cette politique. Les valeurs actuelles sont affichées en lecture seule.',
    saved: 'Politique du tiroir mise à jour.',
    future: 'Préparé pour un futur flux de comptabilisation',
  },
  ar: {
    title: 'الإعدادات',
    subtitle: 'سياسة فتح درج النقود',
    help: 'العملية المفعلة تنشئ نبضة واحدة للدرج فقط بعد نجاح تسجيل العملية المالية. الطباعة وإعادة الطباعة لا تفتحان الدرج أبداً.',
    enabled: 'مفعل',
    disabled: 'معطل',
    readOnly: 'يمكن للمسؤول فقط تعديل سياسة الدرج. القيم الحالية معروضة للقراءة فقط.',
    saved: 'تم تحديث سياسة الدرج.',
    future: 'مجهز لمسار مالي مستقبلي',
  },
};

const OPERATION_COPY: Record<Locale, Record<string, { title: string; description: string }>> = {
  en: {
    CASH_SALE: { title: 'Cash sale', description: 'Open after a posted POS cash sale.' },
    CUSTOMER_CASH_PAYMENT: { title: 'Customer cash payment', description: 'Open after collecting customer debt in cash.' },
    CUSTOMER_CASH_REFUND: { title: 'Customer cash refund', description: 'Open after an approved customer payment refund is posted.' },
    SUPPLIER_CASH_PAYMENT: { title: 'Supplier cash payment', description: 'Reserved for supplier cash settlement integration.' },
    CASH_EXPENSE: { title: 'Cash expense', description: 'Reserved for company cash expense integration.' },
    CASH_DEPOSIT: { title: 'Cash deposit', description: 'Reserved for authorized cash deposits.' },
    CASH_WITHDRAWAL: { title: 'Cash withdrawal', description: 'Reserved for authorized cash withdrawals.' },
  },
  fr: {
    CASH_SALE: { title: 'Vente en espèces', description: 'Ouvrir après une vente comptant validée au POS.' },
    CUSTOMER_CASH_PAYMENT: { title: 'Paiement client en espèces', description: 'Ouvrir après encaissement en espèces d’une créance client.' },
    CUSTOMER_CASH_REFUND: { title: 'Remboursement client en espèces', description: 'Ouvrir après validation d’un remboursement de paiement client.' },
    SUPPLIER_CASH_PAYMENT: { title: 'Paiement fournisseur en espèces', description: 'Réservé à l’intégration future des règlements fournisseurs.' },
    CASH_EXPENSE: { title: 'Dépense en espèces', description: 'Réservé à l’intégration future des dépenses de caisse.' },
    CASH_DEPOSIT: { title: 'Dépôt en caisse', description: 'Réservé aux dépôts de caisse autorisés.' },
    CASH_WITHDRAWAL: { title: 'Retrait de caisse', description: 'Réservé aux retraits de caisse autorisés.' },
  },
  ar: {
    CASH_SALE: { title: 'بيع نقدي', description: 'فتح الدرج بعد تسجيل بيع نقدي ناجح.' },
    CUSTOMER_CASH_PAYMENT: { title: 'دفعة عميل نقدية', description: 'فتح الدرج بعد تحصيل دين العميل نقداً.' },
    CUSTOMER_CASH_REFUND: { title: 'استرجاع دفعة عميل نقداً', description: 'فتح الدرج بعد تسجيل استرجاع معتمد لدفعة العميل.' },
    SUPPLIER_CASH_PAYMENT: { title: 'دفع نقدي للمورد', description: 'مخصص لربط تسديدات الموردين مستقبلاً.' },
    CASH_EXPENSE: { title: 'مصروف نقدي', description: 'مخصص لربط مصاريف الصندوق مستقبلاً.' },
    CASH_DEPOSIT: { title: 'إيداع نقدي', description: 'مخصص للإيداعات النقدية المرخصة.' },
    CASH_WITHDRAWAL: { title: 'سحب نقدي', description: 'مخصص للسحوبات النقدية المرخصة.' },
  },
};

const CURRENT_OPERATIONS = new Set([
  'CASH_SALE',
  'CUSTOMER_CASH_PAYMENT',
  'CUSTOMER_CASH_REFUND',
]);

export function DrawerPolicySettingsScreen({ sessionToken }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [policies, setPolicies] = useState<DrawerOperationPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canManage = policies.some((policy) => policy.can_manage);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDrawerOperationPolicy(sessionToken)
      .then((rows) => {
        if (!cancelled) setPolicies(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, errorText]);

  async function toggle(policy: DrawerOperationPolicy) {
    if (!canManage || busyCode) return;
    setBusyCode(policy.operation_code);
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateDrawerOperationPolicy(sessionToken, {
        operation_code: policy.operation_code,
        is_enabled: !policy.is_enabled,
      });
      setPolicies((rows) => rows.map((row) => (
        row.operation_code === updated.operation_code ? updated : row
      )));
      setFeedback(text.saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <section className="sk-page">
      <div className="sk-page__header">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {feedback ? <Banner tone="success">{feedback}</Banner> : null}
      {!loading && !canManage ? <Banner tone="warning">{text.readOnly}</Banner> : null}

      <div className="sk-card">
        <h2>{text.subtitle}</h2>
        <p>{text.help}</p>

        {loading ? <Spinner /> : (
          <div className="sk-stack">
            {policies.map((policy) => {
              const localized = OPERATION_COPY[locale][policy.operation_code] ?? {
                title: policy.operation_code,
                description: policy.description,
              };
              const pending = busyCode === policy.operation_code;
              return (
                <label className="sk-checkbox-row" key={policy.operation_code}>
                  <input
                    type="checkbox"
                    checked={policy.is_enabled}
                    disabled={!canManage || busyCode !== null}
                    onChange={() => void toggle(policy)}
                  />
                  <span>
                    <strong>{localized.title}</strong>
                    <small className="sk-field-help">
                      {localized.description}
                      {!CURRENT_OPERATIONS.has(policy.operation_code) ? ` · ${text.future}` : ''}
                    </small>
                  </span>
                  <span className={`sk-badge ${policy.is_enabled ? 'sk-badge--ok' : 'sk-badge--danger'}`}>
                    {pending ? '…' : policy.is_enabled ? text.enabled : text.disabled}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
