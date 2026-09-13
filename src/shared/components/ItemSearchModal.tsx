import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useI18n } from "../i18n";
import type { AttributeDefinition, ProductListItem } from "../ipc/dto";
import * as ipc from "../ipc/gateway";
import { SessionContext } from "../session/SessionContext";
import { formatExactDecimal, isExactDecimalZero } from "../../features/inventory/exactDecimal";
import "../../features/procurement/procurement.css";

export interface ItemSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: ProductListItem) => void;
  items: ProductListItem[];
  loading?: boolean;
  error?: string | null;
  selectedVariantId?: number | null;
  onQueryChange?: (query: string) => void;
  onEnter?: (query: string) => void;
  notice?: string | null;
  title?: string;
  placeholder?: string;
}

export function matchesItemQuery(item: ProductListItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  if (item.sku?.toLocaleLowerCase().includes(query)) return true;
  if (item.primary_barcode?.toLocaleLowerCase().includes(query)) return true;
  if (item.product_name?.toLocaleLowerCase().includes(query)) return true;
  if (item.name?.toLocaleLowerCase().includes(query)) return true;

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
  onQueryChange,
  onEnter,
  notice = null,
  title,
  placeholder,
}: ItemSearchModalProps) {
  const { t, locale } = useI18n();
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const serverControlled = onQueryChange != null;

  const clearAllFilters = () => {
    setSelectedCategory(null);
    setSelectedUnit(null);
    setSelectedAttributes({});
  };

  const hasActiveFilters =
    selectedCategory !== null ||
    selectedUnit !== null ||
    Object.keys(selectedAttributes).length > 0;

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      clearAllFilters();
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

  const session = useContext(SessionContext);
  const token = session?.user?.token;
  const [catalogAttributes, setCatalogAttributes] = useState<AttributeDefinition[]>([]);

  useEffect(() => {
    if (!isOpen || !token) return;
    let cancelled = false;
    ipc
      .listAttributes(token)
      .then((defs) => {
        if (!cancelled && Array.isArray(defs)) {
          setCatalogAttributes(defs);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, token]);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const item of items) {
      if (item.category_name) cats.add(item.category_name);
    }
    return Array.from(cats).sort();
  }, [items]);

  const availableUnits = useMemo(() => {
    const units = new Set<string>();
    for (const item of items) {
      const u =
        item.default_unit_code ??
        (item as unknown as Record<string, unknown>).unit_code;
      if (typeof u === "string" && u) units.add(u);
    }
    return Array.from(units).sort();
  }, [items]);

  const availableAttributes = useMemo(() => {
    const map = new Map<string, Set<string>>();

    // 1. From catalog attributes defined in system
    for (const def of catalogAttributes) {
      if (!def.name) continue;
      if (!map.has(def.name)) map.set(def.name, new Set());
      for (const val of def.attribute_values ?? []) {
        if (val.value && val.is_active !== false) {
          map.get(def.name)!.add(val.value);
        }
      }
    }

    // 2. Also merge attributes from currently loaded items
    for (const item of items) {
      if (!item.attributes) continue;
      for (const attr of item.attributes) {
        if (!attr.name || !attr.value) continue;
        if (!map.has(attr.name)) map.set(attr.name, new Set());
        map.get(attr.name)!.add(attr.value);
      }
    }

    return Array.from(map.entries())
      .map(([name, values]) => ({ name, values: Array.from(values).sort() }))
      .filter((attr) => attr.values.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogAttributes, items]);

  const filteredItems = useMemo(() => {
    let result = serverControlled
      ? items
      : items.filter((item) => matchesItemQuery(item, searchQuery));

    if (selectedCategory) {
      result = result.filter((item) => item.category_name === selectedCategory);
    }
    if (selectedUnit) {
      result = result.filter(
        (item) =>
          (item.default_unit_code ??
            (item as unknown as Record<string, unknown>).unit_code) ===
          selectedUnit
      );
    }
    const selectedAttrEntries = Object.entries(selectedAttributes);
    if (selectedAttrEntries.length > 0) {
      result = result.filter((item) => {
        if (!item.attributes) return false;
        return selectedAttrEntries.every(([aName, aVal]) =>
          item.attributes?.some(
            (a) =>
              a.name?.toLowerCase() === aName.toLowerCase() &&
              a.value === aVal
          )
        );
      });
    }
    return result;
  }, [
    items,
    searchQuery,
    serverControlled,
    selectedCategory,
    selectedUnit,
    selectedAttributes,
  ]);

  function handleQueryChange(value: string) {
    setSearchQuery(value);
    onQueryChange?.(value);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (onEnter) {
        onEnter(searchQuery);
      } else if (filteredItems.length > 0) {
        onSelect(filteredItems[0]);
        onClose();
      }
    }
  }

  const resolvedTitle = title ?? t("adjustment.searchModalTitle");
  const resolvedPlaceholder =
    placeholder ?? t("adjustment.searchModalPlaceholder");

  const hasAnyFilterChoices =
    availableCategories.length > 0 ||
    availableUnits.length > 0 ||
    availableAttributes.length > 0;

  if (!isOpen) return null;

  return (
    <div
      className="sk-modal__backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="item-search-modal-backdrop"
    >
      <div
        className={`sk-modal sk-modal-content--large pr-picker-modal ${isMaximized ? "pr-picker-modal--maximized" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={resolvedTitle}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMaximized ? "98vw" : "min(95vw, 1260px)",
          maxWidth: "98vw",
          height: isMaximized ? "96vh" : "86vh",
          maxHeight: isMaximized ? "96vh" : "92vh",
        }}
        data-testid="item-search-modal"
      >
        {/* Header */}
        <div className="sk-modal-header" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--sk-primary)", flexShrink: 0 }}
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <h2 className="sk-modal__title" style={{ margin: 0 }}>
              {resolvedTitle}
            </h2>
            <span
              className="sk-badge sk-badge--neutral"
              style={{ fontSize: "0.78rem" }}
            >
              {filteredItems.length}{" "}
              {locale === "ar"
                ? "صنف"
                : locale === "fr"
                ? "articles"
                : "items"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="sk-button sk-button--small sk-button--secondary"
              onClick={() => setIsMaximized((prev) => !prev)}
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              title={isMaximized ? "Restore window" : "Maximize window"}
              style={{
                padding: "3px 9px",
                fontSize: "0.9rem",
                lineHeight: 1,
              }}
              data-testid="item-search-modal-toggle-maximize"
            >
              {isMaximized ? "🗗" : "🗖"}
            </button>
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
        </div>

        {/* 2-Column Body: Left Sidebar Filters + Right Main Content */}
        <div className="pr-picker-body">
          {/* Side Filter Column */}
          <aside
            className="pr-picker-sidebar"
            data-testid="item-search-sidebar"
          >
            <div className="pr-picker-sidebar-header">
              <h3 className="pr-picker-sidebar-title">
                {locale === "ar"
                  ? "تصفية"
                  : locale === "fr"
                  ? "Filtres"
                  : "Filters"}
              </h3>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="pr-picker-clear-btn"
                  onClick={clearAllFilters}
                  data-testid="item-search-clear-filters"
                >
                  {locale === "ar"
                    ? "مسح الكل"
                    : locale === "fr"
                    ? "Tout effacer"
                    : "Clear all"}
                </button>
              )}
            </div>

            {/* Categories filter */}
            {availableCategories.length > 0 && (
              <div className="pr-filter-section">
                <span className="pr-filter-section__label">
                  {locale === "ar"
                    ? "الفئة"
                    : locale === "fr"
                    ? "Catégorie"
                    : "Category"}
                </span>
                <div className="pr-filter-chips">
                  {availableCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`pr-filter-chip ${
                        selectedCategory === cat ? "pr-filter-chip--active" : ""
                      }`}
                      onClick={() =>
                        setSelectedCategory(
                          selectedCategory === cat ? null : cat
                        )
                      }
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Units filter */}
            {availableUnits.length > 0 && (
              <div className="pr-filter-section">
                <span className="pr-filter-section__label">
                  {locale === "ar"
                    ? "الوحدة"
                    : locale === "fr"
                    ? "Unité"
                    : "Unit"}
                </span>
                <div className="pr-filter-chips">
                  {availableUnits.map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={`pr-filter-chip ${
                        selectedUnit === u ? "pr-filter-chip--active" : ""
                      }`}
                      onClick={() =>
                        setSelectedUnit(selectedUnit === u ? null : u)
                      }
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Attributes filter */}
            {availableAttributes.map((attr) => (
              <div key={attr.name} className="pr-filter-section">
                <span className="pr-filter-section__label">{attr.name}</span>
                <div className="pr-filter-chips">
                  {attr.values.map((val) => {
                    const isSelected = selectedAttributes[attr.name] === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        className={`pr-filter-chip ${
                          isSelected ? "pr-filter-chip--active" : ""
                        }`}
                        onClick={() => {
                          setSelectedAttributes((prev) => {
                            const next = { ...prev };
                            if (isSelected) {
                              delete next[attr.name];
                            } else {
                              next[attr.name] = val;
                            }
                            return next;
                          });
                        }}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {!hasAnyFilterChoices && (
              <p
                style={{
                  fontSize: "0.82rem",
                  color: "var(--sk-muted)",
                  margin: "8px 0",
                }}
              >
                {locale === "ar"
                  ? "لا توجد فلاتر إضافية"
                  : locale === "fr"
                  ? "Aucun filtre disponible"
                  : "No filters available"}
              </p>
            )}
          </aside>

          {/* Right Main Column (Search & Results) */}
          <div className="pr-picker-main">
            <div
              className="pr-picker-search-wrap"
              style={{ position: "relative" }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: "absolute",
                  insetInlineStart: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--sk-muted)",
                  pointerEvents: "none",
                }}
                aria-hidden
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id={searchInputId}
                ref={searchInputRef}
                type="text"
                className="pr-picker-search-input"
                style={{
                  paddingInlineStart: 36,
                  paddingInlineEnd: searchQuery ? 36 : 14,
                }}
                placeholder={resolvedPlaceholder}
                aria-label={resolvedPlaceholder}
                value={searchQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                autoComplete="off"
                data-testid="item-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pr-picker-clear-btn"
                  style={{
                    position: "absolute",
                    insetInlineEnd: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    fontSize: "1rem",
                    color: "var(--sk-muted)",
                    cursor: "pointer",
                  }}
                  onClick={() => handleQueryChange("")}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {notice ? (
              <div
                className="sk-banner sk-banner--warning"
                role="status"
                style={{ marginBlock: "2px 4px" }}
                data-testid="item-search-notice"
              >
                {notice}
              </div>
            ) : null}

            <div className="pr-picker-results-meta">
              <span>
                {filteredItems.length}{" "}
                {filteredItems.length === 1 ? "item" : "items"}
              </span>
              {hasActiveFilters && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--sk-primary)",
                  }}
                >
                  (
                  {locale === "ar"
                    ? "مصفى"
                    : locale === "fr"
                    ? "filtré"
                    : "filtered"}
                  )
                </span>
              )}
            </div>

            <div className="pr-picker-list" data-testid="item-search-results">
              {loading ? (
                <div
                  style={{
                    padding: 48,
                    textAlign: "center",
                    gridColumn: "1 / -1",
                  }}
                >
                  <div
                    className="sk-spinner"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="sk-spinner__dot" aria-hidden />
                    <span className="sk-sr-only">{t("common.loading")}</span>
                  </div>
                </div>
              ) : error ? (
                <div
                  className="sk-banner sk-banner--error"
                  role="alert"
                  style={{ margin: 16, gridColumn: "1 / -1" }}
                >
                  {error}
                </div>
              ) : filteredItems.length === 0 ? (
                <div
                  style={{
                    padding: "48px 16px",
                    textAlign: "center",
                    color: "var(--sk-muted)",
                    gridColumn: "1 / -1",
                  }}
                  data-testid="item-search-empty"
                >
                  <div
                    style={{
                      fontSize: "2rem",
                      marginBottom: 8,
                      opacity: 0.4,
                    }}
                  >
                    ⌕
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.95rem",
                      fontWeight: 500,
                    }}
                  >
                    {t("adjustment.noItemsFound")}
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      className="sk-button sk-button--small sk-button--secondary"
                      style={{ marginTop: 12 }}
                      onClick={clearAllFilters}
                    >
                      {locale === "ar"
                        ? "إلغاء الفلاتر"
                        : locale === "fr"
                        ? "Réinitialiser les filtres"
                        : "Reset filters"}
                    </button>
                  )}
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isSelected = selectedVariantId === item.variant_id;
                  const effectiveName = item.name;
                  const hasDistinctProduct =
                    item.product_name &&
                    item.product_name !== effectiveName;
                  const displayName = hasDistinctProduct
                    ? `${item.product_name} — ${effectiveName}`
                    : effectiveName || item.product_name;

                  return (
                    <button
                      key={item.variant_id}
                      type="button"
                      className={`pr-picker-option-card ${
                        isSelected ? "pr-picker-option-card--selected" : ""
                      }`}
                      onClick={() => {
                        onSelect(item);
                        onClose();
                      }}
                      data-testid={`item-search-result-${item.variant_id}`}
                    >
                      <div className="pr-picker-option-info">
                        <div className="pr-picker-option-name">
                          {displayName}
                        </div>
                        <div className="pr-picker-option-meta">
                          {item.primary_barcode && (
                            <span className="pr-picker-meta-tag">
                              {item.primary_barcode}
                            </span>
                          )}
                          <span className="pr-picker-meta-tag">
                            {item.sku}
                          </span>
                          {item.category_name && (
                            <span className="pr-picker-meta-tag">
                              {item.category_name}
                            </span>
                          )}
                          {item.quantity_on_hand != null && (
                            <span
                              className="pr-picker-meta-tag"
                              style={{
                                fontWeight: 600,
                                color: isExactDecimalZero(item.quantity_on_hand)
                                  ? "var(--sk-warning, #d97706)"
                                  : "var(--sk-success, #059669)",
                              }}
                            >
                              Stock: {formatExactDecimal(item.quantity_on_hand)}
                            </span>
                          )}
                          {(item.sale_price || item.last_known_wac) && (
                            <span
                              className="pr-picker-meta-tag"
                              style={{ color: "var(--sk-primary)" }}
                            >
                              {formatExactDecimal(
                                item.sale_price ?? item.last_known_wac ?? "0"
                              )}{" "}
                              DZD
                            </span>
                          )}
                          {item.attributes &&
                            item.attributes.map((attr, idx) => (
                              <span key={idx} className="pr-picker-meta-tag">
                                {attr.name ? `${attr.name}: ` : ""}
                                <strong>{attr.value}</strong>
                              </span>
                            ))}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        <span className="sk-button sk-button--small sk-button--primary">
                          {locale === "ar"
                            ? "تحديد"
                            : locale === "fr"
                            ? "Choisir"
                            : "Select"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            paddingTop: 8,
            borderTop: "1px solid var(--sk-border)",
          }}
        >
          <button
            type="button"
            className="sk-button sk-button--secondary"
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
