import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppErrorCode } from '../../shared/types/errors';
import { useSession } from '../../shared/session/SessionContext';
import { useErrorText } from '../../shared/hooks/useErrorText';
import {
  getDashboardPeriod,
  getDashboardMoneySummary,
  listDashboardTopItems,
  listDashboardTopCustomers,
  getDashboardStockSummary,
  listDashboardStockItems,
  listDashboardTopDebtors,
  listDashboardLatestSales,
} from '../../shared/ipc/dashboardGateway';
import { getReportNotifications } from '../../shared/ipc/reportsGateway';
import { getDashboardSummary } from '../../shared/ipc/gateway';
import type {
  DashboardPeriod,
  DashboardMoneySummary,
  DashboardTopItem,
  DashboardTopCustomer,
  DashboardStockSummary,
  DashboardStockItem,
  DashboardTopDebtor,
  DashboardLatestSale,
} from '../../shared/ipc/dashboardDto';
import type { ReportNotifications } from '../../shared/ipc/reportsDto';
import type { DashboardSummary } from '../../shared/ipc/dto';
import {
  getDashboardPrefs,
  setDashboardPrefs,
  type DashboardPrefs,
  type PeriodKind,
} from './dashboardPrefs';
import { nowClockLabel } from './dashboardFormat';

function extractErrorCode(err: unknown): AppErrorCode | null {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: AppErrorCode }).code;
  }
  return null;
}

export type SectionKey =
  | 'period'
  | 'money'
  | 'topItems'
  | 'topCustomers'
  | 'stock'
  | 'runningLow'
  | 'debtors'
  | 'latest'
  | 'alerts'
  | 'system';

export interface SectionState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  errorCode: AppErrorCode | null;
  errorMessage: string | null;
  refreshing: boolean;
}

function initialSection<T>(): SectionState<T> {
  return {
    status: 'loading',
    data: null,
    errorCode: null,
    errorMessage: null,
    refreshing: false,
  };
}

