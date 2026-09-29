import { describe as group, expect, it } from 'vitest';
import { pickerKey, typeahead } from './picker';

group('pickerKey', () => {
  const closed = { open: false, active: -1, count: 4 };

  it('opens the list on ↓, ↑, Enter and Space', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      expect(pickerKey(key, false, closed)).toEqual({ kind: 'open' });
    }
    expect(pickerKey('ArrowDown', true, closed)).toEqual({ kind: 'open' });
  });

  it('opens the list on the first or last option on Home and End', () => {
    expect(pickerKey('Home', false, closed)).toEqual({ kind: 'open', index: 0 });
    expect(pickerKey('End', false, closed)).toEqual({ kind: 'open', index: 3 });
  });

  it('leaves other keys alone when the list is closed, e.g. Escape and Tab', () => {
    expect(pickerKey('Escape', false, closed)).toBeNull();
    expect(pickerKey('Tab', false, closed)).toBeNull();
    expect(pickerKey('a', false, closed)).toBeNull();
  });

  it('moves the highlight down and up from the current option, wrapping round', () => {
    expect(pickerKey('ArrowDown', false, { open: true, active: 3, count: 4 })).toEqual({ kind: 'highlight', index: 0 });
    expect(pickerKey('ArrowDown', false, { open: true, active: 1, count: 4 })).toEqual({ kind: 'highlight', index: 2 });
    expect(pickerKey('ArrowUp', false, { open: true, active: 0, count: 4 })).toEqual({ kind: 'highlight', index: 3 });
    expect(pickerKey('ArrowUp', false, { open: true, active: 2, count: 4 })).toEqual({ kind: 'highlight', index: 1 });
  });

  it('starts from the first or last option when none is highlighted', () => {
    expect(pickerKey('ArrowDown', false, { open: true, active: -1, count: 3 })).toEqual({ kind: 'highlight', index: 0 });
    expect(pickerKey('ArrowUp', false, { open: true, active: -1, count: 3 })).toEqual({ kind: 'highlight', index: 2 });
  });

  it('highlights the first or last option on Home and End', () => {
    expect(pickerKey('Home', false, { open: true, active: 2, count: 4 })).toEqual({ kind: 'highlight', index: 0 });
    expect(pickerKey('End', false, { open: true, active: 0, count: 4 })).toEqual({ kind: 'highlight', index: 3 });
  });

  it('picks the highlighted option on Enter, Space and Alt+↑', () => {
    expect(pickerKey('Enter', false, { open: true, active: 2, count: 4 })).toEqual({ kind: 'pick', index: 2 });
    expect(pickerKey(' ', false, { open: true, active: 1, count: 4 })).toEqual({ kind: 'pick', index: 1 });
    expect(pickerKey('ArrowUp', true, { open: true, active: 0, count: 4 })).toEqual({ kind: 'pick', index: 0 });
  });

  it('closes without a change on Enter or Space with nothing highlighted', () => {
    expect(pickerKey('Enter', false, { open: true, active: -1, count: 4 })).toEqual({ kind: 'close' });
    expect(pickerKey(' ', false, { open: true, active: -1, count: 4 })).toEqual({ kind: 'close' });
  });

  it('closes without a change on Escape and Tab', () => {
    expect(pickerKey('Escape', false, { open: true, active: 1, count: 4 })).toEqual({ kind: 'close' });
    expect(pickerKey('Tab', false, { open: true, active: 1, count: 4 })).toEqual({ kind: 'close' });
  });

  it('leaves other keys alone when the list is open, e.g. letters for typeahead', () => {
    expect(pickerKey('a', false, { open: true, active: 1, count: 4 })).toBeNull();
  });
});

group('typeahead', () => {
  const labels = ['Any', 'Metro', 'Mike Dean', 'Madlib', 'Pharrell'];

  it('finds the first option starting with a letter, ignoring case', () => {
    expect(typeahead(labels, 'p', 0)).toBe(4);
    expect(typeahead(labels, 'P', -1)).toBe(4);
  });

  it('moves on to the next option with the same letter, wrapping round', () => {
    expect(typeahead(labels, 'm', 0)).toBe(1);
    expect(typeahead(labels, 'm', 1)).toBe(2);
    expect(typeahead(labels, 'm', 2)).toBe(3);
    expect(typeahead(labels, 'm', 3)).toBe(1);
  });

  it('cycles through the same letter typed again and again', () => {
    expect(typeahead(labels, 'mm', 1)).toBe(2);
    expect(typeahead(labels, 'mmm', 2)).toBe(3);
  });

  it('keeps the current option while it still matches what is typed', () => {
    expect(typeahead(labels, 'mi', 2)).toBe(2);
    expect(typeahead(labels, 'ma', 1)).toBe(3);
  });

  it('matches what is typed as a whole, e.g. a word with a space', () => {
    expect(typeahead(labels, 'mike d', 0)).toBe(2);
  });

  it('is -1 when no option starts with what is typed', () => {
    expect(typeahead(labels, 'z', 0)).toBe(-1);
    expect(typeahead(labels, 'mz', 1)).toBe(-1);
  });
});
