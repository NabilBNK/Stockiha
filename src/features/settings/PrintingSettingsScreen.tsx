import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Banner, Button, Spinner } from '../../shared/components';
import { useErrorText } from '../../shared/hooks/useErrorText';
import { useI18n } from '../../shared/i18n';
import type { PrintingSettingsDto, PrintLanguage, ReceiptTarget } from '../../shared/ipc/dto';
import {
  clearCompanyLogo,
  getCompanyLogo,
  getPrintingSettings,
  savePrintingSettings,
  setCompanyLogo,
} from '../../shared/ipc/gateway';
import { printSaleReceipt } from '../pos/printReceipt';
import { printDocumentA4 } from '../../shared/documents/documentPrintService';
import { renderOfficialDocumentHtml, type OfficialDocumentIdentity, type PrintLocale } from '../../shared/documents/officialDocument';
import { buildSaleInvoiceModel } from '../../shared/documents/models/saleInvoiceModel';

interface Props {
  sessionToken: string;
}

type BusyAction = 'save' | 'test' | 'logo' | null;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

const LENGTH_LIMITS: Record<string, number> = {
  shop_legal_name: 120,
  shop_email: 120,
  shop_website: 120,
  tax_id_nif: 40,
  tax_id_nis: 40,
  trade_register_rc: 60,
  article_imposition_ai: 40,
  bank_account_rib: 60,
  a4_footer_note: 200,
};

