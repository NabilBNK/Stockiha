import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * WS-G — the "regrouper avec…" picker on the historical product-mapping screen.
 *
 * Why this exists instead of a plain `<select>`: the customer's paper book has
 * ~90 distinct descriptions, so a native dropdown forces the owner to eyeball
 * an 88-item list on every one of ~90 rows. Typing three letters is the only
 * workable interaction for someone reviewing the whole book in one sitting.
 *
 * It is a plain `<input>` plus a filtered listbox — no new dependency. A
 * headless combobox library (downshift, react-select, @headlessui/react) would
 * add 15-60 kB and a React-version constraint to an offline Windows desktop
 * bundle for behaviour that is ~120 lines here, so it was rejected.
 *
 * Keyboard: type to filter, ArrowDown/ArrowUp to move, Home/End to jump, Enter
 * to pick, Escape to close. Mouse: click to open, click to pick. Both are
 * required — the end user is a warehouse owner with no computer background.
 */

export interface MergeTargetOption {
  /** The normalized key PostgreSQL knows this description by. */
  value: string;
  /** What the owner reads, e.g. `couette · AK home · istanbul 1p`. */
  label: string;
}

interface Props {
  /** Visually hidden label text. */
  label: string;
  placeholder: string;
  options: readonly MergeTargetOption[];
  /** Currently chosen option value, or `''` for none. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Lowercases and strips accents so `couette` matches `Couetté`. The owner types
 * without accents; the transcription often has them.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Every option whose label contains all of the whitespace-separated terms the
 * owner typed, in any order. An empty query matches everything, so clicking the
 * field shows the full list exactly like the old dropdown did.
 */
export function filterMergeTargets(
  options: readonly MergeTargetOption[],
  query: string,
): MergeTargetOption[] {
  const terms = foldForSearch(query).split(/\s+/).filter((term) => term !== '');
  if (terms.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = foldForSearch(option.label);
    return terms.every((term) => haystack.includes(term));
  });
}

export function MergeTargetCombobox({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
}: Props) {
  const reactId = useId();
  const inputId = `merge-combobox-${reactId}`;
  const listboxId = `merge-listbox-${reactId}`;

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? '',
    [options, value],
  );

  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // A decision applied elsewhere reloads the table; the field must follow the
  // value it is given rather than keep stale text.
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const matches = useMemo(
    // Once a choice is made the field shows its full label; re-filtering on it
    // would leave a one-item list, so an untouched field lists everything.
    () => filterMergeTargets(options, query === selectedLabel ? '' : query),
    [options, query, selectedLabel],
  );

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  // Clicking anywhere else closes the list. `mousedown` so the click that
  // selects an option is not swallowed by an early close.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setQuery(selectedLabel);
        close();
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [open, close, selectedLabel]);

  // Keep the highlighted row inside the scrollable list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const option = list?.children[activeIndex] as HTMLElement | undefined;
    // `scrollIntoView` is absent in some DOM implementations; keeping the
    // highlight visible is a nicety, never a requirement for selecting.
    if (typeof option?.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  const commit = useCallback(
    (option: MergeTargetOption) => {
      onChange(option.value);
      setQuery(option.label);
      close();
    },
    [onChange, close],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(matches.length > 0 ? 0 : -1);
          return;
        }
        if (matches.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = (activeIndex + step + matches.length) % matches.length;
        setActiveIndex(activeIndex < 0 && step === -1 ? matches.length - 1 : next);
        return;
      }
      case 'Home':
        if (open && matches.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        return;
      case 'End':
        if (open && matches.length > 0) {
          event.preventDefault();
          setActiveIndex(matches.length - 1);
        }
        return;
      case 'Enter': {
        if (!open) return;
        // A single remaining match is picked even without arrowing to it: the
        // owner typed enough to identify it.
        const chosen = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
        if (chosen) {
          event.preventDefault();
          commit(chosen);
        }
        return;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          setQuery(selectedLabel);
          close();
        }
        return;
      default:
        return;
    }
  };

  const activeOptionId =
    open && activeIndex >= 0 && matches[activeIndex]
      ? `${listboxId}-option-${activeIndex}`
      : undefined;

  return (
    <div className="sk-combobox" ref={wrapperRef}>
      <label className="sk-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="sk-combobox__input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
          // Typing over a choice abandons it until a new one is picked, so the
          // "Regrouper" button cannot act on a target the field no longer shows.
          if (value !== '') onChange('');
        }}
        onMouseDown={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="sk-combobox__list" id={listboxId} role="listbox" ref={listRef}>
          {matches.length === 0 ? (
            <li className="sk-combobox__empty" role="presentation">
              Aucun article ne correspond à ce que vous avez tapé.
            </li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={
                  index === activeIndex
                    ? 'sk-combobox__option sk-combobox__option--active'
                    : 'sk-combobox__option'
                }
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // Keep focus on the input so the field stays usable.
                  event.preventDefault();
                  commit(option);
                }}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
