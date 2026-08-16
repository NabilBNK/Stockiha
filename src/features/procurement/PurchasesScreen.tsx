import { useCallback, useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n, type Locale } from '../../shared/i18n';
import type { ProcurementCapabilities } from '../../shared/ipc/dto';
import {
  getPurchaseWorkflowPolicy,
  type PurchaseWorkflowPolicy,
} from '../../shared/ipc/purchaseWorkflowGateway';
import PurchaseOrdersScreen from './PurchaseOrdersScreen';
import { PurchaseTransactionScreen } from './PurchaseTransactionScreen';

interface Props {
  sessionToken: string;
  capabilities: ProcurementCapabilities;
  openFiscalPeriodId: number | null;
}

const COPY: Record<Locale, Record<string, string>> = {
  en: {
    existingOrders: 'Existing purchase orders',
    existingOrdersHelp: 'Open historical or in-progress purchase orders without changing the default direct-purchase workflow.',
    openOrders: 'Open purchase orders',
    backDirect: 'Back to direct purchase',
  },
  fr: {
    existingOrders: 'Bons de commande existants',
    existingOrdersHelp: 'Ouvrir les bons historiques ou en cours sans changer le flux d’achat direct par défaut.',
    openOrders: 'Ouvrir les bons de commande',
    backDirect: 'Retour à l’achat direct',
  },
  ar: {
    existingOrders: 'أوامر الشراء الموجودة',
    existingOrdersHelp: 'فتح أوامر الشراء السابقة أو الجارية بدون تغيير مسار الشراء المباشر الافتراضي.',
    openOrders: 'فتح أوامر الشراء',
    backDirect: 'العودة إلى الشراء المباشر',
  },
};

export default function PurchasesScreen({ sessionToken, capabilities, openFiscalPeriodId }: Props) {
  const { locale } = useI18n();
  const text = COPY[locale];
  const errorText = useErrorText();
  const [policy, setPolicy] = useState<PurchaseWorkflowPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExistingOrders, setShowExistingOrders] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await getPurchaseWorkflowPolicy(sessionToken);
      setPolicy(current);
      if (current.mode === 'PURCHASE_ORDER') setShowExistingOrders(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, errorText]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  if (loading) return <Spinner />;
  if (error || !policy) {
    return (
      <section className="sk-page">
        <Banner tone="error">{error ?? 'Unable to load purchasing workflow.'}</Banner>
      </section>
    );
  }

  if (policy.mode === 'PURCHASE_ORDER' || showExistingOrders) {
    return (
      <section className="sk-stack">
        {policy.mode === 'DIRECT_PURCHASE' ? (
          <div className="sk-card">
            <Button variant="secondary" onClick={() => setShowExistingOrders(false)}>
              {text.backDirect}
            </Button>
          </div>
        ) : null}
        <PurchaseOrdersScreen
          sessionToken={sessionToken}
          capabilities={capabilities}
          openFiscalPeriodId={openFiscalPeriodId}
        />
      </section>
    );
  }

  return (
    <section className="sk-stack">
      <PurchaseTransactionScreen sessionToken={sessionToken} />
      <div className="sk-card">
        <h2>{text.existingOrders}</h2>
        <p>{text.existingOrdersHelp}</p>
        <Button variant="secondary" onClick={() => setShowExistingOrders(true)}>
          {text.openOrders}
        </Button>
      </div>
    </section>
  );
}
