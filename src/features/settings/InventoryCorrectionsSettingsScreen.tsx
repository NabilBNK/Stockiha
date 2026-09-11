import { useEffect, useState } from "react";

import { Banner, Spinner } from "../../shared/components";
import { useErrorText } from "../../shared/hooks/useErrorText";
import { useI18n } from "../../shared/i18n";
import {
  getInventoryCorrectionsSetting,
  updateInventoryCorrectionsSetting,
} from "../../shared/ipc/inventoryCorrectionsGateway";

export function InventoryCorrectionsSettingsScreen({
  sessionToken,
}: {
  sessionToken: string;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [canUpdate, setCanUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInventoryCorrectionsSetting(sessionToken)
      .then((setting) => {
        if (cancelled) return;
        setEnabled(setting.enabled);
        setCanUpdate(setting.canUpdate);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, errorText]);

  async function toggle() {
    if (enabled == null || !canUpdate || busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const setting = await updateInventoryCorrectionsSetting(
        sessionToken,
        !enabled,
      );
      setEnabled(setting.enabled);
      setCanUpdate(setting.canUpdate);
      setFeedback(t("correctionsPolicy.saved"));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sk-page sk-settings-page" data-testid="inventory-corrections-settings">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {feedback ? <Banner tone="success">{feedback}</Banner> : null}
      <div className="sk-settings-card">
        <div className="sk-settings-card__header">
          <div className="sk-settings-card__title-group">
            <h2 className="sk-settings-card__title">{t("correctionsPolicy.title")}</h2>
            <p className="sk-settings-card__desc">{t("correctionsPolicy.help")}</p>
          </div>
        </div>
        {enabled == null ? (
          <Spinner />
        ) : (
          <>
            {!canUpdate ? (
              <Banner tone="warning">{t("correctionsPolicy.readOnly")}</Banner>
            ) : null}
            <div style={{ maxWidth: '420px' }}>
              <label
                className="sk-toggle-card"
                data-checked={enabled ? 'true' : 'false'}
                data-disabled={!canUpdate || busy ? 'true' : 'false'}
              >
                <input
                  type="checkbox"
                  className="sk-sr-only"
                  checked={enabled}
                  disabled={!canUpdate || busy}
                  onChange={() => void toggle()}
                />
                <div>
                  <div className="sk-toggle-card__top">
                    <span className="sk-toggle-card__title">
                      {enabled
                        ? t("correctionsPolicy.enabled")
                        : t("correctionsPolicy.disabled")}
                    </span>
                    <span
                      className="sk-switch"
                      data-checked={enabled ? 'true' : 'false'}
                      aria-hidden="true"
                    >
                      <span className="sk-switch__thumb" />
                    </span>
                  </div>
                  <div className="sk-toggle-card__desc">
                    {t("correctionsPolicy.help")}
                  </div>
                </div>
                <div className="sk-toggle-card__bottom">
                  <span
                    className={`sk-toggle-card__badge ${
                      enabled
                        ? 'sk-toggle-card__badge--ok'
                        : 'sk-toggle-card__badge--muted'
                    }`}
                  >
                    <span className="sk-toggle-card__badge-dot" />
                    {enabled ? t("correctionsPolicy.enabled") : t("correctionsPolicy.disabled")}
                  </span>
                </div>
              </label>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
