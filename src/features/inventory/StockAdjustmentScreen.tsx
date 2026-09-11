import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Banner, Button, Spinner, TextField } from "../../shared/components";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { codeForError, useErrorText } from "../../shared/hooks/useErrorText";
import { useSession } from "../../shared/session/SessionContext";
import { useAppData } from "../../app/AppDataContext";
import * as ipc from "../../shared/ipc/gateway";
import { getInventoryCorrectionsSetting } from "../../shared/ipc/inventoryCorrectionsGateway";
import { ZeroQuantityWarning } from "./ZeroQuantityWarning";
import type {
  StockAdjustmentReasonCode,
  StockAdjustmentResult,
  StockAdjustmentUnit,
} from "../../shared/ipc/dto";
import { PurchaseItemPicker, type GenericPickerItem } from "../procurement/PurchaseItemPicker";
import { PROCUREMENT_COPY } from "../procurement/procurementCopy";
import "../procurement/procurement.css";
import {
  formatExactDecimal,
  isExactDecimalPositive,
  isExactDecimalZero,
  isQuantityValidForUnit,
  localIsoDate,
} from "./exactDecimal";
import { useUnitFractionRules } from "./useUnitFractionRules";

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

/**
 * WS-D-14 Part 1 — format check ONLY: a positive exact decimal, any number of
 * fractional digits. Whether a FRACTION is actually allowed is a separate
 * question that depends on the selected unit's `allows_fractions` flag (see
 * `quantityUnitError` below, driven by `isQuantityValidForUnit`) — never on
 * this function, which used to hardcode whole-numbers-only for every unit via
 * `EXACT_NATURAL_QUANTITY = /^[1-9]\d*$/` and rejected "2.5" even for a
 * decimal-capable unit like Kg before the unit-aware check ever ran. Reuses
 * `isExactDecimalPositive` rather than a second decimal regex (ws-d-skill.md
 * section 7: one decimal module). Zero, negatives, blank and malformed input
 * are still rejected — a correction of zero is meaningless regardless of unit.
 */
