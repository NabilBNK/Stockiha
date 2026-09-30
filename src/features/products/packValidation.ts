import type { MessageKey } from '../../shared/i18n';
import { parseScaled } from '../../shared/utils/packMath';

/**
 * Normalises decimal input for money and quantities:
 * - trims surrounding whitespace
 * - replaces a single comma ',' with a decimal point '.'
 * - asserts strictly non-negative decimal digits (e.g. "12", "12.5")
 *
 * Returns normalised string or null if invalid.
 */
export function normalizeDecimalInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const commaCount = (trimmed.match(/,/g) || []).length;
  if (commaCount > 1) return null;

  const normalized = commaCount === 1 ? trimmed.replace(',', '.') : trimmed;
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export interface PackFormInput {
  unitId: number | null;
  factorText: string;
  priceText: string;
  barcodeText: string;
}

export interface PackFormContext {
  baseUnitId: number;
  baseIsWhole: boolean;
  usedUnitIds: number[];
  factorLocked: boolean;
}

export interface PackFormErrors {
  unitId?: MessageKey;
  factor?: MessageKey;
  price?: MessageKey;
  barcode?: MessageKey;
}

/**
 * Validates the pack creation/edit form in React before any IPC or backend call (Rule 7.5 & D16).
 */
export function validatePackForm(
  input: PackFormInput,
  ctx: PackFormContext
): PackFormErrors {
  const errors: PackFormErrors = {};

  // 1. Unit validations (in order)
  if (input.unitId === null || input.unitId === undefined) {
    errors.unitId = 'pack.error.unitRequired';
  } else if (input.unitId === ctx.baseUnitId) {
    errors.unitId = 'pack.error.unitIsBase';
  } else if (ctx.usedUnitIds.includes(input.unitId)) {
    errors.unitId = 'pack.error.unitAlreadyUsed';
  }

  // 2. Factor validations (in order, skipped if factorLocked)
  if (!ctx.factorLocked) {
    const rawFactor = input.factorText ?? '';
    if (rawFactor.trim() === '') {
      errors.factor = 'pack.error.factorRequired';
    } else {
      const normFactor = normalizeDecimalInput(rawFactor);
      if (normFactor === null) {
        errors.factor = 'pack.error.factorInvalid';
      } else {
        const parts = normFactor.split('.');
        const intStr = parts[0] ?? '0';
        const fracStr = parts[1] ?? '';
        const intVal = BigInt(intStr);
        const hasFrac = fracStr.replace(/0+$/, '').length > 0;

        // <= 1 check
        if (intVal < 1n || (intVal === 1n && !hasFrac)) {
          errors.factor = 'pack.error.factorTooSmall';
        } else if (intVal > 100000n || (intVal === 100000n && hasFrac)) {
          // > 100000 check
          errors.factor = 'pack.error.factorTooLarge';
        } else if (fracStr.length > 6) {
          // > 6 decimals check
          errors.factor = 'pack.error.factorDecimals';
        } else {
          // Whole check when base unit is whole
          const scale6 = parseScaled(normFactor, 6);
          if (ctx.baseIsWhole && scale6 % 1000000n !== 0n) {
            errors.factor = 'pack.error.factorWhole';
          }
        }
      }
    }
  }

  // 3. Price validations (optional, at most 2 decimals, <= 999999999999.99)
  const rawPrice = input.priceText ?? '';
  if (rawPrice.trim() !== '') {
    const normPrice = normalizeDecimalInput(rawPrice);
    if (normPrice === null) {
      errors.price = 'pack.error.priceInvalid';
    } else {
      const parts = normPrice.split('.');
      const fracStr = parts[1] ?? '';
      if (fracStr.length > 2) {
        errors.price = 'pack.error.priceInvalid';
      } else {
        const scaledPrice = parseScaled(normPrice, 2);
        if (scaledPrice > 99999999999999n) {
          errors.price = 'pack.error.priceInvalid';
        }
      }
    }
  }

  // 4. Barcode validations (optional; non-empty spaces only is invalid)
  const rawBarcode = input.barcodeText ?? '';
  if (rawBarcode.length > 0 && rawBarcode.trim() === '') {
    errors.barcode = 'pack.error.barcodeBlank';
  }

  return errors;
}
