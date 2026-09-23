/**
 * WS-M-2 (spec §5.4): loads the shop's printing identity once, resolves
 * `print_language` (`FOLLOW_APP` -> the current app locale) into a concrete
 * `PrintLocale`, and never throws -- a settings/logo read failure still
 * lets printing continue with every identity field `null`.
 */
import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '../i18n';
import { getCompanyLogo, getPrintingSettings } from '../ipc/gateway';
import type { OfficialDocumentIdentity, PrintLocale } from './officialDocument';

interface CachedIdentity {
  sessionToken: string;
  identity: OfficialDocumentIdentity;
}

let moduleCache: CachedIdentity | null = null;

function emptyIdentity(printLocale: PrintLocale): OfficialDocumentIdentity {
  return {
    shopName: null,
    legalName: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    nif: null,
    nis: null,
    rc: null,
    ai: null,
    rib: null,
    logoDataUrl: null,
    showEmail: false,
    showWebsite: false,
    showRib: false,
    showLogo: false,
    amountInWords: false,
    a4FooterNote: null,
    printLocale,
  };
}

export function useOfficialDocumentContext(sessionToken: string): {
  identity: OfficialDocumentIdentity | null;
  loading: boolean;
  reload: () => void;
} {
  const { locale: appLocale } = useI18n();
  const [identity, setIdentity] = useState<OfficialDocumentIdentity | null>(
    moduleCache && moduleCache.sessionToken === sessionToken ? moduleCache.identity : null,
  );
  const [loading, setLoading] = useState(identity === null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, logoDataUrl] = await Promise.all([
        getPrintingSettings(sessionToken),
        getCompanyLogo(sessionToken).catch(() => null),
      ]);

      const printLocale: PrintLocale =
        settings.print_language === 'FOLLOW_APP'
          ? (appLocale as PrintLocale)
          : settings.print_language;

      const resolved: OfficialDocumentIdentity = {
        shopName: settings.shop_name,
        legalName: settings.shop_legal_name,
        address: settings.shop_address,
        phone: settings.shop_phone,
        email: settings.shop_email,
        website: settings.shop_website,
        nif: settings.tax_id_nif,
        nis: settings.tax_id_nis,
        rc: settings.trade_register_rc,
        ai: settings.article_imposition_ai,
        rib: settings.bank_account_rib,
        logoDataUrl,
        showEmail: settings.show_email,
        showWebsite: settings.show_website,
        showRib: settings.show_rib,
        showLogo: settings.show_logo,
        amountInWords: settings.amount_in_words,
        a4FooterNote: settings.a4_footer_note,
        printLocale,
      };

      moduleCache = { sessionToken, identity: resolved };
      setIdentity(resolved);
    } catch {
      const fallback = emptyIdentity(appLocale as PrintLocale);
      moduleCache = null;
      setIdentity(fallback);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, appLocale]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await load();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [sessionToken, reloadToken, appLocale, load]);

  const reload = useCallback(() => {
    moduleCache = null;
    setReloadToken((token) => token + 1);
  }, []);

  return { identity, loading, reload };
}
