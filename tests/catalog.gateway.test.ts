/**
 * Slice 2 — catalog gateway tests: command routing, payload shapes, error handling.
 * Stockiha Product & Variant Architecture Redesign.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import * as ipc from '../src/shared/ipc/gateway';
import { COMMANDS } from '../src/shared/ipc/commands';
import type { VariantInput } from '../src/shared/ipc/dto';

beforeEach(() => { invokeMock.mockReset(); });

describe('createProductWithVariants', () => {
  it('sends the correct command with product unitId and VariantInput array', async () => {
    invokeMock.mockResolvedValue({ product_id: 1, variant_ids: [10, 11] });
    const variants: VariantInput[] = [
      { name_override: 'Red', sale_price: '10.00', is_active: true },
      { sale_price: '12.00', is_active: true },
    ];
    const result = await ipc.createProductWithVariants('tok', 'T-Shirt', 2, true, variants);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.CREATE_PRODUCT_WITH_VARIANTS, {
      sessionToken: 'tok',
      name: 'T-Shirt',
      unitId: 2,
      isActive: true,
      variants,
    });
    expect(result.product_id).toBe(1);
    expect(result.variant_ids).toEqual([10, 11]);
  });

  it('keeps sale_price as a string (never a number)', async () => {
    invokeMock.mockResolvedValue({ product_id: 2, variant_ids: [12] });
    const variants: VariantInput[] = [{ sale_price: '99.99', is_active: true }];
    await ipc.createProductWithVariants('tok', 'Widget', 1, false, variants);
    const [, args] = invokeMock.mock.calls[0];
    expect(typeof args.variants[0].sale_price).toBe('string');
    expect(args.variants[0].sale_price).toBe('99.99');
  });
});

describe('addVariant', () => {
  it('sends correct command with productId and variant payload', async () => {
    invokeMock.mockResolvedValue(42);
    const variant: VariantInput = {
      name_override: 'Custom Variant',
      sale_price: '5.50',
      is_active: true,
      attribute_value_ids: [3, 7],
      barcodes: ['6001234'],
    };
    const result = await ipc.addVariant('tok', 99, variant);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.ADD_VARIANT, {
      sessionToken: 'tok',
      productId: 99,
      variant,
    });
    expect(result).toBe(42);
  });
});

describe('updateProduct', () => {
  it('sends product_id, name, unitId, and isActive', async () => {
    invokeMock.mockResolvedValue(null);
    await ipc.updateProduct('tok', 5, 'Pillow Cover', 3, true);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.UPDATE_PRODUCT, {
      sessionToken: 'tok',
      productId: 5,
      name: 'Pillow Cover',
      unitId: 3,
      isActive: true,
    });
  });
});

describe('updateVariant', () => {
  it('sends variant_id, nameOverride, salePrice, and isActive', async () => {
    invokeMock.mockResolvedValue(null);
    await ipc.updateVariant('tok', 10, 'Classic Red', '15.00', true);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.UPDATE_VARIANT, {
      sessionToken: 'tok',
      variantId: 10,
      nameOverride: 'Classic Red',
      salePrice: '15.00',
      isActive: true,
    });
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

describe('R8-D inventory gateway', () => {
  it('loads capability projection and inventory filters through typed commands', async () => {
    invokeMock
      .mockResolvedValueOnce({
        can_manage_catalog: true,
        can_post_stock_receipt: true,
        can_view_inventory: true,
        can_manage_inventory: true,
      })
      .mockResolvedValueOnce([]);

    await ipc.getInventoryCapabilities('tok');
    expect(invokeMock).toHaveBeenNthCalledWith(1, COMMANDS.GET_INVENTORY_CAPABILITIES, {
      sessionToken: 'tok',
    });

    await ipc.listInventorySnapshot('tok', 9, '  notebook  ', true);
    expect(invokeMock).toHaveBeenNthCalledWith(2, COMMANDS.LIST_INVENTORY_SNAPSHOT, {
      sessionToken: 'tok',
      warehouseId: 9,
      search: 'notebook',
      includeInactive: true,
    });
  });

  it('returns a cohesive stock receipt result while preserving string decimals', async () => {
    invokeMock.mockResolvedValue({
      document_id: 4,
      document_number: 'SR-2026-000004',
      warehouse_id: 1,
      variant_id: 7,
      received_quantity: '10.000',
      received_value: '1200.0000',
      resulting_quantity_on_hand: '20.000',
      resulting_total_value: '2200.0000',
      resulting_wac: '110.000000',
    });

    const result = await ipc.postStockReceipt('tok', {
      requestId: 'rid',
      warehouseId: 1,
      variantId: 7,
      quantity: '10.000',
      unitCost: '120.00',
      fiscalPeriodId: 9,
      documentDate: '2026-08-11',
    });

    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.POST_STOCK_RECEIPT, {
      sessionToken: 'tok',
      requestId: 'rid',
      warehouseId: 1,
      variantId: 7,
      quantity: '10.000',
      unitCost: '120.00',
      fiscalPeriodId: 9,
      documentDate: '2026-08-11',
    });
    expect(result.document_number).toBe('SR-2026-000004');
    expect(typeof result.resulting_wac).toBe('string');
  });
});

describe('resolveBarcode', () => {
  it('returns the resolved barcode object when backend returns one', async () => {
    const resolved = {
      variant_id: 5, product_id: 1, sku: 'SKU-00000005', name_override: null,
      effective_variant_name: 'Shirt · S', primary_barcode: '6001234',
      operational_identifier: '6001234', identifier_type: 'BARCODE', product_name: 'Shirt',
      sale_price: '10.00', unit_id: 1, unit_code: 'PC', unit_name: 'Piece',
      variant_is_active: true, product_is_active: true,
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
      product_id: 1, name: 'Shirt', unit_id: 1, unit_code: 'PC', unit_name: 'Piece', is_active: true,
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
