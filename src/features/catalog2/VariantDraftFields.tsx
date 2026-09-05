/**
 * WS-D-11 — the fields that describe one NEW variant, lifted out of
 * CatalogPanel so the create panel and the add-variant form share one
 * definition and cannot drift apart (R16).
 *
 * `minimumStock` seeds to "0" deliberately: "0" means "never warn me about
 * this item" (ws-d-skill.md section 3). It is a value, not a blank.
 */
import { TextField } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import { isValidMinimumStock, isValidPrice } from './catalogValidation';

/**
 * The fields that describe one new variant. Shared by "add variant" and by the
 * first variant of a new product, so the two paths cannot drift apart.
 *
 * `minimumStock` seeds to "0" deliberately: "0" means "never warn me about
 * this item" (ws-d-skill.md section 3). It is a value, not a blank.
 */
export interface VariantDraft {
  nameOverride: string;
  barcode: string;
  salePrice: string;
  minimumStock: string;
  isActive: boolean;
}

export const EMPTY_VARIANT_DRAFT: VariantDraft = {
  nameOverride: '',
  barcode: '',
  salePrice: '',
  minimumStock: '0',
  isActive: true,
};

export function isVariantDraftValid(draft: VariantDraft): boolean {
  return isValidPrice(draft.salePrice) && isValidMinimumStock(draft.minimumStock);
}

export function VariantDraftFields({
  idPrefix,
  draft,
  onChange,
  disabled,
  showActive = true,
}: {
  idPrefix: string;
  draft: VariantDraft;
  onChange: (next: VariantDraft) => void;
  disabled?: boolean;
  showActive?: boolean;
}) {
  const { t } = useI18n();
  const priceInvalid = draft.salePrice !== '' && !isValidPrice(draft.salePrice);
  const minInvalid = draft.minimumStock !== '' && !isValidMinimumStock(draft.minimumStock);

  function set(patch: Partial<VariantDraft>) {
    onChange({ ...draft, ...patch });
  }

  return (
    <div className="sk-catalog2__panel-grid">
      <TextField
        id={`${idPrefix}-name`}
        label={t('variants.name')}
        value={draft.nameOverride}
        placeholder={t('variants.namePlaceholder')}
        onChange={(e) => set({ nameOverride: e.target.value })}
        disabled={disabled}
        data-testid={`${idPrefix}-name`}
      />
      <TextField
        id={`${idPrefix}-barcode`}
        label={t('barcodes.barcode')}
        value={draft.barcode}
        placeholder={t('barcodes.placeholder')}
        onChange={(e) => set({ barcode: e.target.value })}
        disabled={disabled}
        data-testid={`${idPrefix}-barcode`}
      />
      <TextField
        id={`${idPrefix}-price`}
        label={`${t('variants.price')} (DZD)`}
        value={draft.salePrice}
        inputMode="decimal"
        onChange={(e) => set({ salePrice: e.target.value })}
        error={priceInvalid ? t('variants.invalidPrice') : undefined}
        required
        disabled={disabled}
        data-testid={`${idPrefix}-price`}
      />
      <div>
        <TextField
          id={`${idPrefix}-minimum-stock`}
          label={t('variants.minimumStock')}
          value={draft.minimumStock}
          inputMode="decimal"
          onChange={(e) => set({ minimumStock: e.target.value })}
          error={minInvalid ? t('variants.invalidMinimumStock') : undefined}
          required
          disabled={disabled}
          data-testid={`${idPrefix}-minimum-stock`}
        />
        <p className="sk-catalog2__note">{t('variants.minimumStockHint')}</p>
      </div>
      {showActive ? (
        <label className="sk-catalog2__checkbox">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
            disabled={disabled}
            data-testid={`${idPrefix}-active`}
          />
          <span>{draft.isActive ? t('catalog.active') : t('catalog.inactive')}</span>
        </label>
      ) : null}
    </div>
  );
}
