import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { usePrimaryPacks, invalidatePrimaryPacks } from '../src/shared/hooks/usePrimaryPacks';
import { SessionContext } from '../src/shared/session/SessionContext';
import * as gateway from '../src/shared/ipc/gateway';
import type { PrimaryPack } from '../src/shared/ipc/dto';

vi.mock('../src/shared/ipc/gateway', () => ({
  getPrimaryPacks: vi.fn(),
}));

describe('usePrimaryPacks hook (O-5.1)', () => {
  const mockToken = 'mock-session-token';
  const mockSession = {
    user: { username: 'testuser', token: mockToken },
    activeCashSession: null,
    workstationId: 'WS-01',
    login: vi.fn(),
    logout: vi.fn(),
    clearSession: vi.fn(),
    refreshActiveCashSession: vi.fn(),
    setActiveCashSession: vi.fn(),
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(SessionContext.Provider, { value: mockSession }, children)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePrimaryPacks();
  });

  it('batches 1,200 IDs into 3 requests (500/500/200)', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);

    vi.mocked(gateway.getPrimaryPacks).mockImplementation((_token, batchIds) => {
      const result: PrimaryPack[] = batchIds.slice(0, 1).map((id) => ({
        variant_id: id,
        variant_unit_id: id * 10,
        unit_code: 'CTN',
        unit_name: 'Carton',
        conversion_factor: '12',
        sale_price: '15000.00',
        base_unit_code: 'PCS',
        base_unit_name: 'Piece',
      }));
      return Promise.resolve(result);
    });

    const { result } = renderHook(() => usePrimaryPacks(ids), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(gateway.getPrimaryPacks).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(gateway.getPrimaryPacks).mock.calls;
    expect(calls[0][1].length).toBe(500);
    expect(calls[1][1].length).toBe(500);
    expect(calls[2][1].length).toBe(200);

    // Second render with the same IDs should use module cache and NOT call getPrimaryPacks again
    const { result: secondResult } = renderHook(() => usePrimaryPacks(ids), { wrapper });
    expect(secondResult.current.loading).toBe(false);
    expect(gateway.getPrimaryPacks).toHaveBeenCalledTimes(3);

    // After invalidatePrimaryPacks(), subsequent render should fetch again
    act(() => {
      invalidatePrimaryPacks();
    });
    const { result: thirdResult } = renderHook(() => usePrimaryPacks(ids), { wrapper });
    await waitFor(() => {
      expect(thirdResult.current.loading).toBe(false);
    });
    expect(gateway.getPrimaryPacks).toHaveBeenCalledTimes(6);
  });
});
