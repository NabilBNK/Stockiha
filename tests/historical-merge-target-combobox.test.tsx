import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  MergeTargetCombobox,
  filterMergeTargets,
  foldForSearch,
  type MergeTargetOption,
} from '../src/features/onboarding/MergeTargetCombobox';

/**
 * The merge-target picker replaces an 88-option native `<select>`. The end user
 * is a warehouse owner with no computer background reviewing ~90 rows in one
 * sitting, so BOTH interactions must work: keyboard only, and mouse only.
 */

const OPTIONS: MergeTargetOption[] = [
  { value: 'couette|ak home|istanbul 1p', label: 'couette · AK home · istanbul 1p' },
  { value: 'couette|ak home|istanbul 2p', label: 'couette · AK home · istanbul 2p' },
  { value: 'couette|ak home|iatanbul 1p', label: 'couette · AK home · iatanbul 1p' },
  { value: 'pillow cover|rozana|', label: 'pillow cover · rozana · —' },
  { value: 'drap housse|ak home|1.6', label: 'drap housse · AK home · 1.6' },
  { value: 'couette||blanc 2.4', label: 'couetté · — · blanc 2.4' },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <MergeTargetCombobox
        label="Regrouper avec"
        placeholder="Regrouper avec…"
        options={OPTIONS}
        value={value}
        onChange={setValue}
      />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('WS-G merge-target combobox', () => {
  it('folds accents and case so the owner can type without them', () => {
    expect(foldForSearch('Couetté')).toBe('couette');
    expect(foldForSearch('ISTANBUL')).toBe('istanbul');
  });

  it('matches every typed term in any order, and lists everything on an empty query', () => {
    expect(filterMergeTargets(OPTIONS, '')).toHaveLength(OPTIONS.length);
    expect(filterMergeTargets(OPTIONS, 'istanbul').map((o) => o.value)).toEqual([
      'couette|ak home|istanbul 1p',
      'couette|ak home|istanbul 2p',
    ]);
    // Terms in the "wrong" order still match.
    expect(filterMergeTargets(OPTIONS, '2p couette').map((o) => o.value)).toEqual([
      'couette|ak home|istanbul 2p',
    ]);
    // The accented label is reachable by typing plain letters.
    expect(filterMergeTargets(OPTIONS, 'couette blanc').map((o) => o.value)).toEqual([
      'couette||blanc 2.4',
    ]);
    expect(filterMergeTargets(OPTIONS, 'zzz')).toEqual([]);
  });

  it('is closed until the owner asks for it, and shows the whole list on a click', () => {
    render(<Harness />);
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.mouseDown(input());
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });

  it('picks an option with the mouse', () => {
    render(<Harness />);
    fireEvent.mouseDown(input());
    fireEvent.mouseDown(screen.getByText('pillow cover · rozana · —'));

    expect(screen.getByTestId('chosen').textContent).toBe('pillow cover|rozana|');
    expect(input().value).toBe('pillow cover · rozana · —');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters as the owner types, then picks with the arrow keys and Enter', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'istanbul' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    // aria-activedescendant is what a screen reader announces.
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-option-1$/);
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(screen.getByTestId('chosen').textContent).toBe('couette|ak home|istanbul 2p');
  });

  it('picks the single remaining match on Enter without arrowing to it', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'iatanbul' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('chosen').textContent).toBe('couette|ak home|iatanbul 1p');
  });

  it('says so in plain French when nothing matches, and chooses nothing', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'tapis persan' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Aucun article ne correspond/)).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('chosen').textContent).toBe('');
  });

  it('abandons a chosen target as soon as the owner types over it', () => {
    render(<Harness />);
    fireEvent.mouseDown(input());
    fireEvent.mouseDown(screen.getByText('drap housse · AK home · 1.6'));
    expect(screen.getByTestId('chosen').textContent).toBe('drap housse|ak home|1.6');

    fireEvent.change(input(), { target: { value: 'pillow' } });
    // Nothing is merged with a target the field no longer displays.
    expect(screen.getByTestId('chosen').textContent).toBe('');
  });

  it('closes on Escape and restores the chosen label', () => {
    render(<Harness />);
    fireEvent.mouseDown(input());
    fireEvent.mouseDown(screen.getByText('couette · AK home · istanbul 1p'));
    fireEvent.change(input(), { target: { value: 'dra' } });
    fireEvent.keyDown(input(), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    // The selection was already abandoned by typing, so the field goes back to
    // empty rather than pretending a choice is still in place.
    expect(screen.getByTestId('chosen').textContent).toBe('');
    expect(input().value).toBe('');
  });

  it('wraps around with ArrowUp from the top', () => {
    render(<Harness />);
    fireEvent.mouseDown(input());
    // Nothing highlighted yet: ArrowUp goes to the last option, not past it.
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toMatch(
      new RegExp(`-option-${OPTIONS.length - 1}$`),
    );
    // And from the last option it wraps back to the top.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-option-0$/);
  });

  it('jumps to the first and last option with Home and End', () => {
    render(<Harness />);
    fireEvent.mouseDown(input());
    fireEvent.keyDown(input(), { key: 'End' });
    expect(input().getAttribute('aria-activedescendant')).toMatch(
      new RegExp(`-option-${OPTIONS.length - 1}$`),
    );
    fireEvent.keyDown(input(), { key: 'Home' });
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-option-0$/);
  });
});
