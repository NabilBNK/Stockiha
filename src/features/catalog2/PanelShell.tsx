/**
 * WS-D-11 — the slide-in panel chrome, shared by edit and create mode.
 *
 * R1/R2/R3. The panel is proportionally wide by default, draggable by its
 * inline-start edge, and has a full-screen toggle; width and mode persist. All
 * placement is logical (`inset-inline-*`), so in Arabic the panel enters from
 * the left and the drag edge and expand control mirror with it.
 *
 * The drag handle is a real focusable `separator` with arrow-key support, not a
 * mouse-only affordance: a resize that can only be performed by dragging is
 * unusable by keyboard and invisible to assistive technology. ArrowLeft and
 * ArrowRight move the EDGE in that screen direction, so which one grows the
 * panel flips with the document direction — matching what the user sees rather
 * than an abstract "grow/shrink" mapping.
 *
 * The measured panel width is published through context because the columns
 * inside it need to know whether two fit, and that is a question about the
 * panel, not the viewport (R4).
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { Button } from '../../shared/components';
import { useI18n } from '../../shared/i18n';
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_TWO_COLUMN_MIN,
  useElementWidth,
  usePanelLayout,
} from './usePanelLayout';

/** How far one arrow-key press moves the edge. */
const KEYBOARD_STEP = 32;

interface PanelLayoutContextValue {
  /** True when the panel is too narrow to show its two columns side by side. */
  narrow: boolean;
}

const PanelLayoutContext = createContext<PanelLayoutContextValue>({ narrow: false });

export function usePanelNarrow(): boolean {
  return useContext(PanelLayoutContext).narrow;
}

export function PanelShell({
  title,
  onClose,
  children,
  overlays,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  overlays?: ReactNode;
}) {
  const { t } = useI18n();
  const { width, fullScreen, setWidth, toggleFullScreen } = usePanelLayout();

  const panelRef = useRef<HTMLElement | null>(null);
  const measured = useElementWidth(panelRef);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  // What the panel is actually this wide right now, for seeding a drag and for
  // aria-valuenow. Falls back to the floor when nothing can be measured.
  const effectiveWidth = width ?? measured ?? PANEL_MIN_WIDTH;

  // Two columns are assumed until something says otherwise: jsdom cannot
  // measure, and a test seeing one column would be measuring the harness.
  const narrow = !fullScreen && measured !== null && measured < PANEL_TWO_COLUMN_MIN;

  const isRtl = typeof document !== 'undefined'
    && document.documentElement.getAttribute('dir') === 'rtl';

  /** Screen-space delta -> width delta. The handle is on the inline-start edge. */
  const growthSign = isRtl ? 1 : -1;

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullScreen) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelRef.current?.getBoundingClientRect().width ?? effectiveWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [fullScreen, effectiveWidth]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setWidth(drag.startWidth + (event.clientX - drag.startX) * growthSign);
  }, [setWidth, growthSign]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (fullScreen) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setWidth(effectiveWidth + KEYBOARD_STEP * (isRtl ? -1 : 1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setWidth(effectiveWidth + KEYBOARD_STEP * (isRtl ? 1 : -1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setWidth(PANEL_MAX_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setWidth(PANEL_MIN_WIDTH);
    }
  }, [fullScreen, setWidth, effectiveWidth, isRtl]);

  // Only an explicit width overrides the proportional default from CSS.
  const style = width != null
    ? ({ ['--sk-catalog2-panel']: `${width}px` } as CSSProperties)
    : undefined;

  return (
    <PanelLayoutContext.Provider value={{ narrow }}>
      <button
        type="button"
        className="sk-catalog2__panel-backdrop"
        aria-label={t('common.close')}
        onClick={onClose}
        data-testid="catalog2-panel-backdrop"
      />
      <aside
        ref={panelRef}
        className={`sk-catalog2__panel${fullScreen ? ' sk-catalog2__panel--full' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        style={style}
        data-panel-width={width ?? ''}
        data-panel-fullscreen={fullScreen ? 'true' : 'false'}
        data-testid="catalog2-panel"
      >
        {fullScreen ? null : (
          <div
            className="sk-catalog2__panel-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('catalog2.resizePanel')}
            aria-valuenow={Math.round(effectiveWidth)}
            aria-valuemin={PANEL_MIN_WIDTH}
            aria-valuemax={PANEL_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            data-testid="catalog2-panel-resize"
          />
        )}

        <div className="sk-catalog2__panel-header">
          <h2 className="sk-catalog2__panel-title sk-catalog2__truncate" title={title}>{title}</h2>
          <div className="sk-catalog2__actions">
            <Button
              variant="secondary"
              type="button"
              onClick={toggleFullScreen}
              aria-pressed={fullScreen}
              data-testid="catalog2-panel-fullscreen"
            >
              {fullScreen ? t('catalog2.collapsePanel') : t('catalog2.expandPanel')}
            </Button>
            <Button variant="secondary" type="button" onClick={onClose} data-testid="catalog2-panel-close">
              {t('common.close')}
            </Button>
          </div>
        </div>

        {children}
      </aside>
      {overlays}
    </PanelLayoutContext.Provider>
  );
}
