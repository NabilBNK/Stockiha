export type PeriodKind = 'today' | 'week' | 'month' | 'year' | 'custom';

export interface DashboardPrefs {
  period: PeriodKind;
  customFrom: string | null;
  customTo: string | null;
  compare: boolean;
  deadDays: 30 | 60 | 90 | 180;
}

const DEFAULT_PREFS: DashboardPrefs = {
  period: 'today',
  customFrom: null,
  customTo: null,
  compare: true,
  deadDays: 90,
};

let current: DashboardPrefs = { ...DEFAULT_PREFS };

export function getDashboardPrefs(): DashboardPrefs {
  return { ...current };
}

export function setDashboardPrefs(patch: Partial<DashboardPrefs>): DashboardPrefs {
  current = { ...current, ...patch };
  return { ...current };
}

export function resetDashboardPrefsForTests(): void {
  current = { ...DEFAULT_PREFS };
}
