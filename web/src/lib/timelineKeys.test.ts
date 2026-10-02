import { describe as group, expect, it } from 'vitest';
import type { KeyPress } from './shortcuts';
import {
  addsBox,
  clearsSelection,
  clipAction,
  isModifier,
  nudges,
  rulerSeek,
  selectsAll,
  skipsSnapping,
  startOrEnd,
  togglesSelection,
  zooms,
  type Modifiers,
} from './timelineKeys';

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

group('startOrEnd', () => {
  it('goes back to the start and forward to the end', () => {
    expect(startOrEnd('back', 200)).toBe(0);
    expect(startOrEnd('forward', 200)).toBe(200);
  });
});

group('nudges', () => {
  it('nudges a Take inside its Clip when dragged with Alt', () => {
    expect(nudges(held({ altKey: true }))).toBe(true);
  });

  it('moves the Clip when dragged without Alt', () => {
    expect(nudges(held())).toBe(false);
    expect(nudges(held({ shiftKey: true }))).toBe(false);
  });

  it('takes Alt only on its own', () => {
    expect(nudges(held({ altKey: true, shiftKey: true }))).toBe(false);
    expect(nudges(held({ altKey: true, ctrlKey: true }))).toBe(false);
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

  it('takes Mod only on its own, though a Ctrl wheel event zooms with any modifiers, as it may be a pinch', () => {
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

group('togglesSelection', () => {
  it('adds a Clip to the Selection, or takes it out, when clicked with Ctrl or ⌘', () => {
    expect(togglesSelection(held({ ctrlKey: true }))).toBe(true);
    expect(togglesSelection(held({ metaKey: true }))).toBe(true);
  });

  it('selects it alone when clicked without Mod', () => {
    expect(togglesSelection(held())).toBe(false);
    expect(togglesSelection(held({ shiftKey: true }))).toBe(false);
    expect(togglesSelection(held({ altKey: true }))).toBe(false);
  });

  it('takes Mod only on its own', () => {
    expect(togglesSelection(held({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(togglesSelection(held({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

group('clearsSelection', () => {
  it('clears the Selection on Esc', () => {
    expect(clearsSelection(press('Escape'))).toBe(true);
  });

  it('takes Esc only on its own', () => {
    expect(clearsSelection(press('Escape', { shiftKey: true }))).toBe(false);
    expect(clearsSelection(press('Escape', { ctrlKey: true }))).toBe(false);
  });

  it('leaves other keys alone', () => {
    expect(clearsSelection(press('Delete'))).toBe(false);
    expect(clearsSelection(press('a', { ctrlKey: true }))).toBe(false);
  });
});

group('selectsAll', () => {
  it('selects every Clip on Ctrl+A or ⌘A', () => {
    expect(selectsAll(press('a', { ctrlKey: true }))).toBe(true);
    expect(selectsAll(press('a', { metaKey: true }))).toBe(true);
    expect(selectsAll(press('A', { ctrlKey: true }))).toBe(true);
  });

  it('takes it only with Mod alone', () => {
    expect(selectsAll(press('a'))).toBe(false);
    expect(selectsAll(press('a', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(selectsAll(press('a', { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('leaves other keys alone', () => {
    expect(selectsAll(press('z', { ctrlKey: true }))).toBe(false);
  });
});

group('addsBox', () => {
  it('adds the Clips a box touches to the Selection when drawn with Ctrl or ⌘', () => {
    expect(addsBox(held({ ctrlKey: true }))).toBe(true);
    expect(addsBox(held({ metaKey: true }))).toBe(true);
  });

  it('replaces the Selection when drawn without Mod', () => {
    expect(addsBox(held())).toBe(false);
    expect(addsBox(held({ shiftKey: true }))).toBe(false);
    expect(addsBox(held({ altKey: true }))).toBe(false);
  });
});
