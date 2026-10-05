import { describe, it, expect } from 'vitest';
import type { MessageKey } from '../src/shared/i18n';
import {
  splitAmount,
  formatCount,
  formatPct,
  deltaText,
  formatRange,
  formatCutTime,
  formatTimeOfSale,
  nowClockLabel,
} from '../src/features/dashboard/dashboardFormat';

describe('dashboardFormat', () => {
  describe('splitAmount', () => {
    it('splits and formats positive amounts', () => {
      expect(splitAmount('58500.00')).toEqual({
        sign: '',
        integer: '58,500',
        fraction: '.00',
      });
    });

    it('splits and formats negative amounts with padding', () => {
      expect(splitAmount('-1250.5')).toEqual({
        sign: '-',
        integer: '1,250',
        fraction: '.50',
      });
    });

    it('splits zero', () => {
      expect(splitAmount('0')).toEqual({
        sign: '',
        integer: '0',
        fraction: '.00',
      });
    });

    it('handles empty/null gracefully', () => {
      expect(splitAmount(null)).toEqual({
        sign: '',
        integer: '0',
        fraction: '.00',
      });
    });
  });

  describe('formatCount', () => {
    it('formats small integers', () => {
      expect(formatCount(7)).toBe('7');
    });

    it('formats large integers with commas', () => {
      expect(formatCount(12000)).toBe('12,000');
    });
  });

  describe('formatPct', () => {
    it('strips leading minus sign', () => {
      expect(formatPct('-76.4')).toBe('76.4');
    });

    it('keeps positive percentage untouched', () => {
      expect(formatPct('31.3')).toBe('31.3');
    });
  });

  describe('deltaText', () => {
    const mockT = (key: MessageKey, params?: Record<string, string | number>): string => {
      if (key === 'dash.delta.up') return `▲ ${params?.pct}% vs previous period`;
      if (key === 'dash.delta.down') return `▼ ${params?.pct}% vs previous period`;
      if (key === 'dash.delta.flat') return 'No change vs previous period';
      if (key === 'dash.delta.noBase') return `Previous period: ${params?.value}`;
      return '';
    };

    it('handles UP', () => {
      expect(deltaText('UP', '12.5', '100', mockT)).toBe('▲ 12.5% vs previous period');
    });

    it('handles DOWN with negative pct converted to positive', () => {
      expect(deltaText('DOWN', '-8.2', '100', mockT)).toBe('▼ 8.2% vs previous period');
    });

    it('handles FLAT', () => {
      expect(deltaText('FLAT', null, '100', mockT)).toBe('No change vs previous period');
    });

    it('handles NO_BASE', () => {
      expect(deltaText('NO_BASE', null, '0.00 DZD', mockT)).toBe('Previous period: 0.00 DZD');
    });

    it('handles NONE', () => {
      expect(deltaText('NONE', null, '100', mockT)).toBe('');
    });
  });

  describe('formatRange', () => {
    const mockT = (key: MessageKey, params?: Record<string, string | number>): string => {
      if (key === 'dash.period.range') return `${params?.from} – ${params?.to}`;
      return '';
    };

    it('returns single date when from === to', () => {
      expect(formatRange('2026-09-24', '2026-09-24', 'en', mockT)).toBe('24 Sep 2026');
    });

    it('returns formatted range when from !== to', () => {
      expect(formatRange('2026-09-01', '2026-09-24', 'en', mockT)).toBe(
        '1 Sep 2026 – 24 Sep 2026',
      );
    });
  });

  describe('formatCutTime', () => {
    it('truncates seconds', () => {
      expect(formatCutTime('12:00:00')).toBe('12:00');
    });

    it('returns null for null', () => {
      expect(formatCutTime(null)).toBeNull();
    });
  });

  describe('formatTimeOfSale', () => {
    it('returns HH:MM when sale is today', () => {
      expect(formatTimeOfSale('2026-09-24T09:30:00', '2026-09-24', 'en')).toBe('09:30');
    });

    it('returns date and time when sale is on an earlier date', () => {
      expect(formatTimeOfSale('2026-09-23T14:15:00', '2026-09-24', 'en')).toBe(
        '23 Sep 2026 14:15',
      );
    });
  });

  describe('nowClockLabel', () => {
    it('formats a date as HH:MM in Africa/Algiers timezone', () => {
      const d = new Date('2026-09-24T12:34:56Z');
      const label = nowClockLabel(d);
      expect(label).toMatch(/^\d{2}:\d{2}$/);
    });
  });
});
