/**
 * WS-D-11 — panel size, persisted (R1, R2, R3).
 *
 * R1: the default width is proportional — `clamp(560px, 55vw, 1100px)`, set on
 * the `--sk-catalog2-panel` custom property in catalog2.css so one variable
 * still drives it. The floor is today's 560px; the ceiling is 1100px because
 * beyond that a single column of form fields turns into unreadable line
 * lengths.
 *
 * R2: dragging the panel's inline-start edge overrides that with an explicit
 * pixel width, stored in localStorage. This is the real Tauri app, not a
 * sandboxed artifact — AppShell.tsx already persists the theme the same way,
 * so this follows that pattern with its own keys.
 *
 * A stored value is ALWAYS clamped on read. A stale entry from a wider monitor,
 * a hand-edited value, or anything non-numeric must not be able to produce a
 * panel the user cannot resize back — which, since the drag handle lives on the
 * panel itself, would be unrecoverable without clearing site data.
 *
 * The pixel arithmetic here is layout, not money: `Number.parseInt` on a stored
 * width is fine. The exact-decimal discipline governs prices, quantities and
 * minimum stock, none of which appear in this file.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Today's fixed width becomes the floor. */
export const PANEL_MIN_WIDTH = 560;
export const PANEL_MAX_WIDTH = 1100;

/**
 * Below this the two columns cannot both be legible. Measured on the PANEL,
 * not the viewport: the panel is resizable, so a viewport media query would
 * answer the wrong question (R4).
 */
export const PANEL_TWO_COLUMN_MIN = 820;

const WIDTH_KEY = 'stockiha.catalog2.panelWidth';
const FULLSCREEN_KEY = 'stockiha.catalog2.panelFullScreen';

export function clampPanelWidth(value: number): number {
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    if (raw === null || raw.trim() === '') return null;
    const parsed = Number.parseInt(raw, 10);
    // Not a number at all -> fall back to the proportional default rather than
    // to some arbitrary pixel count.
    if (!Number.isFinite(parsed)) return null;
    return clampPanelWidth(parsed);
  } catch {
    // Storage can be unavailable; the proportional default still works.
    return null;
  }
}

function readStoredFullScreen(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export interface PanelLayout {
  /** null means "use the proportional default from CSS". */
  width: number | null;
  fullScreen: boolean;
  setWidth: (next: number) => void;
  toggleFullScreen: () => void;
}

export function usePanelLayout(): PanelLayout {
  const [width, setWidthState] = useState<number | null>(readStoredWidth);
  const [fullScreen, setFullScreenState] = useState<boolean>(readStoredFullScreen);

  const setWidth = useCallback((next: number) => {
    const clamped = clampPanelWidth(next);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // A width that cannot be persisted still applies for this session.
    }
  }, []);

  const toggleFullScreen = useCallback(() => {
    setFullScreenState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(FULLSCREEN_KEY, String(next));
      } catch {
        // Same: the toggle still works, it just will not be remembered.
      }
      return next;
    });
  }, []);

  return { width, fullScreen, setWidth, toggleFullScreen };
}

/**
 * The observed width of an element, or null when it cannot be measured.
 *
 * jsdom implements no ResizeObserver, so tests get null and the caller treats
 * that as "wide enough for two columns" — the same guarded-capability shape
 * the workspace uses for matchMedia.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (typeof measured === 'number') setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