export function useDashboardData(token: string, workstationId?: string | null) {
  const { clearSession } = useSession() ?? {};
  const errorText = useErrorText();

  const [prefs, setPrefsState] = useState<DashboardPrefs>(getDashboardPrefs);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [period, setPeriod] = useState<SectionState<DashboardPeriod>>(initialSection);
  const [money, setMoney] = useState<SectionState<DashboardMoneySummary>>(initialSection);
  const [topItems, setTopItems] = useState<SectionState<DashboardTopItem[]>>(initialSection);
  const [topCustomers, setTopCustomers] = useState<SectionState<DashboardTopCustomer[]>>(initialSection);
  const [stock, setStock] = useState<SectionState<DashboardStockSummary>>(initialSection);
  const [runningLow, setRunningLow] = useState<SectionState<DashboardStockItem[]>>(initialSection);
  const [debtors, setDebtors] = useState<SectionState<DashboardTopDebtor[]>>(initialSection);
  const [latest, setLatest] = useState<SectionState<DashboardLatestSale[]>>(initialSection);
  const [alerts, setAlerts] = useState<SectionState<ReportNotifications>>(initialSection);
  const [system, setSystem] = useState<SectionState<DashboardSummary>>(initialSection);

  const periodRef = useRef<DashboardPeriod | null>(null);

  // Sequence map to discard stale asynchronous responses
  const seqs = useRef<Record<SectionKey, number>>({
    period: 0,
    money: 0,
    topItems: 0,
    topCustomers: 0,
    stock: 0,
    runningLow: 0,
    debtors: 0,
    latest: 0,
    alerts: 0,
    system: 0,
  });

  const nextSeq = (key: SectionKey): number => {
    seqs.current[key] = (seqs.current[key] || 0) + 1;
    return seqs.current[key];
  };

  const isCurrentSeq = (key: SectionKey, seq: number): boolean => {
    return seqs.current[key] === seq;
  };

  const handleSessionExpiry = useCallback((err: unknown) => {
    const code = extractErrorCode(err);
    const msg = String(err);
    if (code === 'SESSION_INVALID' || msg.includes('SESSION_INVALID')) {
      clearSession?.();
    }
  }, [clearSession]);

  const loadPeriodSections = useCallback(async (
    targetPeriod: DashboardPeriod,
    isInitial = false,
  ) => {
    // 1. Money
    const mSeq = nextSeq('money');
    setMoney((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pMoney = getDashboardMoneySummary(token, {
      curFrom: targetPeriod.cur_from,
      curTo: targetPeriod.cur_to,
      prevFrom: targetPeriod.prev_from,
      prevTo: targetPeriod.prev_to,
      cutTime: targetPeriod.cut_time ?? null,
    })
      .then((data) => {
        if (isCurrentSeq('money', mSeq)) {
          setMoney({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('money', mSeq)) {
          setMoney((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 2. Top Items
    const iSeq = nextSeq('topItems');
    setTopItems((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pItems = listDashboardTopItems(token, targetPeriod.cur_from, targetPeriod.cur_to, 5)
      .then((data) => {
        if (isCurrentSeq('topItems', iSeq)) {
          setTopItems({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('topItems', iSeq)) {
          setTopItems((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 3. Top Customers
    const cSeq = nextSeq('topCustomers');
    setTopCustomers((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pCustomers = listDashboardTopCustomers(token, targetPeriod.cur_from, targetPeriod.cur_to)
      .then((data) => {
        if (isCurrentSeq('topCustomers', cSeq)) {
          setTopCustomers({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('topCustomers', cSeq)) {
          setTopCustomers((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    return Promise.allSettled([pMoney, pItems, pCustomers]);
  }, [token, errorText, handleSessionExpiry]);

  const loadRightNowSections = useCallback(async (
    deadDays: 30 | 60 | 90 | 180,
    isInitial = false,
  ) => {
    // 1. Stock Summary
    const sSeq = nextSeq('stock');
    setStock((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pStock = getDashboardStockSummary(token, deadDays)
      .then((data) => {
        if (isCurrentSeq('stock', sSeq)) {
          setStock({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('stock', sSeq)) {
          setStock((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 2. Running Low list
    const rlSeq = nextSeq('runningLow');
    setRunningLow((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pLow = listDashboardStockItems(token, 'low', deadDays, 5, 0)
      .then((data) => {
        if (isCurrentSeq('runningLow', rlSeq)) {
          setRunningLow({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('runningLow', rlSeq)) {
          setRunningLow((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 3. Debtors
    const dSeq = nextSeq('debtors');
    setDebtors((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pDebtors = listDashboardTopDebtors(token)
      .then((data) => {
        if (isCurrentSeq('debtors', dSeq)) {
          setDebtors({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('debtors', dSeq)) {
          setDebtors((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 4. Latest Sales
    const lSeq = nextSeq('latest');
    setLatest((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pLatest = listDashboardLatestSales(token)
      .then((data) => {
        if (isCurrentSeq('latest', lSeq)) {
          setLatest({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('latest', lSeq)) {
          setLatest((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 5. Alerts
    const aSeq = nextSeq('alerts');
    setAlerts((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pAlerts = Promise.resolve()
      .then(() => getReportNotifications(token))
      .then((data) => {
        if (isCurrentSeq('alerts', aSeq)) {
          setAlerts({ status: 'ready', data: data ?? { generated_at: '', items: [] }, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('alerts', aSeq)) {
          setAlerts((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    // 6. System summary
    const sysSeq = nextSeq('system');
    setSystem((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));
    const pSystem = Promise.resolve()
      .then(() => getDashboardSummary(token, workstationId ?? ''))
      .then((data) => {
        if (isCurrentSeq('system', sysSeq)) {
          setSystem({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('system', sysSeq)) {
          setSystem((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });

    return Promise.allSettled([pStock, pLow, pDebtors, pLatest, pAlerts, pSystem]);
  }, [token, workstationId, errorText, handleSessionExpiry]);

  const refreshAll = useCallback(async (isInitial = false) => {
    if (!token) return;
    const currentPrefs = getDashboardPrefs();

    // 1. Fetch period
    const pSeq = nextSeq('period');
    setPeriod((prev) => ({
      ...prev,
      status: isInitial ? 'loading' : prev.status,
      refreshing: !isInitial,
      errorMessage: null,
    }));

    // Start right-now sections in parallel immediately
    const rightNowPromise = loadRightNowSections(currentPrefs.deadDays, isInitial);

    try {
      const periodData = await getDashboardPeriod(
        token,
        currentPrefs.period,
        currentPrefs.customFrom,
        currentPrefs.customTo,
      );

      if (!isCurrentSeq('period', pSeq)) {
        return;
      }
      periodRef.current = periodData;
      setPeriod({
        status: 'ready',
        data: periodData,
        errorCode: null,
        errorMessage: null,
        refreshing: false,
      });

      // Once period succeeds, load period-dependent sections
      await Promise.allSettled([
        loadPeriodSections(periodData, isInitial),
        rightNowPromise,
      ]);
    } catch (err) {
      handleSessionExpiry(err);
      if (isCurrentSeq('period', pSeq)) {
        setPeriod((prev) => ({
          ...prev,
          status: 'error',
          errorCode: extractErrorCode(err),
          errorMessage: errorText(err),
          refreshing: false,
        }));
        // Period failure marks money, topItems, topCustomers as error
        const errMsg = errorText(err);
        setMoney((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
        setTopItems((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
        setTopCustomers((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
      }
      await rightNowPromise;
    } finally {
      setUpdatedAt(nowClockLabel(new Date()));
    }
  }, [token, loadPeriodSections, loadRightNowSections, errorText, handleSessionExpiry]);

  // Initial load on mount
  useEffect(() => {
    void refreshAll(true);
  }, [refreshAll]);

  const changePeriod = useCallback(async (next: {
    period: PeriodKind;
    customFrom?: string | null;
    customTo?: string | null;
  }) => {
    const updated = setDashboardPrefs(next);
    setPrefsState(updated);

    if (!token) return;

    const pSeq = nextSeq('period');
    setPeriod((prev) => ({ ...prev, refreshing: true, errorMessage: null }));

    try {
      const periodData = await getDashboardPeriod(
        token,
        updated.period,
        updated.customFrom,
        updated.customTo,
      );

      if (!isCurrentSeq('period', pSeq)) {
        return;
      }
      periodRef.current = periodData;
      setPeriod({
        status: 'ready',
        data: periodData,
        errorCode: null,
        errorMessage: null,
        refreshing: false,
      });
      await loadPeriodSections(periodData, false);
    } catch (err) {
      handleSessionExpiry(err);
      if (isCurrentSeq('period', pSeq)) {
        setPeriod((prev) => ({
          ...prev,
          status: 'error',
          errorCode: extractErrorCode(err),
          errorMessage: errorText(err),
          refreshing: false,
        }));
        const errMsg = errorText(err);
        setMoney((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
        setTopItems((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
        setTopCustomers((prev) => ({ ...prev, status: 'error', errorMessage: errMsg, refreshing: false }));
      }
    }
  }, [token, loadPeriodSections, errorText, handleSessionExpiry]);

  const changeDeadDays = useCallback(async (days: 30 | 60 | 90 | 180) => {
    const updated = setDashboardPrefs({ deadDays: days });
    setPrefsState(updated);
    if (!token) return;

    // Reload stock summary and running low
    const sSeq = nextSeq('stock');
    setStock((prev) => ({ ...prev, refreshing: true }));
    getDashboardStockSummary(token, days)
      .then((data) => {
        if (isCurrentSeq('stock', sSeq)) {
          setStock({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
        }
      })
      .catch((err) => {
        handleSessionExpiry(err);
        if (isCurrentSeq('stock', sSeq)) {
          setStock((prev) => ({
            ...prev,
            status: 'error',
            errorCode: extractErrorCode(err),
            errorMessage: errorText(err),
            refreshing: false,
          }));
        }
      });
  }, [token, errorText, handleSessionExpiry]);

  const retry = useCallback(async (section: SectionKey) => {
    if (!token) return;
    const currentPrefs = getDashboardPrefs();
    const currentPeriod = periodRef.current || period.data;

    if (section === 'period') {
      void changePeriod({
        period: currentPrefs.period,
        customFrom: currentPrefs.customFrom,
        customTo: currentPrefs.customTo,
      });
      return;
    }

    if (section === 'money') {
      if (currentPeriod) {
        const mSeq = nextSeq('money');
        setMoney((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
        getDashboardMoneySummary(token, {
          curFrom: currentPeriod.cur_from,
          curTo: currentPeriod.cur_to,
          prevFrom: currentPeriod.prev_from,
          prevTo: currentPeriod.prev_to,
          cutTime: currentPeriod.cut_time ?? null,
        })
          .then((data) => {
            if (isCurrentSeq('money', mSeq)) {
              setMoney({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
            }
          })
          .catch((err) => {
            handleSessionExpiry(err);
            if (isCurrentSeq('money', mSeq)) {
              setMoney((prev) => ({
                ...prev,
                status: 'error',
                errorCode: extractErrorCode(err),
                errorMessage: errorText(err),
                refreshing: false,
              }));
            }
          });
      } else {
        void changePeriod({
          period: currentPrefs.period,
          customFrom: currentPrefs.customFrom,
          customTo: currentPrefs.customTo,
        });
      }
      return;
    }

    if (section === 'topItems') {
      if (period.data) {
        const iSeq = nextSeq('topItems');
        setTopItems((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
        listDashboardTopItems(token, period.data.cur_from, period.data.cur_to, 5)
          .then((data) => {
            if (isCurrentSeq('topItems', iSeq)) {
              setTopItems({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
            }
          })
          .catch((err) => {
            handleSessionExpiry(err);
            if (isCurrentSeq('topItems', iSeq)) {
              setTopItems((prev) => ({
                ...prev,
                status: 'error',
                errorCode: extractErrorCode(err),
                errorMessage: errorText(err),
                refreshing: false,
              }));
            }
          });
      } else {
        void changePeriod({
          period: currentPrefs.period,
          customFrom: currentPrefs.customFrom,
          customTo: currentPrefs.customTo,
        });
      }
      return;
    }

    if (section === 'topCustomers') {
      if (period.data) {
        const cSeq = nextSeq('topCustomers');
        setTopCustomers((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
        listDashboardTopCustomers(token, period.data.cur_from, period.data.cur_to)
          .then((data) => {
            if (isCurrentSeq('topCustomers', cSeq)) {
              setTopCustomers({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
            }
          })
          .catch((err) => {
            handleSessionExpiry(err);
            if (isCurrentSeq('topCustomers', cSeq)) {
              setTopCustomers((prev) => ({
                ...prev,
                status: 'error',
                errorCode: extractErrorCode(err),
                errorMessage: errorText(err),
                refreshing: false,
              }));
            }
          });
      } else {
        void changePeriod({
          period: currentPrefs.period,
          customFrom: currentPrefs.customFrom,
          customTo: currentPrefs.customTo,
        });
      }
      return;
    }

    if (section === 'stock') {
      const sSeq = nextSeq('stock');
      setStock((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      getDashboardStockSummary(token, currentPrefs.deadDays)
        .then((data) => {
          if (isCurrentSeq('stock', sSeq)) {
            setStock({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('stock', sSeq)) {
            setStock((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }

    if (section === 'runningLow') {
      const rlSeq = nextSeq('runningLow');
      setRunningLow((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      listDashboardStockItems(token, 'low', currentPrefs.deadDays, 5, 0)
        .then((data) => {
          if (isCurrentSeq('runningLow', rlSeq)) {
            setRunningLow({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('runningLow', rlSeq)) {
            setRunningLow((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }

    if (section === 'debtors') {
      const dSeq = nextSeq('debtors');
      setDebtors((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      listDashboardTopDebtors(token)
        .then((data) => {
          if (isCurrentSeq('debtors', dSeq)) {
            setDebtors({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('debtors', dSeq)) {
            setDebtors((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }

    if (section === 'latest') {
      const lSeq = nextSeq('latest');
      setLatest((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      listDashboardLatestSales(token)
        .then((data) => {
          if (isCurrentSeq('latest', lSeq)) {
            setLatest({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('latest', lSeq)) {
            setLatest((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }

    if (section === 'alerts') {
      const aSeq = nextSeq('alerts');
      setAlerts((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      Promise.resolve()
        .then(() => getReportNotifications(token))
        .then((data) => {
          if (isCurrentSeq('alerts', aSeq)) {
            setAlerts({ status: 'ready', data: data ?? { generated_at: '', items: [] }, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('alerts', aSeq)) {
            setAlerts((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }

    if (section === 'system') {
      const sysSeq = nextSeq('system');
      setSystem((prev) => ({ ...prev, status: 'loading', errorMessage: null }));
      Promise.resolve()
        .then(() => getDashboardSummary(token, workstationId ?? ''))
        .then((data) => {
          if (isCurrentSeq('system', sysSeq)) {
            setSystem({ status: 'ready', data, errorCode: null, errorMessage: null, refreshing: false });
          }
        })
        .catch((err) => {
          handleSessionExpiry(err);
          if (isCurrentSeq('system', sysSeq)) {
            setSystem((prev) => ({
              ...prev,
              status: 'error',
              errorCode: extractErrorCode(err),
              errorMessage: errorText(err),
              refreshing: false,
            }));
          }
        });
      return;
    }
  }, [token, period.data, workstationId, errorText, handleSessionExpiry, changePeriod, loadPeriodSections]);

  const toggleCompare = useCallback(() => {
    const nextVal = !prefs.compare;
    const updated = setDashboardPrefs({ compare: nextVal });
    setPrefsState(updated);
  }, [prefs.compare]);

  const isAnyRefreshing =
    period.refreshing ||
    money.refreshing ||
    topItems.refreshing ||
    topCustomers.refreshing ||
    stock.refreshing ||
    runningLow.refreshing ||
    debtors.refreshing ||
    latest.refreshing ||
    alerts.refreshing ||
    system.refreshing;

  return {
    prefs,
    updatedAt,
    isAnyRefreshing,
    period,
    money,
    topItems,
    topCustomers,
    stock,
    runningLow,
    debtors,
    latest,
    alerts,
    system,
    actions: {
      refreshAll: () => void refreshAll(false),
      changePeriod,
      changeDeadDays,
      retry,
      toggleCompare,
    },
  };
}
