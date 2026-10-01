import { describe as group, expect, it } from 'vitest';
import type { KeyPress } from './shortcuts';
import { clipAction, isModifier, rulerSeek, skipsSnapping, slips, zooms, type Modifiers } from './timelineKeys';

const held = (mods: Partial<Modifiers> = {}): Modifiers => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const press = (key: string, mods: Partial<Modifiers> = {}): KeyPress => ({ key, ...held(mods) });

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

  it('takes each key only with its exact modifiers', () => {
    expect(clipAction(press('Backspace', { ctrlKey: true }))).toBeNull();
    expect(clipAction(press('Delete', { shiftKey: true }))).toBeNull();
    expect(clipAction(press('ContextMenu', { altKey: true }))).toBeNull();
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

  it('takes each key only with its exact modifiers', () => {
    expect(rulerSeek(press('ArrowLeft', { ctrlKey: true }), position, length)).toBeNull();
    expect(rulerSeek(press('ArrowRight', { altKey: true }), position, length)).toBeNull();
    expect(rulerSeek(press('ArrowUp', { metaKey: true, shiftKey: true }), position, length)).toBeNull();
    expect(rulerSeek(press('Home', { shiftKey: true }), position, length)).toBeNull();
    expect(rulerSeek(press('End', { ctrlKey: true }), position, length)).toBeNull();
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

  it('takes Alt only on its own', () => {
    expect(slips(held({ altKey: true, shiftKey: true }))).toBe(false);
    expect(slips(held({ altKey: true, ctrlKey: true }))).toBe(false);
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

  it('takes Shift only on its own', () => {
    expect(skipsSnapping(held({ shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(skipsSnapping(held({ shiftKey: true, altKey: true }))).toBe(false);
  });
});

group('zooms', () => {
  it('zooms on Mod+wheel, as Ctrl+wheel or ⌘+wheel, on every platform', () => {
    expect(zooms(held({ ctrlKey: true }))).toBe(true);
    expect(zooms(held({ metaKey: true }))).toBe(true);
  });

  it('leaves the wheel without Mod to scroll', () => {
    expect(zooms(held())).toBe(false);
    expect(zooms(held({ shiftKey: true }))).toBe(false);
    expect(zooms(held({ altKey: true }))).toBe(false);
  });

  it('takes Mod only on its own, a pinch aside', () => {
    expect(zooms(held({ metaKey: true, altKey: true }))).toBe(false);
    expect(zooms(held({ metaKey: true, shiftKey: true }))).toBe(false);
  });

  it('zooms on the keys given for it', () => {
    const altWheel = [{ key: 'wheel', alt: true }];
    expect(zooms(held({ altKey: true }), altWheel)).toBe(true);
    expect(zooms(held({ shiftKey: true }), altWheel)).toBe(false);
  });

  it('zooms on a pinch, which a browser sends as a Ctrl wheel event, whatever the keys given for it', () => {
    expect(zooms(held({ ctrlKey: true }), [{ key: 'wheel', alt: true }])).toBe(true);
    expect(zooms(held({ ctrlKey: true, altKey: true }))).toBe(true);
  });
});

group('isModifier', () => {
  it('tells the modifiers from other keys', () => {
    for (const key of ['Shift', 'Alt', 'Control', 'Meta']) expect(isModifier(key)).toBe(true);
    expect(isModifier('a')).toBe(false);
    expect(isModifier('Escape')).toBe(false);
  });
});
