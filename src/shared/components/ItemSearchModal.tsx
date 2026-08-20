import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { ProductListItem } from "../ipc/dto";
import { formatExactDecimal } from "../../features/inventory/exactDecimal";

export interface ItemSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: ProductListItem) => void;
  items: ProductListItem[];
  loading?: boolean;
  error?: string | null;
  selectedVariantId?: number | null;
}

export function matchesItemQuery(item: ProductListItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  // 1. SKU match
  if (item.sku?.toLocaleLowerCase().includes(query)) return true;

  // 2. Barcode match
  if (item.primary_barcode?.toLocaleLowerCase().includes(query)) return true;

  // 3. Product name match
  if (item.product_name?.toLocaleLowerCase().includes(query)) return true;

  // 4. Variant name / main name match
  if (item.name?.toLocaleLowerCase().includes(query)) return true;

  // 5. Attribute values match
  if (item.attributes && Array.isArray(item.attributes)) {
    if (
      item.attributes.some(
        (attr) =>
          attr.value?.toLocaleLowerCase().includes(query) ||
          attr.name?.toLocaleLowerCase().includes(query),
      )
    ) {
      return true;
    }
  }

  // Multi-token search (all space-separated keywords present anywhere in the item metadata)
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const combined = [
      item.sku,
      item.primary_barcode,
      item.product_name,
      item.name,
      ...(item.attributes?.map((a) => `${a.name || ""} ${a.value || ""}`) || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    if (tokens.every((token) => combined.includes(token))) {
      return true;
    }
  }

  return false;
}

export function ItemSearchModal({
  isOpen,
  onClose,
  onSelect,
  items,
  loading = false,
  error = null,
  selectedVariantId = null,
}: ItemSearchModalProps) {
  const { t } = useI18n();
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => matchesItemQuery(item, searchQuery));
  }, [items, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="sk-modal__backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="item-search-modal-backdrop"
    >
      <div
        className="sk-modal sk-modal-content--large"
        role="dialog"
        aria-modal="true"
        aria-label={t("adjustment.searchModalTitle")}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(100%, 780px)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        data-testid="item-search-modal"
      >
        <div className="sk-modal-header" style={{ marginBottom: 12 }}>
          <div>
            <h2 className="sk-modal__title">{t("adjustment.searchModalTitle")}</h2>
          </div>
          <button
            type="button"
            className="sk-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
            data-testid="item-search-modal-close"
          >
            ✕
          </button>
        </div>

        <div style={{ marginBlockEnd: 14 }}>
          <label className="sk-sr-only" htmlFor={searchInputId}>
            {t("adjustment.searchModalTitle")}
          </label>
          <input
            id={searchInputId}
            ref={searchInputRef}
            type="text"
            className="sk-field__input"
            placeholder={t("adjustment.searchModalPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="item-search-input"
            aria-label={t("adjustment.searchModalPlaceholder")}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 180,
            paddingRight: 4,
          }}
          data-testid="item-search-results"
        >
          {loading ? (
            <div style={{ padding: 32, textAlign: "center" }}>
              <div className="sk-spinner" role="status" aria-live="polite">
                <span className="sk-spinner__dot" aria-hidden />
                <span className="sk-sr-only">{t("common.loading")}</span>
              </div>
            </div>
          ) : error ? (
            <div className="sk-banner sk-banner--error" role="alert">
              {error}
            </div>
          ) : filteredItems.length === 0 ? (
            <div
              style={{
                padding: "36px 16px",
                textAlign: "center",
                color: "var(--sk-muted, #888)",
              }}
              data-testid="item-search-empty"
            >
              <p style={{ margin: 0, fontSize: "1rem" }}>{t("adjustment.noItemsFound")}</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = selectedVariantId === item.variant_id;
              const effectiveName = item.name;
              const hasDistinctProduct =
                item.product_name && item.product_name !== effectiveName;
              const barcode = item.primary_barcode;

              return (
                <div
                  key={item.variant_id}
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(item);
                      onClose();
                    }
                  }}
                  data-testid={`item-search-result-${item.variant_id}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "12px 16px",
                    border: `1px solid ${isSelected ? "var(--sk-accent, #3b82f6)" : "var(--sk-border, #e5e7eb)"}`,
                    borderRadius: "var(--sk-radius-sm, 6px)",
                    background: isSelected
                      ? "var(--sk-accent-soft, rgba(59, 130, 246, 0.08))"
                      : "var(--sk-surface-soft, rgba(255, 255, 255, 0.04))",
                    cursor: "pointer",
                    textAlign: "inherit",
                    transition: "border-color 0.15s, background-color 0.15s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "1rem" }}>
                      {effectiveName}
                    </span>
                    <div style={{ display: "flex", gap: 12, fontSize: "0.85rem" }}>
                      <span>
                        {t("adjustment.currentQuantity")}:{" "}
                        <strong className="sk-num">
                          {formatExactDecimal(item.quantity_on_hand)}
                        </strong>
                      </span>
                      <span>
                        {t("adjustment.currentWac")}:{" "}
                        <strong className="sk-num">
                          {formatExactDecimal(item.last_known_wac)} DZD
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "0.82rem",
                      color: "var(--sk-muted, #888)",
                    }}
                  >
                    {hasDistinctProduct && (
                      <span style={{ color: "var(--sk-text-soft)" }}>
                        {t("inventory.product")}: <strong style={{ color: "var(--sk-text)" }}>{item.product_name}</strong>
                      </span>
                    )}
                    {barcode ? (
                      <span style={{ background: "var(--sk-surface-soft)", padding: "2px 6px", borderRadius: 4, color: "var(--sk-text-soft)" }}>
                        {t("barcodes.barcode")}: <code className="sk-num" style={{ color: "var(--sk-text)" }}>{barcode}</code>
                      </span>
                    ) : (
                      <span style={{ background: "var(--sk-surface-soft)", padding: "2px 6px", borderRadius: 4, color: "var(--sk-text-soft)" }}>
                        {t("inventory.sku")}: <code className="sk-num" style={{ color: "var(--sk-text)" }}>{item.sku}</code>
                      </span>
                    )}
                    {item.attributes &&
                      item.attributes.map((attr, idx) => (
                        <span
                          key={idx}
                          style={{
                            background: "var(--sk-surface-soft)",
                            padding: "2px 6px",
                            borderRadius: 4,
                            color: "var(--sk-text-soft)"
                          }}
                        >
                          {attr.name ? `${attr.name}: ` : ""}
                          <strong style={{ color: "var(--sk-text)" }}>{attr.value}</strong>
                        </span>
                      ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="sk-modal__actions" style={{ marginBlockStart: 16 }}>
          <button
            type="button"
            className="sk-btn sk-btn--secondary"
            onClick={onClose}
            data-testid="item-search-modal-cancel"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
