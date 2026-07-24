/**
 * Slice 2 — catalog gateway tests: command routing, payload shapes, error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import * as ipc from '../src/shared/ipc/gateway';
import { COMMANDS } from '../src/shared/ipc/commands';
import type { VariantInput } from '../src/shared/ipc/dto';

beforeEach(() => { invokeMock.mockReset(); });

describe('createProductWithVariants', () => {
  it('sends the correct command with camelCase args and VariantInput array', async () => {
    invokeMock.mockResolvedValue({ product_id: 1, variant_ids: [10, 11] });
    const variants: VariantInput[] = [
      { sku: 'TSH-S-W', sale_price: '10.00', is_active: true },
      { sku: 'TSH-M-W', sale_price: '10.00', is_active: true },
    ];
    const result = await ipc.createProductWithVariants('tok', 'T-Shirt', true, variants);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.CREATE_PRODUCT_WITH_VARIANTS, {
      sessionToken: 'tok',
      name: 'T-Shirt',
      isActive: true,
      variants,
    });
    expect(result.product_id).toBe(1);
    expect(result.variant_ids).toEqual([10, 11]);
  });

  it('keeps sale_price as a string (never a number)', async () => {
    invokeMock.mockResolvedValue({ product_id: 2, variant_ids: [12] });
    const variants: VariantInput[] = [{ sku: 'A1', sale_price: '99.99', is_active: true }];
    await ipc.createProductWithVariants('tok', 'Widget', false, variants);
    const [, args] = invokeMock.mock.calls[0];
    expect(typeof args.variants[0].sale_price).toBe('string');
    expect(args.variants[0].sale_price).toBe('99.99');
  });
});

describe('addVariant', () => {
  it('sends correct command with productId and variant payload', async () => {
    invokeMock.mockResolvedValue(42);
    const variant: VariantInput = {
      sku: 'V-001',
      sale_price: '5.50',
      is_active: true,
      attribute_value_ids: [3, 7],
      barcodes: ['6001234'],
      alternate_units: [{ unit_id: 2, conversion_factor: '12' }],
    };
    const result = await ipc.addVariant('tok', 99, variant);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.ADD_VARIANT, {
      sessionToken: 'tok',
      productId: 99,
      variant,
    });
    expect(result).toBe(42);
    const [, args] = invokeMock.mock.calls[0];
    // conversion_factor must be a string
    expect(typeof args.variant.alternate_units[0].conversion_factor).toBe('string');
  });
});

describe('setVariantAttributes', () => {
  it('sends variantId and attributeValueIds array', async () => {
    invokeMock.mockResolvedValue(null);
    await ipc.setVariantAttributes('tok', 5, [1, 2, 3]);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.SET_VARIANT_ATTRIBUTES, {
      sessionToken: 'tok',
      variantId: 5,
      attributeValueIds: [1, 2, 3],
    });
  });
});

describe('addVariantBarcode', () => {
  it('sends the barcode string and returns its id', async () => {
    invokeMock.mockResolvedValue(77);
    const result = await ipc.addVariantBarcode('tok', 10, '6001234567890');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.ADD_VARIANT_BARCODE, {
      sessionToken: 'tok',
      variantId: 10,
      barcode: '6001234567890',
    });
    expect(result).toBe(77);
  });
});

describe('removeVariantBarcode', () => {
  it('sends barcodeId', async () => {
    invokeMock.mockResolvedValue(null);
    await ipc.removeVariantBarcode('tok', 77);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.REMOVE_VARIANT_BARCODE, {
      sessionToken: 'tok',
      barcodeId: 77,
    });
  });
});

describe('addVariantAltUnit', () => {
  it('sends conversionFactor as a string', async () => {
    invokeMock.mockResolvedValue(55);
    await ipc.addVariantAltUnit('tok', 10, 2, '12');
    const [, args] = invokeMock.mock.calls[0];
    expect(typeof args.conversionFactor).toBe('string');
    expect(args.conversionFactor).toBe('12');
  });
});

describe('listCatalogProducts', () => {
  it('passes search as null when undefined', async () => {
    invokeMock.mockResolvedValue([]);
    await ipc.listCatalogProducts('tok');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.LIST_CATALOG_PRODUCTS, {
      sessionToken: 'tok',
      search: null,
    });
  });

  it('passes search string when provided', async () => {
    invokeMock.mockResolvedValue([]);
    await ipc.listCatalogProducts('tok', 'shirt');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.LIST_CATALOG_PRODUCTS, {
      sessionToken: 'tok',
      search: 'shirt',
    });
  });
});

describe('resolveBarcode', () => {
  it('returns the resolved barcode object when backend returns one', async () => {
    const resolved = {
      variant_id: 5, product_id: 1, sku: 'SKU-1', product_name: 'Shirt',
      sale_price: '10.00', base_unit_id: 1, variant_is_active: true, product_is_active: true,
    };
    invokeMock.mockResolvedValue(resolved);
    const result = await ipc.resolveBarcode('tok', '6001234');
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.RESOLVE_BARCODE, {
      sessionToken: 'tok',
      barcode: '6001234',
    });
    expect(result).toEqual(resolved);
  });

  it('returns null when barcode not found', async () => {
    invokeMock.mockResolvedValue(null);
    const result = await ipc.resolveBarcode('tok', 'UNKNOWN');
    expect(result).toBeNull();
  });
});

describe('getProductDetail', () => {
  it('sends productId and returns detail', async () => {
    const detail = {
      product_id: 1, name: 'Shirt', is_active: true,
      variants: [],
    };
    invokeMock.mockResolvedValue(detail);
    const result = await ipc.getProductDetail('tok', 1);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.GET_PRODUCT_DETAIL, {
      sessionToken: 'tok',
      productId: 1,
    });
    expect(result.product_id).toBe(1);
  });
});

describe('catalog gateway error normalization', () => {
  it('maps VALIDATION_ERROR code from backend to GatewayError', async () => {
    invokeMock.mockRejectedValue({ code: 'VALIDATION_ERROR' });
    await expect(ipc.createAttribute('tok', 'Color')).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'VALIDATION_ERROR',
    });
  });
});
