/**
 * WS-D-8a — field-level commit-on-blur autosave.
 *
 * RULING 2 (binding). There is no save button. A field commits when the user
 * FINISHES with it — on blur, or on Enter — and NEVER on a keystroke, and
 * never on a keystroke debounce timer. That distinction is deliberate and must
 * not be "optimised" away: mid-typing a price from 2000.00 to 2500.00 passes
 * through the value "2", and a keystroke save writes 2 DZD to a live product.
 * The same class of bug applies to minimum stock, and worse to barcodes, which
 * are uniqueness-constrained.
 *
 * The single most important rule here: if a commit FAILS, the field reverts to
 * its last known-good server value AND surfaces the error. The UI must never
 * show a value the database does not hold.
 *
 * Values are exact decimal strings wherever they represent money or quantity.
 * This hook is string-in/string-out and never parses, rounds, or does
 * arithmetic on them (ws-d-skill.md section 6).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { useErrorText } from '../../shared/hooks/useErrorText';

/**
 * Registry every autosave field reports its dirty state into, so the
 * surrounding screen can tell whether an uncommitted edit is outstanding
 * before it swaps the record under the user (see ProductsWorkspace).
 */
export interface AutosaveDirtyRegistry {
  report: (id: string, dirty: boolean, label: string) => void;
}

export const AutosaveDirtyContext = createContext<AutosaveDirtyRegistry | null>(null);

/**
 * Owner side of the registry. `dirtyLabels` holds the labels of the fields
 * that currently hold an uncommitted edit, so a confirmation can name them
 * rather than saying "you have unsaved changes" and leaving the user guessing.
 */
export function useAutosaveDirtyTracker() {
  const entries = useRef(new Map<string, string>());
  const [dirtyLabels, setDirtyLabels] = useState<string[]>([]);

  const registry = useMemo<AutosaveDirtyRegistry>(
    () => ({
      report(id, dirty, label) {
        const map = entries.current;
        if (dirty) {
          if (map.get(id) === label) return;
          map.set(id, label);
        } else {
          if (!map.has(id)) return;
          map.delete(id);
        }
        setDirtyLabels([...map.values()]);
      },
    }),
    [],
  );

  const clear = useCallback(() => {
    entries.current.clear();
    setDirtyLabels([]);
  }, []);

  return { dirtyLabels, registry, clear };
}

export interface UseAutosaveFieldOptions {
  /** The authoritative value as the server currently holds it. */
  serverValue: string;
  /** Human label, used by the unsaved-changes confirmation. */
  label: string;
  /** Performs exactly one backend call. Must resolve only on success. */
  commit: (value: string) => Promise<void>;
  /** Returns a localized error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
  /** Applied before validating and committing (e.g. trimming). */
  normalize?: (value: string) => string;
}

export interface AutosaveField {
  value: string;
  setValue: (next: string) => void;
  /** True while the local value differs from the last known-good server value. */
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
  /** Commit handler for onBlur. */
  onBlur: () => void;
  /** Enter commits, Escape reverts. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Discards the local edit and returns to the last known-good value. */
  revert: () => void;
  /**
   * Commits an explicit value immediately. For controls that FINISH on change
   * rather than on blur — a <select>, a checkbox — where there is no partial
   * intermediate state to protect against.
   */
  commitValue: (next: string) => void;
}

export function useAutosaveField({
  serverValue,
  label,
  commit,
  validate,
  normalize,
}: UseAutosaveFieldOptions): AutosaveField {
  const errorText = useErrorText();
  const fieldId = useId();
  const registry = useContext(AutosaveDirtyContext);

  const [value, setValueState] = useState(serverValue);
  const [lastGood, setLastGood] = useState(serverValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== lastGood;

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(false);

  // Re-seed from the server whenever the authoritative value changes, unless
  // the user is mid-edit — an in-flight reload must never yank text out from
  // under them.
  useEffect(() => {
    if (dirtyRef.current || savingRef.current) return;
    setLastGood(serverValue);
    setValueState(serverValue);
    setError(null);
  }, [serverValue]);

  useEffect(() => {
    registry?.report(fieldId, dirty, label);
  }, [registry, fieldId, dirty, label]);

  useEffect(() => () => registry?.report(fieldId, false, label), [registry, fieldId, label]);

  const setValue = useCallback((next: string) => {
    setValueState(next);
    setSaved(false);
    setError(null);
  }, []);

  const revert = useCallback(() => {
    setValueState(lastGood);
    setSaved(false);
    setError(null);
  }, [lastGood]);

  const commitCandidate = useCallback(async (raw: string) => {
    if (savingRef.current) return;
    const candidate = normalize ? normalize(raw) : raw;

    if (candidate === lastGood) {
      // Nothing changed. Do not call the backend — a no-op commit is still a
      // round-trip that can fail, and an untouched field must cost zero IPC.
      if (candidate !== value) setValueState(candidate);
      setError(null);
      return;
    }

    const validationError = validate?.(candidate) ?? null;
    if (validationError) {
      // An invalid value is never sent. The field stays dirty so the user can
      // correct it rather than silently losing what they typed.
      setValueState(candidate);
      setError(validationError);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await commit(candidate);
      setLastGood(candidate);
      setValueState(candidate);
      setSaved(true);
    } catch (err) {
      // RULING 2, the load-bearing half: never leave the UI showing a value
      // the database does not hold.
      setValueState(lastGood);
      setSaved(false);
      setError(errorText(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [value, lastGood, normalize, validate, commit, errorText]);

  const commitNow = useCallback(() => commitCandidate(value), [commitCandidate, value]);

  const commitValue = useCallback(
    (next: string) => {
      setValueState(next);
      setSaved(false);
      void commitCandidate(next);
    },
    [commitCandidate],
  );

  const onBlur = useCallback(() => {
    void commitNow();
  }, [commitNow]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitNow();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        revert();
      }
    },
    [commitNow, revert],
  );

  return { value, setValue, dirty, saving, saved, error, onBlur, onKeyDown, revert, commitValue };
}
