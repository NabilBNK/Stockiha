import { useEffect, useState } from 'react';

import { Banner, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  getPurchaseWorkflowPolicy,
  updatePurchaseWorkflowPolicy,
  type PurchaseWorkflowMode,
  type PurchaseWorkflowPolicy,
} from '../../shared/ipc/purchaseWorkflowGateway';

interface Props {
  sessionToken: string;
  onPolicyChange?: (policy: PurchaseWorkflowPolicy) => void;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Purchasing workflow',
    help: 'Choose how new purchases are recorded. This setting does not rewrite or delete existing purchase orders.',
    directTitle: 'Direct purchase — default',
    directDescription: 'Use when goods are already physically received. The operator enters one purchase and confirms it once.',
    advancedTitle: 'Purchase order workflow',
    advancedDescription: 'Use when goods are ordered before they arrive: order, confirm, receive, invoice, then settle payment.',
    readOnly: 'Only the administrator can change this policy. The active workflow is shown read-only.',
    saved: 'Purchasing workflow updated.',
    active: 'Active',
  },
  fr: {
    title: 'Flux d’achat',
    help: 'Choisissez comment les nouveaux achats sont enregistrés. Ce réglage ne modifie ni ne supprime les bons de commande existants.',
    directTitle: 'Achat direct — par défaut',
    directDescription: 'À utiliser lorsque la marchandise est déjà physiquement reçue. L’opérateur saisit un seul achat et le confirme une seule fois.',
    advancedTitle: 'Flux bon de commande',
    advancedDescription: 'À utiliser lorsque la marchandise est commandée avant réception : commande, confirmation, réception, facture puis paiement.',
    readOnly: 'Seul l’administrateur peut modifier cette politique. Le flux actif est affiché en lecture seule.',
    saved: 'Flux d’achat mis à jour.',
    active: 'Actif',
  },
  ar: {
    title: 'مسار المشتريات',
    help: 'اختر طريقة تسجيل المشتريات الجديدة. تغيير هذا الإعداد لا يعدل ولا يحذف أوامر الشراء الموجودة.',
    directTitle: 'شراء مباشر — الافتراضي',
    directDescription: 'يستخدم عندما تكون البضاعة قد وصلت فعلياً. يدخل المستخدم عملية شراء واحدة ويؤكدها مرة واحدة.',
    advancedTitle: 'مسار أمر الشراء',
    advancedDescription: 'يستخدم عندما يتم طلب البضاعة قبل وصولها: أمر شراء، تأكيد، استلام، فاتورة، ثم تسديد.',
    readOnly: 'يمكن للمسؤول فقط تغيير هذه السياسة. المسار الحالي معروض للقراءة فقط.',
    saved: 'تم تحديث مسار المشتريات.',
    active: 'مفعل',
  },
};

export function PurchaseWorkflowSettingsScreen({ sessionToken, onPolicyChange }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [policy, setPolicy] = useState<PurchaseWorkflowPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPurchaseWorkflowPolicy(sessionToken)
      .then((result) => {
        if (cancelled) return;
        setPolicy(result);
        onPolicyChange?.(result);
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
  }, [sessionToken, errorText, onPolicyChange]);

  async function selectMode(mode: PurchaseWorkflowMode) {
    if (!policy?.can_manage || busy || policy.mode === mode) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await updatePurchaseWorkflowPolicy(sessionToken, mode);
      setPolicy(updated);
      onPolicyChange?.(updated);
      setFeedback(text.saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-card" aria-labelledby="purchase-workflow-settings-title">
      <h2 id="purchase-workflow-settings-title">{text.title}</h2>
      <p>{text.help}</p>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {feedback ? <Banner tone="success">{feedback}</Banner> : null}
      {loading ? <Spinner /> : null}
      {!loading && policy && !policy.can_manage ? (
        <Banner tone="warning">{text.readOnly}</Banner>
      ) : null}

      {!loading && policy ? (
        <div className="sk-stack">
          <label className="sk-checkbox-row">
            <input
              type="radio"
              name="purchase-workflow-mode"
              checked={policy.mode === 'DIRECT_PURCHASE'}
              disabled={!policy.can_manage || busy}
              onChange={() => void selectMode('DIRECT_PURCHASE')}
            />
            <span>
              <strong>{text.directTitle}</strong>
              <small className="sk-field-help">{text.directDescription}</small>
            </span>
            {policy.mode === 'DIRECT_PURCHASE' ? (
              <span className="sk-badge sk-badge--ok">{text.active}</span>
            ) : null}
          </label>

          <label className="sk-checkbox-row">
            <input
              type="radio"
              name="purchase-workflow-mode"
              checked={policy.mode === 'PURCHASE_ORDER'}
              disabled={!policy.can_manage || busy}
              onChange={() => void selectMode('PURCHASE_ORDER')}
            />
            <span>
              <strong>{text.advancedTitle}</strong>
              <small className="sk-field-help">{text.advancedDescription}</small>
            </span>
            {policy.mode === 'PURCHASE_ORDER' ? (
              <span className="sk-badge sk-badge--ok">{text.active}</span>
            ) : null}
          </label>
        </div>
      ) : null}
    </section>
  );
}
