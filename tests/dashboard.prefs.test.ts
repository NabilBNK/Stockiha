import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDashboardPrefs,
  setDashboardPrefs,
  resetDashboardPrefsForTests,
} from '../src/features/dashboard/dashboardPrefs';

describe('dashboardPrefs', () => {
  beforeEach(() => {
    resetDashboardPrefsForTests();
  });

  it('returns default preferences initially', () => {
    expect(getDashboardPrefs()).toEqual({
      period: 'today',
      customFrom: null,
      customTo: null,
      compare: true,
      deadDays: 90,
    });
  });

  it('merges partial patches and returns updated copy', () => {
    const updated = setDashboardPrefs({ period: 'month', compare: false });
    expect(updated).toEqual({
      period: 'month',
      customFrom: null,
      customTo: null,
      compare: false,
      deadDays: 90,
    });
    expect(getDashboardPrefs()).toEqual(updated);
  });

  it('resets back to defaults', () => {
    setDashboardPrefs({ period: 'year', deadDays: 180 });
    resetDashboardPrefsForTests();
    expect(getDashboardPrefs()).toEqual({
      period: 'today',
      customFrom: null,
      customTo: null,
      compare: true,
      deadDays: 90,
    });
  });
});
