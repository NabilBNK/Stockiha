import { useEffect, useState } from 'react';

import { Banner, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import {
  getPurchaseWorkflowPolicy,
  type PurchaseWorkflowPolicy,
} from '../../shared/ipc/purchaseWorkflowGateway';

interface Props {
  sessionToken: string;
  onPolicyChange?: (policy: PurchaseWorkflowPolicy) => void;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    title: 'Purchasing workflow',
    help: 'Direct Purchase is the only active purchasing workflow for the MVP. The advanced Purchase Order workflow is preserved for future work but cannot be selected yet.',
    directTitle: 'Direct Purchase — active',
    directDescription: 'Use when goods have physically arrived. The operator records the received goods once and confirms the purchase once.',
    futureTitle: 'Purchase Order workflow — future',
    futureDescription: 'Ordering goods before arrival remains future work and is not selectable in this release.',
    locked: 'This policy is intentionally locked to Direct Purchase for the MVP.',
  },
  fr: {
    title: 'Flux d’achat',
    help: 'L’Achat direct est le seul flux d’achat actif pour le MVP. Le flux Bon de commande est conservé pour une évolution future mais ne peut pas encore être sélectionné.',
    directTitle: 'Achat direct — actif',
    directDescription: 'À utiliser lorsque la marchandise est physiquement arrivée. L’opérateur enregistre la réception une fois et confirme l’achat une fois.',
    futureTitle: 'Flux bon de commande — futur',
    futureDescription: 'La commande avant réception reste un travail futur et n’est pas sélectionnable dans cette version.',
    locked: 'Cette politique est volontairement verrouillée sur l’Achat direct pour le MVP.',
  },
  ar: {
    title: 'مسار المشتريات',
    help: 'الشراء المباشر هو مسار الشراء الوحيد المفعّل في النسخة الأولية. مسار أمر الشراء محفوظ للعمل المستقبلي ولا يمكن اختياره حالياً.',
    directTitle: 'الشراء المباشر — مفعّل',
    directDescription: 'يستخدم عندما تكون البضاعة قد وصلت فعلياً. يسجل المستخدم البضاعة المستلمة مرة واحدة ويؤكد الشراء مرة واحدة.',
    futureTitle: 'مسار أمر الشراء — مستقبلي',
    futureDescription: 'الطلب قبل وصول البضاعة يبقى ميزة مستقبلية وغير قابلة للاختيار في هذه النسخة.',
    locked: 'تم قفل سياسة النسخة الأولية على الشراء المباشر عمداً.',
  },
};

export function PurchaseWorkflowSettingsScreen({ sessionToken, onPolicyChange }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [policy, setPolicy] = useState<PurchaseWorkflowPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="sk-card" aria-labelledby="purchase-workflow-settings-title">
      <h2 id="purchase-workflow-settings-title">{text.title}</h2>
      <p>{text.help}</p>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? <Spinner /> : null}
      {!loading && policy ? (
        <>
          <Banner tone="info">{text.locked}</Banner>
          <div className="sk-stack">
            <div className="sk-checkbox-row" aria-current={policy.mode === 'DIRECT_PURCHASE' ? 'true' : undefined}>
              <span>
                <strong>{text.directTitle}</strong>
                <small className="sk-field-help">{text.directDescription}</small>
              </span>
              <span className="sk-badge sk-badge--ok">DIRECT_PURCHASE</span>
            </div>

            <div className="sk-checkbox-row" aria-disabled="true">
              <span>
                <strong>{text.futureTitle}</strong>
                <small className="sk-field-help">{text.futureDescription}</small>
              </span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
