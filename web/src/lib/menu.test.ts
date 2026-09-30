import { describe as group, expect, it } from 'vitest';
import { fieldStep, menuKey, opensMenu } from './menu';

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

group('fieldStep', () => {
  const keys = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false };
  const field = { step: 1, shiftStep: 10 };

  it('steps with Alt+Left and Alt+Right, by more with Shift', () => {
    expect(fieldStep({ ...keys, key: 'ArrowLeft' }, 5, field)).toBe(4);
    expect(fieldStep({ ...keys, key: 'ArrowRight' }, 5, field)).toBe(6);
    expect(fieldStep({ ...keys, key: 'ArrowLeft', shiftKey: true }, 5, field)).toBe(-5);
    expect(fieldStep({ ...keys, key: 'ArrowRight', shiftKey: true }, 5, field)).toBe(15);
  });

  it('leaves arrows without Alt, or with Ctrl, and other keys, to the field', () => {
    expect(fieldStep({ ...keys, key: 'ArrowLeft', altKey: false }, 5, field)).toBeNull();
    expect(fieldStep({ ...keys, key: 'ArrowRight', ctrlKey: true }, 5, field)).toBeNull();
    expect(fieldStep({ ...keys, key: 'ArrowUp' }, 5, field)).toBeNull();
  });
});

group('opensMenu', () => {
  const keys = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

  it('opens on the Menu key and Shift+F10, as a context menu does', () => {
    expect(opensMenu({ ...keys, key: 'ContextMenu' })).toBe(true);
    expect(opensMenu({ ...keys, key: 'F10', shiftKey: true })).toBe(true);
  });

  it('leaves F10 alone, and other keys', () => {
    expect(opensMenu({ ...keys, key: 'F10' })).toBe(false);
    expect(opensMenu({ ...keys, key: 'F10', shiftKey: true, ctrlKey: true })).toBe(false);
    expect(opensMenu({ ...keys, key: 'Enter' })).toBe(false);
  });
});