export function isPositiveExactQuantity(value: string): boolean {
  return isExactDecimalPositive(value);
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
  const { t, locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const { user } = useSession();
  const { warehouses, selectedWarehouseId, selectWarehouse, openFiscalPeriod } =
    useAppData();
  const errorText = useErrorText();
  const token = user?.token ?? "";
  const [variants, setVariants] = useState<GenericPickerItem[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);

  // Fast item entry / picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const quantityInputRef = useRef<HTMLInputElement | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  const [units, setUnits] = useState<StockAdjustmentUnit[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  // WS-D-13 Phase A. The quantity is typed in the SELECTED unit, so the flag
  // consulted is that unit's own, not the variant's base.
  const { allowsFractionsById } = useUnitFractionRules(token);
  const [direction, setDirection] = useState<Direction>("increase");
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] =
    useState<StockAdjustmentReasonCode>("FOUND_STOCK");
  const [note, setNote] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StockAdjustmentResult | null>(null);
  const [resultVariant, setResultVariant] = useState<GenericPickerItem | null>(
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
      const [productsRes, optionsRes] = await Promise.allSettled([
        ipc.listProducts(token, selectedWarehouseId),
        ipc.listPurchaseProductOptions(token),
      ]);
      const products = productsRes.status === "fulfilled" ? productsRes.value : [];
      const options = optionsRes.status === "fulfilled" ? optionsRes.value : [];
      const optionsMap = new Map(options.map((o) => [o.variant_id, o]));
      const enriched: GenericPickerItem[] = products
        .filter((item) => item.is_active)
        .map((item) => {
          const opt = optionsMap.get(item.variant_id);
          return {
            ...item,
            product_name: opt?.product_name ?? item.product_name ?? item.name,
            variant_name: opt?.variant_name ?? (item as { variant_name?: string | null }).variant_name ?? null,
            brand: opt?.brand ?? null,
            default_unit_id: opt?.default_unit_id,
            default_unit_code: opt?.default_unit_code,
            default_unit_name: opt?.default_unit_name,
            alternate_units: opt?.alternate_units,
            attributes: opt?.attributes ?? item.attributes,
            default_unit_cost: opt?.default_unit_cost,
            last_purchase_cost: opt?.last_purchase_cost,
          };
        });
      setVariants(enriched);
    } catch (reason) {
      setVariants([]);
      setVariantsError(errorText(reason));
    } finally {
      setVariantsLoading(false);
    }
  }, [errorText, selectedWarehouseId, token]);

  const handleSelectItem = useCallback((item: GenericPickerItem) => {
    setVariantId(item.variant_id);
    setUnitId(null);
    invalidateRequest();
    setPickerOpen(false);
    setBarcodeError(null);
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }
    focusTimerRef.current = setTimeout(() => {
      if (typeof document !== "undefined") {
        quantityInputRef.current?.focus();
        (document.querySelector('input[data-testid="adjustment-quantity"]') as HTMLInputElement | null)?.focus();
      }
    }, 50);
  }, [invalidateRequest]);

  const handleBarcodeSubmit = useCallback(() => {
    const code = barcodeInput.trim();
    if (!code) return;
    const match = variants.find(
      (item) => item.is_active && (item.primary_barcode === code || item.sku === code),
    );
    if (!match) {
      setBarcodeError(text.barcodeNotFound);
      return;
    }
    handleSelectItem(match);
    setBarcodeError(null);
    setBarcodeInput("");
  }, [barcodeInput, variants, text.barcodeNotFound, handleSelectItem]);
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
    isExactDecimalZero(selectedVariant.quantity_on_hand ?? "0");
  const hasUsableWAC =
    selectedVariant != null &&
    isExactDecimalPositive(selectedVariant.last_known_wac ?? "0");
  const quantityValid = isPositiveExactQuantity(quantity);
  /**
   * WS-D-13 Phase A. The quantity is entered in the SELECTED unit, which may
   * be an alternate (a Box) rather than the base, so the flag consulted is
   * that unit's own. `StockAdjustmentUnit` carries no flag, so it is joined
   * to `listUnitsV2` by unit_id — frontend only, no backend change.
   */
  const selectedUnit = units.find((u) => u.unit_id === unitId) ?? null;
  const selectedUnitAllowsFractions = allowsFractionsById(unitId);
  const quantityUnitError =
    quantity !== "" &&
    quantityValid &&
    selectedUnit != null &&
    selectedUnitAllowsFractions === false &&
    !isQuantityValidForUnit(quantity, false)
      ? t("units.wholeOnlyQuantity", { unit: selectedUnit.unit_code })
      : null;
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
    quantityUnitError == null &&
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
          <div className="pr-entry-toolbar">
            <div className="pr-scanner-input-group">
              <input
                ref={barcodeInputRef}
                id="adjustment-barcode-input"
                type="text"
                className="pr-scanner-input"
                placeholder={text.scanBarcodePlaceholder}
                aria-label={text.scanBarcodePlaceholder}
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  setBarcodeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleBarcodeSubmit();
                  }
                }}
                data-testid="adjustment-barcode-input"
              />
              {barcodeError && (
                <div
                  className="sk-field-error"
                  data-testid="adjustment-barcode-error"
                  style={{ marginTop: 4 }}
                >
                  {barcodeError}
                </div>
              )}
            </div>

            <button
              type="button"
              className="sk-button sk-button--secondary pr-scanner-btn"
              onClick={() => {
                void loadVariants();
                setPickerOpen(true);
              }}
              data-testid="adjustment-open-picker-btn"
            >
              <span aria-hidden style={{ fontSize: "1.05rem", lineHeight: 1 }}>⌕</span>
              + {text.chooseItem}
            </button>
          </div>

          <select
            id="adjustment-variant"
            value={variantId ?? ""}
            onChange={(event) => {
              setVariantId(
                event.target.value ? Number(event.target.value) : null,
              );
              setUnitId(null);
              invalidateRequest();
            }}
            data-testid="adjustment-variant-select"
            style={{ display: "none" }}
            tabIndex={-1}
          >
            <option value="">{t("adjustment.variantPlaceholder")}</option>
            {variants.map((variant) => (
              <option key={variant.variant_id} value={variant.variant_id}>
                {variant.sku} — {variant.name}
              </option>
            ))}
          </select>

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
          <div className="pr-selected-item-card" data-testid="stock-selected-item-card">
            <div className="pr-selected-item-info">
              <div className="pr-selected-item-eyebrow">
                {t("adjustment.currentContext")}
              </div>
              <div className="pr-selected-item-name">
                {selectedVariant.product_name
                  ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` — ${selectedVariant.variant_name}` : ""}`
                  : selectedVariant.variant_name ?? selectedVariant.name}
              </div>
              <div className="pr-selected-item-meta">
                {selectedVariant.sku && (
                  <span className="pr-meta-pill">
                    <span>SKU:</span> <strong>{selectedVariant.sku}</strong>
                  </span>
                )}
                {selectedVariant.primary_barcode && (
                  <span className="pr-meta-pill pr-meta-pill--barcode">
                    <span>▦</span> <strong>{selectedVariant.primary_barcode}</strong>
                  </span>
                )}
                {selectedVariant.quantity_on_hand != null && (
                  <span
                    className={`pr-meta-pill ${
                      isExactDecimalZero(selectedVariant.quantity_on_hand)
                        ? "pr-meta-pill--stock-zero"
                        : "pr-meta-pill--stock"
                    }`}
                  >
                    <span>{t("adjustment.currentQuantity")}:</span>{" "}
                    <strong>{formatExactDecimal(selectedVariant.quantity_on_hand ?? "0")}</strong>
                  </span>
                )}
                {selectedVariant.last_known_wac != null && (
                  <span className="pr-meta-pill pr-meta-pill--wac">
                    <span>{t("adjustment.currentWac")}:</span>{" "}
                    <strong>{formatExactDecimal(selectedVariant.last_known_wac ?? "0")} DZD</strong>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="sk-button sk-button--secondary sk-button--small pr-change-item-btn"
              onClick={() => {
                void loadVariants();
                setPickerOpen(true);
              }}
              data-testid="adjustment-change-item-btn"
            >
              {locale === "ar" ? "تغيير الصنف" : locale === "fr" ? "Changer d'article" : "Change item"}
            </button>
          </div>
        ) : (
          <div className="pr-empty-selection-prompt" data-testid="adjustment-empty-selection">
            <span className="pr-empty-selection-icon" aria-hidden>📦</span>
            <span>
              {locale === "ar"
                ? 'لم يتم تحديد صنف بعد. امسح الرمز الشريطي أعلاه أو انقر على "+ اختيار صنف".'
                : locale === "fr"
                ? 'Aucun article sélectionné. Scannez un code-barres ci-dessus ou cliquez sur "+ Choisir un article".'
                : 'No item selected yet. Scan a barcode above or click "+ Choose item".'}
            </span>
          </div>
        )}
        {selectedVariant && direction === "increase" && isZeroQty ? (
          <ZeroQuantityWarning
            variantName={selectedVariant.product_name ?? selectedVariant.name ?? ""}
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
                : quantityUnitError ?? undefined
            }
            data-testid="adjustment-quantity"
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
      <PurchaseItemPicker
        isOpen={pickerOpen}
        items={variants}
        showStock={true}
        onSelect={handleSelectItem}
        onClose={() => setPickerOpen(false)}
      />
    </section>
  );
}
