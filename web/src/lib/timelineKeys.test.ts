import { describe as group, expect, it } from 'vitest';
import type { KeyPress } from './shortcuts';
import { clipAction, rulerSeek, skipsSnapping, slips, zooms, type Modifiers } from './timelineKeys';

const press = (key: string, mods: Partial<Modifiers> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const held = (mods: Partial<Modifiers> = {}): Modifiers => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

group('clipAction', () => {
  it('deletes the Clip on Delete and Backspace', () => {
    expect(clipAction(press('Delete'))).toBe('delete');
    expect(clipAction(press('Backspace'))).toBe('delete');
  });

  it("opens the Clip's menu on the Menu key and Shift+F10", () => {
    expect(clipAction(press('ContextMenu'))).toBe('menu');
    expect(clipAction(press('F10', { shiftKey: true }))).toBe('menu');
  });

  it('leaves other keys alone', () => {
    expect(clipAction(press('F10'))).toBeNull();
    expect(clipAction(press('Enter'))).toBeNull();
    expect(clipAction(press('d'))).toBeNull();
  });
});

group('rulerSeek', () => {
  const position = 60;
  const length = 200;

  it('seeks 5 s back on ← and ↓, and forward on → and ↑', () => {
    expect(rulerSeek(press('ArrowLeft'), position, length)).toBe(55);
    expect(rulerSeek(press('ArrowDown'), position, length)).toBe(55);
    expect(rulerSeek(press('ArrowRight'), position, length)).toBe(65);
    expect(rulerSeek(press('ArrowUp'), position, length)).toBe(65);
  });

  it('seeks 15 s with Shift', () => {
    expect(rulerSeek(press('ArrowLeft', { shiftKey: true }), position, length)).toBe(45);
    expect(rulerSeek(press('ArrowDown', { shiftKey: true }), position, length)).toBe(45);
    expect(rulerSeek(press('ArrowRight', { shiftKey: true }), position, length)).toBe(75);
    expect(rulerSeek(press('ArrowUp', { shiftKey: true }), position, length)).toBe(75);
  });

  it('goes to the start on Home and the end on End', () => {
    expect(rulerSeek(press('Home'), position, length)).toBe(0);
    expect(rulerSeek(press('End'), position, length)).toBe(200);
  });

  it('leaves other keys alone', () => {
    expect(rulerSeek(press('Enter'), position, length)).toBeNull();
    expect(rulerSeek(press(' '), position, length)).toBeNull();
    expect(rulerSeek(press('PageUp'), position, length)).toBeNull();
  });
});

group('slips', () => {
  it('slips a Take inside its Clip when dragged with Alt', () => {
    expect(slips(held({ altKey: true }))).toBe(true);
  });

  it('moves the Clip when dragged without Alt', () => {
    expect(slips(held())).toBe(false);
    expect(slips(held({ shiftKey: true }))).toBe(false);
  });
});

group('skipsSnapping', () => {
  it('skips snapping while Shift is held', () => {
    expect(skipsSnapping(held({ shiftKey: true }))).toBe(true);
  });

  it('snaps without Shift', () => {
    expect(skipsSnapping(held())).toBe(false);
    expect(skipsSnapping(held({ altKey: true }))).toBe(false);
  });
});

group('zooms', () => {
  it('zooms on Ctrl+wheel, which is what a trackpad pinch sends', () => {
    expect(zooms(held({ ctrlKey: true }))).toBe(true);
  });

  it('leaves the wheel without Ctrl to scroll', () => {
    expect(zooms(held())).toBe(false);
    expect(zooms(held({ shiftKey: true }))).toBe(false);
    expect(zooms(held({ altKey: true }))).toBe(false);
  });
});
