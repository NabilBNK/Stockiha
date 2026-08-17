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
    <section className="sk-page" data-testid="inventory-corrections-settings">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {feedback ? <Banner tone="success">{feedback}</Banner> : null}
      <div className="sk-card">
        <h2>{t("correctionsPolicy.title")}</h2>
        <p>{t("correctionsPolicy.help")}</p>
        {enabled == null ? (
          <Spinner />
        ) : (
          <>
            {!canUpdate ? (
              <Banner tone="warning">{t("correctionsPolicy.readOnly")}</Banner>
            ) : null}
            <label className="sk-checkbox-row">
              <input
                type="checkbox"
                checked={enabled}
                disabled={!canUpdate || busy}
                onChange={() => void toggle()}
              />
              <span>
                <strong>
                  {enabled
                    ? t("correctionsPolicy.enabled")
                    : t("correctionsPolicy.disabled")}
                </strong>
              </span>
            </label>
          </>
        )}
      </div>
    </section>
  );
}
