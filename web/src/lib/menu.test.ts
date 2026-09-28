import { describe as group, expect, it } from 'vitest';
import { menuKey } from './menu';

group('menuKey', () => {
  it('moves down and up through the entries, wrapping round', () => {
    expect(menuKey('ArrowDown', 0, 3)).toBe(1);
    expect(menuKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuKey('ArrowUp', 1, 3)).toBe(0);
    expect(menuKey('ArrowUp', 0, 3)).toBe(2);
  });

  it('jumps to the first and last entries', () => {
    expect(menuKey('Home', 2, 3)).toBe(0);
    expect(menuKey('End', 0, 3)).toBe(2);
  });

  it('starts from the first or last entry when none has focus', () => {
    expect(menuKey('ArrowDown', -1, 3)).toBe(0);
    expect(menuKey('ArrowUp', -1, 3)).toBe(2);
  });

  it('closes the menu on Escape and Tab', () => {
    expect(menuKey('Escape', 1, 3)).toBe('close');
    expect(menuKey('Tab', 1, 3)).toBe('close');
  });

  it('ignores other keys', () => {
    expect(menuKey('a', 1, 3)).toBeNull();
    expect(menuKey('Enter', 1, 3)).toBeNull();
  });
});
