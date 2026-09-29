import { describe as group, expect, it } from 'vitest';
import { comboboxKey, filterOptions, optionIndex, popoverTop } from './combobox';

const labels = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Hook'];

group('filterOptions', () => {
  it('offers every option before anything is typed, whatever the value', () => {
    expect(filterOptions(labels, null)).toEqual(labels);
  });

  it('keeps the options containing what was typed, ignoring case', () => {
    expect(filterOptions(labels, 'cho')).toEqual(['Pre-Chorus', 'Chorus', 'Post-Chorus']);
    expect(filterOptions(labels, 'HOOK')).toEqual(['Hook']);
  });

  it('ignores spaces around what was typed', () => {
    expect(filterOptions(labels, '  verse ')).toEqual(['Verse']);
  });

  it('offers every option once what was typed is cleared', () => {
    expect(filterOptions(labels, '')).toEqual(labels);
  });

  it('offers nothing when nothing matches', () => {
    expect(filterOptions(labels, 'Refrain')).toEqual([]);
  });
});

group('optionIndex', () => {
  it('finds the option matching a value, ignoring case and spaces around it', () => {
    expect(optionIndex(labels, 'Hook')).toBe(5);
    expect(optionIndex(labels, ' chorus ')).toBe(3);
  });

  it('is -1 when no option matches, e.g. a free-text value', () => {
    expect(optionIndex(labels, 'Verse 2')).toBe(-1);
    expect(optionIndex(labels, '')).toBe(-1);
  });
});

group('comboboxKey', () => {
  const closed = { open: false, active: -1, count: 0 };

  it('opens the list on ↓ and Alt+↓', () => {
    expect(comboboxKey('ArrowDown', false, closed)).toEqual({ kind: 'open' });
    expect(comboboxKey('ArrowDown', true, closed)).toEqual({ kind: 'open' });
  });

  it('reverts on Escape when the list is closed', () => {
    expect(comboboxKey('Escape', false, closed)).toEqual({ kind: 'revert' });
  });

  it('leaves other keys alone when the list is closed, e.g. Enter to save typed text', () => {
    expect(comboboxKey('Enter', false, closed)).toBeNull();
    expect(comboboxKey('ArrowUp', false, closed)).toBeNull();
    expect(comboboxKey('a', false, closed)).toBeNull();
  });

  it('moves the highlight down and up from the current option, wrapping round', () => {
    expect(comboboxKey('ArrowDown', false, { open: true, active: 5, count: 6 })).toEqual({ kind: 'highlight', index: 0 });
    expect(comboboxKey('ArrowDown', false, { open: true, active: 1, count: 6 })).toEqual({ kind: 'highlight', index: 2 });
    expect(comboboxKey('ArrowUp', false, { open: true, active: 0, count: 6 })).toEqual({ kind: 'highlight', index: 5 });
    expect(comboboxKey('ArrowUp', false, { open: true, active: 3, count: 6 })).toEqual({ kind: 'highlight', index: 2 });
  });

  it('starts from the first or last option when none is highlighted', () => {
    expect(comboboxKey('ArrowDown', false, { open: true, active: -1, count: 3 })).toEqual({ kind: 'highlight', index: 0 });
    expect(comboboxKey('ArrowUp', false, { open: true, active: -1, count: 3 })).toEqual({ kind: 'highlight', index: 2 });
  });

  it('closes on Alt+↑ and Escape', () => {
    expect(comboboxKey('ArrowUp', true, { open: true, active: 1, count: 3 })).toEqual({ kind: 'close' });
    expect(comboboxKey('Escape', false, { open: true, active: 1, count: 3 })).toEqual({ kind: 'close' });
  });

  it('picks the highlighted option on Enter', () => {
    expect(comboboxKey('Enter', false, { open: true, active: 2, count: 3 })).toEqual({ kind: 'pick', index: 2 });
  });

  it('closes on Enter with nothing highlighted, leaving the typed text to be saved', () => {
    expect(comboboxKey('Enter', false, { open: true, active: -1, count: 3 })).toEqual({ kind: 'close' });
  });

  it('leaves typing to the field', () => {
    expect(comboboxKey('a', false, { open: true, active: 1, count: 3 })).toBeNull();
    expect(comboboxKey('Home', false, { open: true, active: 1, count: 3 })).toBeNull();
  });
});

group('popoverTop', () => {
  const field = { top: 500, bottom: 536 };

  it('places the list under the field when there is room', () => {
    expect(popoverTop(field, 200, 800, 4)).toBe(540);
  });

  it('flips it over the field when there is no room below', () => {
    expect(popoverTop(field, 200, 600, 4)).toBe(296);
  });

  it('keeps it on screen when there is no room either way', () => {
    expect(popoverTop({ top: 100, bottom: 136 }, 200, 300, 4)).toBe(4);
  });
});