export function PrintingSettingsScreen({ sessionToken }: Props) {
  const { t, locale } = useI18n();
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

  // WS-M-1: shop identity, logo and A4 print display toggles.
  const [shopLegalName, setShopLegalName] = useState('');
  const [shopEmail, setShopEmail] = useState('');
  const [shopWebsite, setShopWebsite] = useState('');
  const [taxNif, setTaxNif] = useState('');
  const [taxNis, setTaxNis] = useState('');
  const [tradeRc, setTradeRc] = useState('');
  const [articleAi, setArticleAi] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [a4FooterNote, setA4FooterNote] = useState('');
  const [printLanguage, setPrintLanguage] = useState<PrintLanguage>('FOLLOW_APP');
  const [showLogo, setShowLogo] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showWebsite, setShowWebsite] = useState(false);
  const [showRib, setShowRib] = useState(false);
  const [amountInWords, setAmountInWords] = useState(true);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getPrintingSettings(sessionToken), getCompanyLogo(sessionToken)])
      .then(([settings, logo]) => {
        if (!active) return;
        applySettings(settings);
        setLogoDataUrl(logo);
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

  function applySettings(settings: PrintingSettingsDto) {
    setReceiptPrintingEnabled(settings.receipt_printing_enabled);
    setReceiptTarget(settings.receipt_target);
    setThermalPrinterName(settings.thermal_printer_name ?? '');
    setThermalColumns(settings.thermal_columns);
    setShopName(settings.shop_name ?? '');
    setShopAddress(settings.shop_address ?? '');
    setShopPhone(settings.shop_phone ?? '');
    setReceiptFooter(settings.receipt_footer ?? '');
    setShopLegalName(settings.shop_legal_name ?? '');
    setShopEmail(settings.shop_email ?? '');
    setShopWebsite(settings.shop_website ?? '');
    setTaxNif(settings.tax_id_nif ?? '');
    setTaxNis(settings.tax_id_nis ?? '');
    setTradeRc(settings.trade_register_rc ?? '');
    setArticleAi(settings.article_imposition_ai ?? '');
    setBankRib(settings.bank_account_rib ?? '');
    setA4FooterNote(settings.a4_footer_note ?? '');
    setPrintLanguage(settings.print_language);
    setShowLogo(settings.show_logo);
    setShowEmail(settings.show_email);
    setShowWebsite(settings.show_website);
    setShowRib(settings.show_rib);
    setAmountInWords(settings.amount_in_words);
  }

  /** Returns the first validation message, or null when everything is valid. */
  function validate(): string | null {
    const trimmedEmail = shopEmail.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      return t('printing.invalidEmail');
    }

    const fields: Array<[string, string, string]> = [
      [t('printing.legalName'), 'shop_legal_name', shopLegalName],
      [t('printing.email'), 'shop_email', shopEmail],
      [t('printing.website'), 'shop_website', shopWebsite],
      [t('printing.nif'), 'tax_id_nif', taxNif],
      [t('printing.nis'), 'tax_id_nis', taxNis],
      [t('printing.rc'), 'trade_register_rc', tradeRc],
      [t('printing.ai'), 'article_imposition_ai', articleAi],
      [t('printing.rib'), 'bank_account_rib', bankRib],
      [t('printing.footerNote'), 'a4_footer_note', a4FooterNote],
    ];
    for (const [label, key, value] of fields) {
      const max = LENGTH_LIMITS[key];
      if (max && value.trim().length > max) {
        return t('printing.tooLong', { field: label, max });
      }
    }
    return null;
  }

  async function handleSave() {
    if (busy) return;
    setError(null);
    setFeedback(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy('save');
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
        shop_legal_name: shopLegalName.trim() || null,
        shop_email: shopEmail.trim() || null,
        shop_website: shopWebsite.trim() || null,
        tax_id_nif: taxNif.trim() || null,
        tax_id_nis: taxNis.trim() || null,
        trade_register_rc: tradeRc.trim() || null,
        article_imposition_ai: articleAi.trim() || null,
        bank_account_rib: bankRib.trim() || null,
        a4_footer_note: a4FooterNote.trim() || null,
        print_language: printLanguage,
        show_logo: showLogo,
        show_email: showEmail,
        show_website: showWebsite,
        show_rib: showRib,
        amount_in_words: amountInWords,
      });
      applySettings(saved);
      setFeedback(t('printing.saved'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function identityFromForm(): OfficialDocumentIdentity {
    const resolvedPrintLocale: PrintLocale =
      printLanguage === 'FOLLOW_APP' ? (locale as PrintLocale) : printLanguage;
    return {
      shopName: shopName.trim() || null,
      legalName: shopLegalName.trim() || null,
      address: shopAddress.trim() || null,
      phone: shopPhone.trim() || null,
      email: shopEmail.trim() || null,
      website: shopWebsite.trim() || null,
      nif: taxNif.trim() || null,
      nis: taxNis.trim() || null,
      rc: tradeRc.trim() || null,
      ai: articleAi.trim() || null,
      rib: bankRib.trim() || null,
      logoDataUrl,
      showEmail,
      showWebsite,
      showRib,
      showLogo,
      amountInWords,
      a4FooterNote: a4FooterNote.trim() || null,
      printLocale: resolvedPrintLocale,
    };
  }

  function handlePreview() {
    const identity = identityFromForm();
    const sample = buildSaleInvoiceModel(
      {
        title: 'FACTURE',
        documentNumber: 'APERCU-0001',
        documentDateText: new Date().toLocaleDateString(),
        statusText: 'POSTED',
        customerName: 'Client Comptoir',
        cashierName: 'Admin',
        paymentLabel: 'Espèces',
        lines: [
          { designation: 'Article A', quantity: '2', unitPrice: '500,00', lineTotal: '1 000,00' },
          { designation: 'Article B', quantity: '1', unitPrice: '350,60', lineTotal: '350,60' },
        ],
        subtotal: '1 350,60',
        discount: '105,60',
        total: '1 245,00',
        totalNumeric: '1245.00',
      },
      identity.printLocale,
    );
    printDocumentA4(renderOfficialDocumentHtml(sample, identity));
  }

  async function handleChooseLogo() {
    if (busy) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setBusy('logo');
    setError(null);
    setFeedback(null);
    try {
      await setCompanyLogo(sessionToken, selected);
      const logo = await getCompanyLogo(sessionToken);
      setLogoDataUrl(logo);
      setFeedback(t('printing.saved'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveLogo() {
    if (busy) return;
    setBusy('logo');
    setError(null);
    setFeedback(null);
    try {
      await clearCompanyLogo(sessionToken);
      setLogoDataUrl(null);
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
      shop_legal_name: shopLegalName.trim() || null,
      shop_email: shopEmail.trim() || null,
      shop_website: shopWebsite.trim() || null,
      tax_id_nif: taxNif.trim() || null,
      tax_id_nis: taxNis.trim() || null,
      trade_register_rc: tradeRc.trim() || null,
      article_imposition_ai: articleAi.trim() || null,
      bank_account_rib: bankRib.trim() || null,
      logo_file_name: null,
      logo_updated_at: null,
      print_language: printLanguage,
      show_logo: showLogo,
      show_email: showEmail,
      show_website: showWebsite,
      show_rib: showRib,
      amount_in_words: amountInWords,
      a4_footer_note: a4FooterNote.trim() || null,
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
        identityFromForm(),
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
            <small className="sk-field-help">{t('printing.identityFieldsHint')}</small>
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

      <div className="sk-card">
        <h3>{t('printing.identityTitle')}</h3>

        <div className="sk-form">
          <div className="sk-field">
            <label>{t('printing.logo')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  width: 120,
                  height: 80,
                  border: '1px dashed #888',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {logoDataUrl ? (
                  <img
                    src={logoDataUrl}
                    alt={t('printing.logo')}
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                ) : (
                  <span>{t('printing.logoNone')}</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="logo-choose"
                  onClick={() => void handleChooseLogo()}
                  loading={busy === 'logo'}
                  disabled={busy !== null}
                >
                  {t('printing.logoChoose')}
                </Button>
                {logoDataUrl ? (
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid="logo-remove"
                    onClick={() => void handleRemoveLogo()}
                    loading={busy === 'logo'}
                    disabled={busy !== null}
                  >
                    {t('printing.logoRemove')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sk-field">
            <label htmlFor="shop-legal-name">{t('printing.legalName')}</label>
            <input
              id="shop-legal-name"
              type="text"
              data-testid="shop-legal-name"
              value={shopLegalName}
              onChange={(e) => setShopLegalName(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="shop-email">{t('printing.email')}</label>
            <input
              id="shop-email"
              type="text"
              data-testid="shop-email"
              value={shopEmail}
              onChange={(e) => setShopEmail(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="shop-website">{t('printing.website')}</label>
            <input
              id="shop-website"
              type="text"
              data-testid="shop-website"
              value={shopWebsite}
              onChange={(e) => setShopWebsite(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="tax-nif">{t('printing.nif')}</label>
            <input
              id="tax-nif"
              type="text"
              data-testid="tax-nif"
              value={taxNif}
              onChange={(e) => setTaxNif(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="tax-nis">{t('printing.nis')}</label>
            <input
              id="tax-nis"
              type="text"
              data-testid="tax-nis"
              value={taxNis}
              onChange={(e) => setTaxNis(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="trade-rc">{t('printing.rc')}</label>
            <input
              id="trade-rc"
              type="text"
              data-testid="trade-rc"
              value={tradeRc}
              onChange={(e) => setTradeRc(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="article-ai">{t('printing.ai')}</label>
            <input
              id="article-ai"
              type="text"
              data-testid="article-ai"
              value={articleAi}
              onChange={(e) => setArticleAi(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="bank-rib">{t('printing.rib')}</label>
            <input
              id="bank-rib"
              type="text"
              data-testid="bank-rib"
              value={bankRib}
              onChange={(e) => setBankRib(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label htmlFor="a4-footer-note">{t('printing.footerNote')}</label>
            <input
              id="a4-footer-note"
              type="text"
              data-testid="a4-footer-note"
              value={a4FooterNote}
              onChange={(e) => setA4FooterNote(e.target.value)}
            />
          </div>

          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="show-logo"
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
              />
              <span>{t('printing.showLogo')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="show-email"
                checked={showEmail}
                onChange={(e) => setShowEmail(e.target.checked)}
              />
              <span>{t('printing.showEmail')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="show-website"
                checked={showWebsite}
                onChange={(e) => setShowWebsite(e.target.checked)}
              />
              <span>{t('printing.showWebsite')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="show-rib"
                checked={showRib}
                onChange={(e) => setShowRib(e.target.checked)}
              />
              <span>{t('printing.showRib')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label className="sk-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                data-testid="amount-in-words"
                checked={amountInWords}
                onChange={(e) => setAmountInWords(e.target.checked)}
              />
              <span>{t('printing.amountInWords')}</span>
            </label>
          </div>

          <div className="sk-field">
            <label htmlFor="print-language">{t('printing.printLanguage')}</label>
            <select
              id="print-language"
              data-testid="print-language"
              value={printLanguage}
              onChange={(e) => setPrintLanguage(e.target.value as PrintLanguage)}
            >
              <option value="FOLLOW_APP">{t('printing.printLanguageFollowApp')}</option>
              <option value="fr">{t('printing.printLanguageFr')}</option>
              <option value="ar">{t('printing.printLanguageAr')}</option>
              <option value="en">{t('printing.printLanguageEn')}</option>
            </select>
          </div>

          <div className="sk-field">
            <Button type="button" variant="secondary" data-testid="print-preview" onClick={handlePreview}>
              {t('printing.preview')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
