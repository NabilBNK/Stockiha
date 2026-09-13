import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AttributeDefinition, PurchaseProductOption } from '../../shared/ipc/dto';
import * as ipc from '../../shared/ipc/gateway';
import { SessionContext } from '../../shared/session/SessionContext';
import { PROCUREMENT_COPY } from './procurementCopy';
import { useI18n } from '../../shared/i18n';

export interface GenericPickerItem {
  product_id: number;
  variant_id: number;
  sku: string;
  product_name?: string;
  variant_name?: string | null;
  name?: string;
  primary_barcode?: string | null;
  brand?: { id: number; name: string } | null;
  default_unit_id?: number;
  default_unit_code?: string;
  default_unit_name?: string | null;
  alternate_units?: { unit_id: number; unit_code: string }[];
  attributes?: { name?: string; value?: string }[];
  is_active: boolean;
  default_unit_cost?: string;
  last_purchase_cost?: string;
  quantity_on_hand?: string;
  last_known_wac?: string;
}

export function matchesPurchaseOption(item: GenericPickerItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  const productName = item.product_name ?? item.name ?? '';
  const haystack = [
    item.sku,
    item.primary_barcode,
    productName,
    item.variant_name,
    item.brand?.name,
    ...(item.attributes?.map((a) => `${a.name ?? ''} ${a.value ?? ''}`) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

interface Props<T extends GenericPickerItem = PurchaseProductOption> {
  isOpen: boolean;
  items: T[];
  disabledVariantIds?: number[];
  showStock?: boolean;
  onSelect: (item: T) => void;
  onClose: () => void;
}

export function PurchaseItemPicker<T extends GenericPickerItem = PurchaseProductOption>({
  isOpen,
  items,
  disabledVariantIds = [],
  showStock = false,
  onSelect,
  onClose,
}: Props<T>) {
  const { locale } = useI18n();
  const text = PROCUREMENT_COPY[locale];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  // Filter state
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null);
  const [minCost, setMinCost] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({});
  const [isMaximized, setIsMaximized] = useState(false);

  const clearAllFilters = () => {
    setSelectedUnit(null);
    setSelectedBrand(null);
    setMinCost('');
    setMaxCost('');
    setSelectedAttributes({});
  };

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    clearAllFilters();
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  // Extract available filter choices
  const availableUnits = useMemo(() => {
    const units = new Set<string>();
    for (const item of items) {
      if (item.default_unit_code) units.add(item.default_unit_code);
    }
    return Array.from(units).sort();
  }, [items]);

  const availableBrands = useMemo(() => {
    const brandsMap = new Map<number, string>();
    for (const item of items) {
      if (item.brand?.id && item.brand?.name) {
        brandsMap.set(item.brand.id, item.brand.name);
      }
    }
    return Array.from(brandsMap.entries()).map(([id, name]) => ({ id, name }));
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
      for (const attr of item.attributes ?? []) {
        if (!attr.name || !attr.value) continue;
        if (!map.has(attr.name)) map.set(attr.name, new Set());
        map.get(attr.name)!.add(attr.value);
      }
    }

    return Array.from(map.entries())
      .map(([name, valSet]) => ({
        name,
        values: Array.from(valSet).sort(),
      }))
      .filter((attr) => attr.values.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogAttributes, items]);

  const hasActiveFilters =
    Boolean(selectedUnit) ||
    Boolean(selectedBrand) ||
    Boolean(minCost.trim()) ||
    Boolean(maxCost.trim()) ||
    Object.keys(selectedAttributes).length > 0;

  const results = useMemo(() => {
    const minC = minCost.trim() ? parseFloat(minCost.trim()) : null;
    const maxC = maxCost.trim() ? parseFloat(maxCost.trim()) : null;
    const selectedAttrEntries = Object.entries(selectedAttributes);

    return items
      .filter((item) => item.is_active)
      .filter((item) => matchesPurchaseOption(item, query))
      .filter((item) => {
        if (selectedUnit && item.default_unit_code !== selectedUnit) {
          return false;
        }
        if (selectedBrand && item.brand?.id !== selectedBrand) {
          return false;
        }
        if (minC !== null || maxC !== null) {
          const itemCost = parseFloat(item.last_purchase_cost ?? item.default_unit_cost ?? '0');
          if (minC !== null && !isNaN(minC) && itemCost < minC) return false;
          if (maxC !== null && !isNaN(maxC) && itemCost > maxC) return false;
        }
        if (selectedAttrEntries.length > 0) {
          for (const [aName, aVal] of selectedAttrEntries) {
            const hasMatch = item.attributes?.some(
              (a) => a.name?.toLowerCase() === aName.toLowerCase() && a.value === aVal,
            );
            if (!hasMatch) return false;
          }
        }
        return true;
      })
      .slice(0, 50);
  }, [items, query, selectedUnit, selectedBrand, minCost, maxCost, selectedAttributes]);

  if (!isOpen) return null;

  return (
    <div
      className="sk-modal__backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="purchase-item-picker-backdrop"
    >
      <div
        className={`sk-modal sk-modal-content--large pr-picker-modal ${isMaximized ? 'pr-picker-modal--maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={text.chooseItem}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMaximized ? '98vw' : 'min(95vw, 1260px)',
          maxWidth: '98vw',
          height: isMaximized ? '96vh' : '86vh',
          maxHeight: isMaximized ? '96vh' : '92vh',
        }}
        data-testid="purchase-item-picker"
      >
        <div className="sk-modal-header" style={{ marginBottom: 0 }}>
          <h2 className="sk-modal__title">{text.chooseItem}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="sk-button sk-button--small sk-button--secondary"
              onClick={() => setIsMaximized((prev) => !prev)}
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              title={isMaximized ? 'Restore window' : 'Maximize window'}
              style={{ padding: '3px 9px', fontSize: '0.9rem', lineHeight: 1 }}
              data-testid="purchase-picker-toggle-maximize"
            >
              {isMaximized ? '🗗' : '🗖'}
            </button>
            <button
              type="button"
              className="sk-modal-close"
              onClick={onClose}
              aria-label={text.close}
              data-testid="purchase-item-picker-close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="pr-picker-body">
          {/* Side Filter Column */}
          <aside className="pr-picker-sidebar" data-testid="purchase-item-picker-sidebar">
            <div className="pr-picker-sidebar-header">
              <h3 className="pr-picker-sidebar-title">{text.filters}</h3>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="pr-picker-clear-btn"
                  onClick={clearAllFilters}
                  data-testid="purchase-picker-clear-filters"
                >
                  {text.clearFilters}
                </button>
              )}
            </div>

            {/* Cost Range Filter */}
            <div className="pr-filter-section">
              <span className="pr-filter-section__label">{text.costRange}</span>
              <div className="pr-cost-range-inputs">
                <div className="pr-cost-range-field">
                  <span>{text.minCost}</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={minCost}
                    onChange={(e) => setMinCost(e.target.value)}
                    className="pr-cost-input"
                    data-testid="filter-min-cost"
                  />
                </div>
                <div className="pr-cost-range-field">
                  <span>{text.maxCost}</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="10000"
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                    className="pr-cost-input"
                    data-testid="filter-max-cost"
                  />
                </div>
              </div>
            </div>

            {/* Unit Filter */}
            {availableUnits.length > 0 && (
              <div className="pr-filter-section">
                <span className="pr-filter-section__label">{text.unit}</span>
                <div className="pr-filter-chips">
                  <button
                    type="button"
                    className={`pr-filter-chip ${selectedUnit === null ? 'pr-filter-chip--active' : ''}`}
                    onClick={() => setSelectedUnit(null)}
                  >
                    {text.allUnits}
                  </button>
                  {availableUnits.map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={`pr-filter-chip ${selectedUnit === u ? 'pr-filter-chip--active' : ''}`}
                      onClick={() => setSelectedUnit(selectedUnit === u ? null : u)}
                      data-testid={`filter-unit-${u}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Brand Filter */}
            {availableBrands.length > 0 && (
              <div className="pr-filter-section">
                <span className="pr-filter-section__label">{text.brand}</span>
                <div className="pr-filter-chips">
                  <button
                    type="button"
                    className={`pr-filter-chip ${selectedBrand === null ? 'pr-filter-chip--active' : ''}`}
                    onClick={() => setSelectedBrand(null)}
                  >
                    {text.allBrands}
                  </button>
                  {availableBrands.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`pr-filter-chip ${selectedBrand === b.id ? 'pr-filter-chip--active' : ''}`}
                      onClick={() => setSelectedBrand(selectedBrand === b.id ? null : b.id)}
                      data-testid={`filter-brand-${b.id}`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Attribute Value Filters */}
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
                        className={`pr-filter-chip ${isSelected ? 'pr-filter-chip--active' : ''}`}
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
                        data-testid={`filter-attr-${attr.name}-${val}`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </aside>

          {/* Right Main Column (Search & Results) */}
          <div className="pr-picker-main">
            <div className="pr-picker-search-wrap">
              <input
                ref={inputRef}
                type="text"
                className="pr-picker-search-input"
                placeholder={text.searchItemsPlaceholder}
                aria-label={text.searchItemsPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                data-testid="purchase-item-picker-input"
              />
            </div>

            <div className="pr-picker-results-meta">
              <span>
                {results.length} {results.length === 1 ? 'item' : 'items'}
              </span>
              {hasActiveFilters && (
                <span style={{ fontSize: '0.78rem', color: 'var(--sk-primary)' }}>
                  (filtered)
                </span>
              )}
            </div>

            <div className="pr-picker-list" data-testid="purchase-item-picker-results">
              {results.length === 0 ? (
                <div
                  style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--sk-muted)' }}
                  data-testid="purchase-item-picker-empty"
                >
                  <p style={{ margin: 0, fontSize: '0.95rem' }}>{text.noItemsFound}</p>
                </div>
              ) : (
                results.map((item) => {
                  const alreadyAdded = disabledVariantIds.includes(item.variant_id);
                  const cost = item.last_purchase_cost ?? item.default_unit_cost;
                  return (
                    <button
                      key={item.variant_id}
                      type="button"
                      className="pr-picker-option-card"
                      disabled={alreadyAdded}
                      onClick={() => onSelect(item)}
                      data-testid={`purchase-item-option-${item.variant_id}`}
                    >
                      <div className="pr-picker-option-info">
                        <div className="pr-picker-option-name">
                          {item.variant_name
                            ? (item.product_name && !item.variant_name.toLowerCase().includes(item.product_name.toLowerCase())
                                ? `${item.product_name} — ${item.variant_name}`
                                : item.variant_name)
                            : item.name ?? item.product_name ?? item.sku}
                        </div>
                        <div className="pr-picker-option-meta">
                          {item.primary_barcode && (
                            <span className="pr-picker-meta-tag">
                              {item.primary_barcode}
                            </span>
                          )}
                          <span className="pr-picker-meta-tag">{item.sku}</span>
                          {item.default_unit_code && (
                            <span className="pr-picker-meta-tag">{item.default_unit_code}</span>
                          )}
                          {showStock && item.quantity_on_hand != null && (
                            <span className="pr-picker-meta-tag" style={{ fontWeight: 600, color: 'var(--sk-text)' }}>
                              Stock: {item.quantity_on_hand}
                            </span>
                          )}
                          {showStock && item.last_known_wac != null && (
                            <span className="pr-picker-meta-tag" style={{ color: 'var(--sk-muted)' }}>
                              WAC: {item.last_known_wac} DZD
                            </span>
                          )}
                          {!showStock && cost && (
                            <span className="pr-picker-meta-tag" style={{ color: 'var(--sk-primary)' }}>
                              {cost} DZD
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {alreadyAdded ? (
                          <span className="sk-badge sk-badge--muted" style={{ fontSize: '0.75rem' }}>
                            {text.itemAlreadyAdded}
                          </span>
                        ) : (
                          <span
                            className="sk-button sk-button--small sk-button--secondary"
                            style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.8rem' }}
                          >
                            +
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
