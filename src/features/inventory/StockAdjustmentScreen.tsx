import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { Banner, Button, ItemSearchModal, Spinner, TextField } from "../../shared/components";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { codeForError, useErrorText } from "../../shared/hooks/useErrorText";
import { useSession } from "../../shared/session/SessionContext";
import { useAppData } from "../../app/AppDataContext";
import * as ipc from "../../shared/ipc/gateway";
import { getInventoryCorrectionsSetting } from "../../shared/ipc/inventoryCorrectionsGateway";
import { ZeroQuantityWarning } from "./ZeroQuantityWarning";
import type {
  ProductListItem,
  StockAdjustmentReasonCode,
  StockAdjustmentResult,
  StockAdjustmentUnit,
} from "../../shared/ipc/dto";
import {
  formatExactDecimal,
  isExactDecimalPositive,
  isExactDecimalZero,
  localIsoDate,
} from "./exactDecimal";

type Direction = "increase" | "decrease";

const REASONS: { code: StockAdjustmentReasonCode; label: MessageKey }[] = [
  { code: "DAMAGE", label: "adjustment.reason.damage" },
  { code: "SHRINKAGE", label: "adjustment.reason.shrinkage" },
  { code: "EXPIRED", label: "adjustment.reason.expired" },
  { code: "FOUND_STOCK", label: "adjustment.reason.foundStock" },
  { code: "RECORDING_ERROR", label: "adjustment.reason.recordingError" },
  { code: "OTHER", label: "adjustment.reason.other" },
];
/**
 * Renders every identifier an operator needs to confirm they are adjusting the
 * right item, barcode first.
 *
 * The narrow inventory table column deliberately shows barcode *instead of* SKU
 * to save width. These adjustment surfaces are the confirm-before-posting and
 * posted-result cards, where hiding the authoritative SKU behind a scanning
 * convenience makes the item harder to verify, not easier — so both are shown
 * when both exist.
 */
function itemIdentifiers(item: { primary_barcode?: string | null; sku: string }): string {
  const barcode = item.primary_barcode;
  if (barcode && barcode !== item.sku) return `${barcode} · ${item.sku}`;
  return barcode ?? item.sku;
}

const EXACT_NATURAL_QUANTITY = /^[1-9]\d*$/;
export function isPositiveExactQuantity(value: string): boolean {
  return EXACT_NATURAL_QUANTITY.test(value);
}
export function signedQuantityDelta(
  direction: Direction,
  positiveQuantity: string,
): string {
  return direction === "decrease" ? `-${positiveQuantity}` : positiveQuantity;
}
export function isValidCorrectionDate(
  value: string,
  startsOn: string,
  endsOn: string,
): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= startsOn && value <= endsOn
  );
}
function initialDate(startsOn: string, endsOn: string): string {
  const today = localIsoDate();
  return isValidCorrectionDate(today, startsOn, endsOn) ? today : "";
}

