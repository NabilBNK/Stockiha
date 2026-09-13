import { useEffect, useState } from 'react';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';
import type { PrintingSettingsDto, ReceiptTarget } from '../../shared/ipc/dto';
import { getPrintingSettings, savePrintingSettings } from '../../shared/ipc/gateway';
import { printSaleReceipt } from '../pos/printReceipt';

interface Props {
  sessionToken: string;
}

type BusyAction = 'save' | 'test' | null;

export function PrintingSettingsScreen({ sessionToken }: Props) {
  const { t } = useI18n();
  const errorText = useErrorText();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [receiptPrintingEnabled, setReceiptPrintingEnabled] = useState(true);
  const [receiptTarget, setReceiptTarget] = useState<ReceiptTarget>('THERMAL');
  const [thermalPrinterName, setThermalPrinterName] = useState('');
  const [thermalColumns, setThermalColumns] = useState<32 | 42 | 48>(48);
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPrintingSettings(sessionToken)
      .then((settings) => {
        if (!active) return;
        setReceiptPrintingEnabled(settings.receipt_printing_enabled);
        setReceiptTarget(settings.receipt_target);
        setThermalPrinterName(settings.thermal_printer_name ?? '');
        setThermalColumns(settings.thermal_columns);
        setShopName(settings.shop_name ?? '');
        setShopAddress(settings.shop_address ?? '');
        setShopPhone(settings.shop_phone ?? '');
        setReceiptFooter(settings.receipt_footer ?? '');
      })
      .catch((err) => {
        if (!active) return;
        setError(errorText(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionToken, errorText]);

  async function handleSave() {
    if (busy) return;
    setBusy('save');
    setError(null);
    setFeedback(null);

    try {
      const saved = await savePrintingSettings(sessionToken, {
        receipt_printing_enabled: receiptPrintingEnabled,
        receipt_target: receiptTarget,
        thermal_printer_name: thermalPrinterName.trim() || null,
        thermal_columns: thermalColumns,
        shop_name: shopName.trim() || null,
        shop_address: shopAddress.trim() || null,
        shop_phone: shopPhone.trim() || null,
        receipt_footer: receiptFooter.trim() || null,
      });
      setReceiptPrintingEnabled(saved.receipt_printing_enabled);
      setReceiptTarget(saved.receipt_target);
      setThermalPrinterName(saved.thermal_printer_name ?? '');
      setThermalColumns(saved.thermal_columns);
      setShopName(saved.shop_name ?? '');
      setShopAddress(saved.shop_address ?? '');
      setShopPhone(saved.shop_phone ?? '');
      setReceiptFooter(saved.receipt_footer ?? '');
      setFeedback(t('printing.saved'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleTestPrint() {
    if (busy) return;
    setBusy('test');
    setError(null);
    setFeedback(null);

    const currentSettings: PrintingSettingsDto = {
      receipt_printing_enabled: receiptPrintingEnabled,
      receipt_target: receiptTarget,
      thermal_printer_name: thermalPrinterName.trim() || null,
      thermal_columns: thermalColumns,
      shop_name: shopName.trim() || null,
      shop_address: shopAddress.trim() || null,
      shop_phone: shopPhone.trim() || null,
      receipt_footer: receiptFooter.trim() || null,
      updated_at: new Date().toISOString(),
    };

    try {
      const outcome = await printSaleReceipt(
        {
          documentNumber: 'TEST-0001',
          documentDate: new Date().toISOString().slice(0, 10),
          documentTime: new Date().toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          cashierName: 'Admin',
          paymentLabel: 'Especes',
          customerName: 'Client Comptoir',
          lines: [
            {
              name: 'Article Exemple 1',
              qty: 2,
              unitPrice: '500.00',
              lineTotal: '1000.00',
            },
            {
              name: 'Article Exemple 2',
              qty: 1,
              unitPrice: '250.00',
              lineTotal: '250.00',
            },
          ],
          total: '1250.00',
          currency: 'DZD',
        },
        currentSettings,
      );

      if (outcome.status === 'printed') {
        setFeedback(t('pos.printOk'));
      } else if (outcome.status === 'disabled') {
        setError(t('common.none'));
      } else {
        setError(outcome.reason);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <section className="sk-page" aria-labelledby="printing-settings-title">
      <div className="sk-card">
        <h2 id="printing-settings-title">{t('printing.title')}</h2>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {feedback ? <Banner tone="success">{feedback}</Banner> : null}

        <div className="sk-form">
          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="printing-enabled"
                checked={receiptPrintingEnabled}
                onChange={(e) => setReceiptPrintingEnabled(e.target.checked)}
              />
              <span>{t('printing.enabled')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label htmlFor="printing-target">{t('printing.target')}</label>
            <select
              id="printing-target"
              data-testid="printing-target"
              value={receiptTarget}
              onChange={(e) => setReceiptTarget(e.target.value as ReceiptTarget)}
            >
              <option value="THERMAL">{t('printing.targetThermal')}</option>
              <option value="A4">{t('printing.targetA4')}</option>
            </select>
          </div>

          {receiptTarget === 'THERMAL' ? (
            <>
              <div className="sk-field">
                <label htmlFor="printing-printer-name">{t('printing.printerName')}</label>
                <input
                  id="printing-printer-name"
                  type="text"
                  data-testid="printing-printer-name"
                  value={thermalPrinterName}
                  onChange={(e) => setThermalPrinterName(e.target.value)}
                />
                <small className="sk-field-help">{t('printing.printerNameHelp')}</small>
              </div>

              <div className="sk-field">
                <label htmlFor="printing-columns">{t('printing.columns')}</label>
                <select
                  id="printing-columns"
                  data-testid="printing-columns"
                  value={thermalColumns}
                  onChange={(e) => setThermalColumns(Number(e.target.value) as 32 | 42 | 48)}
                >
                  <option value={32}>32</option>
                  <option value={42}>42</option>
                  <option value={48}>48</option>
                </select>
              </div>
            </>
          ) : null}

          <div className="sk-field">
            <label htmlFor="printing-shop-name">{t('printing.shopName')}</label>
            <input
              id="printing-shop-name"
              type="text"
              data-testid="printing-shop-name"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="printing-shop-address">{t('printing.shopAddress')}</label>
            <input
              id="printing-shop-address"
              type="text"
              data-testid="printing-shop-address"
              value={shopAddress}
              onChange={(e) => setShopAddress(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="printing-shop-phone">{t('printing.shopPhone')}</label>
            <input
              id="printing-shop-phone"
              type="text"
              data-testid="printing-shop-phone"
              value={shopPhone}
              onChange={(e) => setShopPhone(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="printing-footer">{t('printing.footer')}</label>
            <input
              id="printing-footer"
              type="text"
              data-testid="printing-footer"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <Button
              type="button"
              data-testid="printing-save"
              onClick={() => void handleSave()}
              loading={busy === 'save'}
              disabled={busy !== null}
            >
              {t('common.save')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="printing-test"
              onClick={() => void handleTestPrint()}
              loading={busy === 'test'}
              disabled={busy !== null}
            >
              {t('printing.test')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
