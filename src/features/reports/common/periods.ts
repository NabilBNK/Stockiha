// WS-I-1 §5.8 — period presets and their comparison ranges. Plain date
// arithmetic on 'YYYY-MM-DD' strings, built as UTC `Date`s, so the host
// machine's own time zone never affects the result (A5: report dates use
// Africa/Algiers, a fixed UTC+1 offset with no DST).

export type PresetId =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'LAST_WEEK'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'CUSTOM';

export interface Period {
  from: string;
  to: string;
  preset: PresetId;
}

const ALGERIA_OFFSET_MS = 60 * 60 * 1000;

interface YMD {
  y: number;
  m: number;
  d: number;
}

function parseISO(value: string): YMD {
  const [y, m, d] = value.split('-').map(Number);
  return { y, m, d };
}

function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonthUTC(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysISO(value: string, days: number): string {
  const { y, m, d } = parseISO(value);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function daysBetweenISO(from: string, to: string): number {
  const a = parseISO(from);
  const b = parseISO(to);
  const utcA = Date.UTC(a.y, a.m - 1, a.d);
  const utcB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((utcB - utcA) / 86_400_000);
}

/** Shifts `value` by `monthDelta` whole months, clamping the day into the
 * destination month (e.g. 31 Jan - 1 month -> 28/29 Feb). `dayOverride`
 * replaces the source day-of-month before clamping (used for "day 1 of the
 * month N months away"). */
function shiftMonthsClamped(value: string, monthDelta: number, dayOverride?: number): string {
  const { y, m, d } = parseISO(value);
  const totalMonths = y * 12 + (m - 1) + monthDelta;
  const newY = Math.floor(totalMonths / 12);
  const newM = totalMonths - newY * 12 + 1;
  const day = Math.min(dayOverride ?? d, daysInMonthUTC(newY, newM));
  return toISO(newY, newM, day);
}

/** Today's date in Africa/Algiers (fixed UTC+1), regardless of host TZ. */
export function todayLocal(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + ALGERIA_OFFSET_MS);
  return toISO(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** The Saturday that starts the week containing `isoDate` (A5: week starts Saturday). */
export function weekStart(isoDate: string): string {
  const { y, m, d } = parseISO(isoDate);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const isodow = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  const offset = (isodow + 1) % 7;
  return addDaysISO(isoDate, -offset);
}

export function presetPeriod(preset: PresetId, now?: Date): Period {
  const today = todayLocal(now);
  const { y, m } = parseISO(today);
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today, preset };
    case 'YESTERDAY': {
      const yest = addDaysISO(today, -1);
      return { from: yest, to: yest, preset };
    }
    case 'THIS_WEEK':
      return { from: weekStart(today), to: today, preset };
    case 'LAST_WEEK': {
      const start = weekStart(today);
      return { from: addDaysISO(start, -7), to: addDaysISO(start, -1), preset };
    }
    case 'THIS_MONTH':
      return { from: toISO(y, m, 1), to: today, preset };
    case 'LAST_MONTH': {
      const from = shiftMonthsClamped(today, -1, 1);
      const { y: py, m: pm } = parseISO(from);
      return { from, to: toISO(py, pm, daysInMonthUTC(py, pm)), preset };
    }
    case 'THIS_YEAR':
      return { from: toISO(y, 1, 1), to: today, preset };
    case 'CUSTOM':
      return { from: today, to: today, preset };
    default:
      return { from: today, to: today, preset: 'CUSTOM' };
  }
}

/** The comparable prior period, per report kind (plan §5.8). */
export function comparisonPeriod(p: Period): Period {
  switch (p.preset) {
    case 'TODAY':
    case 'YESTERDAY':
    case 'THIS_WEEK':
    case 'LAST_WEEK':
      return { from: addDaysISO(p.from, -7), to: addDaysISO(p.to, -7), preset: p.preset };
    case 'THIS_MONTH': {
      const { d: day } = parseISO(p.to);
      return {
        from: shiftMonthsClamped(p.from, -1, 1),
        to: shiftMonthsClamped(p.from, -1, day),
        preset: p.preset,
      };
    }
    case 'LAST_MONTH': {
      const from = shiftMonthsClamped(p.from, -1, 1);
      const { y, m } = parseISO(from);
      return { from, to: toISO(y, m, daysInMonthUTC(y, m)), preset: p.preset };
    }
    case 'THIS_YEAR': {
      const to = shiftMonthsClamped(p.to, -12);
      const { y } = parseISO(to);
      return { from: toISO(y, 1, 1), to, preset: p.preset };
    }
    case 'CUSTOM':
    default: {
      const span = daysBetweenISO(p.from, p.to) + 1;
      return { from: addDaysISO(p.from, -span), to: addDaysISO(p.from, -1), preset: p.preset };
    }
  }
}