export function StockAdjustmentScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const { warehouses, selectedWarehouseId, selectWarehouse, openFiscalPeriod } =
    useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? "";
  const [variants, setVariants] = useState<ProductListItem[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [units, setUnits] = useState<StockAdjustmentUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [direction, setDirection] = useState<Direction>("increase");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] =
    useState<StockAdjustmentReasonCode>("FOUND_STOCK");
  const [note, setNote] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StockAdjustmentResult | null>(null);
  const [resultVariant, setResultVariant] = useState<ProductListItem | null>(
    null,
  );
  const [policyEnabled, setPolicyEnabled] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<{
    tone: "success" | "error" | "warning";
    text: string;
  } | null>(null);
  const invalidateRequest = useCallback(() => setRequestId(null), []);

  useEffect(() => {
    if (!token) {
      setPolicyEnabled(null);
      return;
    }
    let active = true;
    void getInventoryCorrectionsSetting(token)
      .then((setting) => {
        if (active) setPolicyEnabled(setting.enabled);
      })
      .catch(() => {
        if (active) setPolicyEnabled(null);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loadVariants = useCallback(async () => {
    if (!token || selectedWarehouseId == null) return;
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const items = await ipc.listProducts(token, selectedWarehouseId);
      setVariants(items.filter((item) => item.is_active));
    } catch (reason) {
      setVariants([]);
      setVariantsError(errorText(reason));
    } finally {
      setVariantsLoading(false);
    }
  }, [errorText, selectedWarehouseId, token]);
  const loadUnits = useCallback(async () => {
    if (!token || variantId == null) return;
    setUnitsLoading(true);
    setUnitsError(null);
    try {
      const items = await ipc.listStockAdjustmentUnits(token, variantId);
      setUnits(items);
      setUnitId(
        items.find((item) => item.is_base)?.unit_id ??
          items[0]?.unit_id ??
          null,
      );
    } catch (reason) {
      setUnits([]);
      setUnitId(null);
      setUnitsError(errorText(reason));
    } finally {
      setUnitsLoading(false);
    }
  }, [errorText, token, variantId]);
  useEffect(() => {
    setVariantId(null);
    setUnits([]);
    setUnitId(null);
    void loadVariants();
  }, [loadVariants]);
  useEffect(() => {
    if (variantId == null) {
      setUnits([]);
      setUnitId(null);
      setUnitsError(null);
      return;
    }
    void loadUnits();
  }, [loadUnits, variantId]);
  useEffect(() => {
    setDocumentDate(
      openFiscalPeriod
        ? initialDate(openFiscalPeriod.starts_on, openFiscalPeriod.ends_on)
        : "",
    );
  }, [
    openFiscalPeriod?.id,
    openFiscalPeriod?.starts_on,
    openFiscalPeriod?.ends_on,
  ]);
  const selectedVariant =
    variants.find((item) => item.variant_id === variantId) ?? null;
  const isZeroQty =
    selectedVariant != null &&
    isExactDecimalZero(selectedVariant.quantity_on_hand);
  const hasUsableWAC =
    selectedVariant != null &&
    isExactDecimalPositive(selectedVariant.last_known_wac);
  const quantityValid = isPositiveExactQuantity(quantity);
  const noteValid = reasonCode !== "OTHER" || note.trim() !== "";
  const dateValid =
    openFiscalPeriod != null &&
    isValidCorrectionDate(
      documentDate,
      openFiscalPeriod.starts_on,
      openFiscalPeriod.ends_on,
    );
  const inputsValid =
    selectedWarehouseId != null &&
    variantId != null &&
    unitId != null &&
    quantityValid &&
    noteValid &&
    dateValid &&
    policyEnabled !== false;
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      submitting ||
      !inputsValid ||
      !token ||
      selectedWarehouseId == null ||
      variantId == null ||
      unitId == null ||
      openFiscalPeriod == null
    )
      return;
    const rid = requestId ?? ipc.newRequestId();
    setRequestId(rid);
    setSubmitting(true);
    setBanner(null);
    setResult(null);
    try {
      const posted = await ipc.confirmStockAdjustment(token, {
        requestId: rid,
        warehouseId: selectedWarehouseId,
        variantId,
        unitId,
        quantityDelta: signedQuantityDelta(direction, quantity),
        reasonCode,
        note: note.trim() || undefined,
        fiscalPeriodId: openFiscalPeriod.id,
        documentDate,
      });
      setResult(posted);
      setResultVariant(selectedVariant);
      setBanner({
        tone: "success",
        text: t("adjustment.posted", { number: posted.document_number }),
      });
      setRequestId(null);
      setQuantity("");
      setNote("");
      void loadVariants();
    } catch (reason) {
      const code = codeForError(reason);
      if (code === "UNKNOWN_ERROR") {
        setBanner({ tone: "warning", text: t("adjustment.retryPrompt") });
      } else if (code === "UNSAFE_ZERO_STOCK_VALUATION") {
        setBanner({
          tone: "error",
          text: t("errors.unsafeZeroStockValuation"),
        });
      } else {
        setBanner({ tone: "error", text: errorText(reason) });
      }
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="sk-page">
      <div className="sk-page__header">
        <div>
          <h1>{t("adjustment.title")}</h1>
          <p>{t("adjustment.purpose")}</p>
        </div>
      </div>
      <Banner tone="info">{t("adjustment.notPurchase")}</Banner>
      {policyEnabled === false ? (
        <Banner tone="warning" testId="corrections-disabled-banner">
          {t("adjustment.disabledPolicy")}
        </Banner>
      ) : null}
      {openFiscalPeriod == null ? (
        <Banner tone="warning">{t("errors.preconditionFailed")}</Banner>
      ) : null}
      <form
        className="sk-card sk-form"
        onSubmit={onSubmit}
        aria-label={t("adjustment.title")}
      >
        {banner ? (
          <Banner tone={banner.tone} testId="adjustment-banner">
            {banner.text}
          </Banner>
        ) : null}
        <div className="sk-form-grid">
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="adjustment-warehouse">
              {t("adjustment.warehouse")}
            </label>
            <select
              id="adjustment-warehouse"
              className="sk-field__input"
              value={selectedWarehouseId ?? ""}
              onChange={(event) => {
                selectWarehouse(Number(event.target.value));
                invalidateRequest();
              }}
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label={t("adjustment.date")}
            type="date"
            value={documentDate}
            min={openFiscalPeriod?.starts_on}
            max={openFiscalPeriod?.ends_on}
            onChange={(event) => {
              setDocumentDate(event.target.value);
              invalidateRequest();
            }}
            error={
              documentDate !== "" && !dateValid
                ? t("adjustment.dateError")
                : undefined
            }
            required
          />
        </div>
        <div className="sk-field">
          <label className="sk-field__label" htmlFor="adjustment-variant">
            {t("adjustment.variant")}
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
            <button
              type="button"
              className="sk-btn sk-btn--secondary"
              onClick={() => setSearchModalOpen(true)}
              data-testid="adjustment-open-search-modal"
              style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            >
              🔍 {t("adjustment.openSearchModal")}
            </button>
            <select
              id="adjustment-variant"
              className="sk-field__input"
              style={{ flex: "1 1 240px" }}
              value={variantId ?? ""}
              onChange={(event) => {
                setVariantId(
                  event.target.value ? Number(event.target.value) : null,
                );
                setUnitId(null);
                invalidateRequest();
              }}
              data-testid="adjustment-variant-select"
            >
              <option value="">{t("adjustment.variantPlaceholder")}</option>
              {variants.map((variant) => (
                <option key={variant.variant_id} value={variant.variant_id}>
                  {variant.sku} — {variant.name}
                </option>
              ))}
            </select>
          </div>
          {variantsLoading ? (
            <Spinner />
          ) : variantsError ? (
            <Banner tone="error">
              {variantsError}
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadVariants()}
              >
                {t("common.retry")}
              </Button>
            </Banner>
          ) : variants.length === 0 ? (
            <p className="sk-field-help">{t("adjustment.variantEmpty")}</p>
          ) : null}
        </div>
        {selectedVariant ? (
          <div className="sk-card sk-adjustment-context">
            <strong>{t("adjustment.currentContext")}</strong>
            <span>
              {itemIdentifiers(selectedVariant)} — {selectedVariant.name}
            </span>
            <span>
              {t("adjustment.currentQuantity")}:{" "}
              {formatExactDecimal(selectedVariant.quantity_on_hand)}
            </span>
            <span>
              {t("adjustment.currentWac")}:{" "}
              {formatExactDecimal(selectedVariant.last_known_wac)} DZD
            </span>
          </div>
        ) : null}
        {selectedVariant && direction === "increase" && isZeroQty ? (
          <ZeroQuantityWarning
            variantName={selectedVariant.name}
            hasUsableWAC={hasUsableWAC}
          />
        ) : null}
        <fieldset className="sk-choice-group">
          <legend className="sk-field__label">
            {t("adjustment.direction")}
          </legend>
          <label>
            <input
              type="radio"
              name="adjustment-direction"
              checked={direction === "increase"}
              onChange={() => {
                setDirection("increase");
                invalidateRequest();
              }}
            />
            {t("adjustment.increase")}
          </label>
          <label>
            <input
              type="radio"
              name="adjustment-direction"
              checked={direction === "decrease"}
              onChange={() => {
                setDirection("decrease");
                invalidateRequest();
              }}
            />
            {t("adjustment.decrease")}
          </label>
        </fieldset>
        <div className="sk-form-grid">
          <TextField
            label={t("adjustment.quantity")}
            value={quantity}
            inputMode="decimal"
            onChange={(event) => {
              setQuantity(event.target.value);
              invalidateRequest();
            }}
            error={
              quantity !== "" && !quantityValid
                ? t("adjustment.quantityError")
                : undefined
            }
            required
          />
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="adjustment-unit">
              {t("adjustment.unit")}
            </label>
            {unitsLoading ? (
              <Spinner />
            ) : unitsError ? (
              <Banner tone="error">
                {unitsError}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void loadUnits()}
                >
                  {t("common.retry")}
                </Button>
              </Banner>
            ) : (
              <select
                id="adjustment-unit"
                className="sk-field__input"
                value={unitId ?? ""}
                disabled={!selectedVariant}
                onChange={(event) => {
                  setUnitId(Number(event.target.value));
                  invalidateRequest();
                }}
              >
                <option value="">{t("adjustment.unitPlaceholder")}</option>
                {units.map((unit) => (
                  <option key={unit.unit_id} value={unit.unit_id}>
                    {unit.unit_code} — {unit.unit_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="sk-form-grid">
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="adjustment-reason">
              {t("adjustment.reason")}
            </label>
            <select
              id="adjustment-reason"
              className="sk-field__input"
              value={reasonCode}
              onChange={(event) => {
                setReasonCode(event.target.value as StockAdjustmentReasonCode);
                invalidateRequest();
              }}
            >
              {REASONS.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {t(reason.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="sk-field">
            <label className="sk-field__label" htmlFor="adjustment-note">
              {t("adjustment.note")}
            </label>
            <textarea
              id="adjustment-note"
              className="sk-field__input sk-field__textarea"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                invalidateRequest();
              }}
              aria-invalid={!noteValid}
              required={reasonCode === "OTHER"}
            />
            {!noteValid ? (
              <p className="sk-field__error" role="alert">
                {t("adjustment.otherNoteRequired")}
              </p>
            ) : null}
          </div>
        </div>
        <Button type="submit" loading={submitting} disabled={!inputsValid}>
          {t("adjustment.submit")}
        </Button>
      </form>
      {result ? (
        <section
          className="sk-card sk-feedback-pop"
          aria-labelledby="adjustment-result-title"
          data-testid="adjustment-result"
        >
          <h2 id="adjustment-result-title">{t("adjustment.resultTitle")}</h2>
          {resultVariant ? (
            <p>
              {itemIdentifiers(resultVariant)} — {resultVariant.name}
            </p>
          ) : null}
          <div className="sk-table-wrap sk-table-wrap--flat">
            <table className="sk-table">
              <tbody>
                <tr>
                  <th>{t("adjustment.documentNumber")}</th>
                  <td>{result.document_number}</td>
                  <th>{t("adjustment.journalNumber")}</th>
                  <td>{result.journal_document_number ?? t("common.none")}</td>
                </tr>
                <tr>
                  <th>{t("adjustment.quantityDelta")}</th>
                  <td className="sk-num">
                    {formatExactDecimal(result.quantity_delta)}
                  </td>
                  <th>{t("adjustment.valueDelta")}</th>
                  <td className="sk-num">
                    {formatExactDecimal(result.inventory_value_delta)} DZD
                  </td>
                </tr>
                <tr>
                  <th>{t("adjustment.resultingQuantity")}</th>
                  <td className="sk-num">
                    {formatExactDecimal(result.resulting_quantity_on_hand)}
                  </td>
                  <th>{t("adjustment.resultingValue")}</th>
                  <td className="sk-num">
                    {formatExactDecimal(result.resulting_total_value)} DZD
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <ItemSearchModal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelect={(item) => {
          setVariantId(item.variant_id);
          setUnitId(null);
          invalidateRequest();
        }}
        items={variants}
        loading={variantsLoading}
        error={variantsError}
        selectedVariantId={variantId}
      />
    </section>
  );
}
