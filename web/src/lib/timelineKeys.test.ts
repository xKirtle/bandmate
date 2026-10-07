import { describe as group, expect, it } from 'vitest';
import type { KeyDown } from './shortcuts';
import {
  addsBox,
  isModifier,
  nudges,
  rulerSeek,
  skipsSnapping,
  startOrEnd,
  timelineKey,
  togglesSelection,
  zooms,
  type Modifiers,
  type TimelineKeyContext,
} from './timelineKeys';

const held = (mods: Partial<Modifiers> = {}): Modifiers => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const press = (key: string, mods: Partial<Omit<KeyDown, 'key'>> = {}): KeyDown => ({
  key,
  ...held(),
  repeat: false,
  defaultPrevented: false,
  ...mods,
});

group('rulerSeek', () => {
  const position = 60;

  it('seeks 5 s back on ← and ↓, and forward on → and ↑', () => {
    expect(rulerSeek(press('ArrowLeft'), position)).toBe(55);
    expect(rulerSeek(press('ArrowDown'), position)).toBe(55);
    expect(rulerSeek(press('ArrowRight'), position)).toBe(65);
    expect(rulerSeek(press('ArrowUp'), position)).toBe(65);
  });

  it('seeks 15 s with Shift', () => {
    expect(rulerSeek(press('ArrowLeft', { shiftKey: true }), position)).toBe(45);
    expect(rulerSeek(press('ArrowDown', { shiftKey: true }), position)).toBe(45);
    expect(rulerSeek(press('ArrowRight', { shiftKey: true }), position)).toBe(75);
    expect(rulerSeek(press('ArrowUp', { shiftKey: true }), position)).toBe(75);
  });

  it('leaves Home and End to the Song-wide Shortcut', () => {
    expect(rulerSeek(press('Home'), position)).toBeNull();
    expect(rulerSeek(press('End'), position)).toBeNull();
  });

  it('leaves other keys alone', () => {
    expect(rulerSeek(press('Enter'), position)).toBeNull();
    expect(rulerSeek(press(' '), position)).toBeNull();
    expect(rulerSeek(press('PageUp'), position)).toBeNull();
  });

  it('takes each key only with its exact modifiers', () => {
    expect(rulerSeek(press('ArrowLeft', { ctrlKey: true }), position)).toBeNull();
    expect(rulerSeek(press('ArrowRight', { altKey: true }), position)).toBeNull();
    expect(rulerSeek(press('ArrowUp', { metaKey: true, shiftKey: true }), position)).toBeNull();
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

group('timelineKey', () => {
  // A Timeline at rest on desktop: editable, not frozen, two Clips selected, none focused.
  const idle: TimelineKeyContext = {
    inTextField: false,
    inMenuOrDialog: false,
    editable: true,
    freeze: null,
    selected: 2,
    focusedClip: null,
    draggingTrack: false,
  };

  group('Esc', () => {
    it('clears the Selection', () => {
      expect(timelineKey(press('Escape'), idle)).toBe('clearSelection');
    });

    it('is taken only on its own', () => {
      expect(timelineKey(press('Escape', { shiftKey: true }), idle)).toBeNull();
      expect(timelineKey(press('Escape', { ctrlKey: true }), idle)).toBeNull();
    });

    it('is left alone with nothing selected', () => {
      expect(timelineKey(press('Escape'), { ...idle, selected: 0 })).toBeNull();
    });

    it('is left to a text field, a menu or a dialog, or to a Track dragged, which it cancels', () => {
      expect(timelineKey(press('Escape'), { ...idle, inTextField: true })).toBeNull();
      expect(timelineKey(press('Escape'), { ...idle, inMenuOrDialog: true })).toBeNull();
      expect(timelineKey(press('Escape'), { ...idle, draggingTrack: true })).toBeNull();
    });

    it('is left alone once handled', () => {
      expect(timelineKey(press('Escape', { defaultPrevented: true }), idle)).toBeNull();
    });

    it('is taken in Read mode or on a phone too', () => {
      expect(timelineKey(press('Escape'), { ...idle, editable: false })).toBe('clearSelection');
    });

    it('is taken while recording or merging, leaving the frozen Selection as it is', () => {
      expect(timelineKey(press('Escape'), { ...idle, freeze: 'recording' })).toBe('clearSelection');
      expect(timelineKey(press('Escape'), { ...idle, freeze: 'merging' })).toBe('clearSelection');
    });

    it('clears the Selection from a focused Clip, in it or not', () => {
      expect(timelineKey(press('Escape'), { ...idle, focusedClip: { inSelection: true } })).toBe('clearSelection');
      expect(timelineKey(press('Escape'), { ...idle, focusedClip: { inSelection: false } })).toBe('clearSelection');
    });
  });

  group('Mod+A', () => {
    it('selects every Clip on Ctrl+A or ⌘A, with or without a Selection', () => {
      expect(timelineKey(press('a', { ctrlKey: true }), idle)).toBe('selectAll');
      expect(timelineKey(press('a', { metaKey: true }), idle)).toBe('selectAll');
      expect(timelineKey(press('A', { ctrlKey: true }), idle)).toBe('selectAll');
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, selected: 0 })).toBe('selectAll');
    });

    it('is taken only with Mod alone', () => {
      expect(timelineKey(press('a'), idle)).toBeNull();
      expect(timelineKey(press('a', { ctrlKey: true, shiftKey: true }), idle)).toBeNull();
      expect(timelineKey(press('a', { ctrlKey: true, altKey: true }), idle)).toBeNull();
    });

    it('is left to the page in Read mode or on a phone', () => {
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, editable: false })).toBeNull();
    });

    it('is left to a text field, a menu or a dialog, or while a Track is dragged', () => {
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, inTextField: true })).toBeNull();
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, inMenuOrDialog: true })).toBeNull();
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, draggingTrack: true })).toBeNull();
    });

    it('is taken while recording or merging, leaving the frozen Selection as it is', () => {
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, freeze: 'recording' })).toBe('selectAll');
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, freeze: 'merging' })).toBe('selectAll');
    });

    it('selects every Clip from a focused Clip, in the Selection or not', () => {
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, focusedClip: { inSelection: true } })).toBe(
        'selectAll',
      );
      expect(timelineKey(press('a', { ctrlKey: true }), { ...idle, focusedClip: { inSelection: false } })).toBe(
        'selectAll',
      );
    });
  });

  group('Delete', () => {
    const inside = { ...idle, focusedClip: { inSelection: true } };
    const outside = { ...idle, focusedClip: { inSelection: false } };

    it('deletes the Selection on Delete or Backspace, e.g. one made by a box or Mod+A, with no Clip focused', () => {
      expect(timelineKey(press('Delete'), idle)).toBe('deleteSelection');
      expect(timelineKey(press('Backspace'), idle)).toBe('deleteSelection');
    });

    it('deletes the whole Selection from a focused Clip in it', () => {
      expect(timelineKey(press('Delete'), inside)).toBe('deleteSelection');
      expect(timelineKey(press('Backspace'), { ...inside, selected: 1 })).toBe('deleteSelection');
    });

    it('deletes a focused Clip outside the Selection alone', () => {
      expect(timelineKey(press('Delete'), outside)).toBe('deleteClip');
      expect(timelineKey(press('Backspace'), { ...outside, selected: 0 })).toBe('deleteClip');
    });

    it('is taken only on its own', () => {
      expect(timelineKey(press('Backspace', { ctrlKey: true }), idle)).toBeNull();
      expect(timelineKey(press('Delete', { shiftKey: true }), idle)).toBeNull();
      expect(timelineKey(press('Delete', { shiftKey: true }), outside)).toBeNull();
    });

    it('is left alone with nothing selected and no Clip focused', () => {
      expect(timelineKey(press('Delete'), { ...idle, selected: 0 })).toBeNull();
    });

    it('does nothing in Read mode or on a phone', () => {
      for (const at of [idle, inside, outside]) {
        expect(timelineKey(press('Delete'), { ...at, editable: false })).toBeNull();
      }
    });

    it('does nothing while recording or merging', () => {
      for (const at of [idle, inside, outside]) {
        expect(timelineKey(press('Delete'), { ...at, freeze: 'recording' })).toBeNull();
        expect(timelineKey(press('Delete'), { ...at, freeze: 'merging' })).toBeNull();
      }
    });

    it('is left to a text field, a menu or a dialog', () => {
      expect(timelineKey(press('Backspace'), { ...idle, inTextField: true })).toBeNull();
      expect(timelineKey(press('Delete'), { ...idle, inMenuOrDialog: true })).toBeNull();
    });

    it('does nothing while a Track is dragged, from a focused Clip or not', () => {
      for (const at of [idle, inside, outside]) {
        expect(timelineKey(press('Delete'), { ...at, draggingTrack: true })).toBeNull();
      }
    });
  });

  group('copy, cut and paste', () => {
    const copy = press('c', { ctrlKey: true });
    const cut = press('x', { ctrlKey: true });
    const paste = press('v', { ctrlKey: true });

    it('copies on Ctrl+C or ⌘C, cuts on Ctrl+X or ⌘X, and pastes on Ctrl+V or ⌘V', () => {
      expect(timelineKey(copy, idle)).toBe('copy');
      expect(timelineKey(press('C', { metaKey: true }), idle)).toBe('copy');
      expect(timelineKey(cut, idle)).toBe('cut');
      expect(timelineKey(press('X', { metaKey: true }), idle)).toBe('cut');
      expect(timelineKey(paste, idle)).toBe('paste');
      expect(timelineKey(press('v', { metaKey: true }), idle)).toBe('paste');
    });

    it('is taken only with Mod alone', () => {
      expect(timelineKey(press('c'), idle)).toBeNull();
      expect(timelineKey(press('x'), idle)).toBeNull();
      expect(timelineKey(press('x', { ctrlKey: true, shiftKey: true }), idle)).toBeNull();
      expect(timelineKey(press('v', { ctrlKey: true, shiftKey: true }), idle)).toBeNull();
      expect(timelineKey(press('c', { ctrlKey: true, altKey: true }), idle)).toBeNull();
    });

    it('copies and cuts only a Selection, but pastes with nothing selected', () => {
      const none = { ...idle, selected: 0 };
      expect(timelineKey(copy, none)).toBeNull();
      expect(timelineKey(cut, none)).toBeNull();
      expect(timelineKey(paste, none)).toBe('paste');
    });

    it('does nothing in Read mode or on a phone', () => {
      for (const k of [copy, cut, paste]) expect(timelineKey(k, { ...idle, editable: false })).toBeNull();
    });

    it('does nothing while recording or merging', () => {
      for (const k of [copy, cut, paste]) {
        expect(timelineKey(k, { ...idle, freeze: 'recording' })).toBeNull();
        expect(timelineKey(k, { ...idle, freeze: 'merging' })).toBeNull();
      }
    });

    it("is left to a text field, a menu or a dialog, whose clipboard keys are the browser's", () => {
      for (const k of [copy, cut, paste]) {
        expect(timelineKey(k, { ...idle, inTextField: true })).toBeNull();
        expect(timelineKey(k, { ...idle, inMenuOrDialog: true })).toBeNull();
      }
    });

    it('does nothing while a Track is dragged', () => {
      for (const k of [copy, cut, paste]) expect(timelineKey(k, { ...idle, draggingTrack: true })).toBeNull();
    });

    it('copies and cuts the Selection from a focused Clip, in it or not', () => {
      for (const selected of [true, false]) {
        const at = { ...idle, focusedClip: { inSelection: selected } };
        expect(timelineKey(copy, at)).toBe('copy');
        expect(timelineKey(cut, at)).toBe('cut');
        expect(timelineKey(paste, at)).toBe('paste');
      }
    });

    it('copies and cuts nothing from a focused Clip with nothing selected', () => {
      const at = { ...idle, selected: 0, focusedClip: { inSelection: false } };
      expect(timelineKey(copy, at)).toBeNull();
      expect(timelineKey(cut, at)).toBeNull();
    });
  });

  group("a Clip's menu key", () => {
    const inside = { ...idle, focusedClip: { inSelection: true } };
    const outside = { ...idle, focusedClip: { inSelection: false } };
    const menuKeys = [press('ContextMenu'), press('F10', { shiftKey: true })];

    it("opens a focused Clip's menu on the Menu key or Shift+F10, in the Selection or not", () => {
      for (const k of menuKeys) {
        expect(timelineKey(k, inside)).toBe('clipMenu');
        expect(timelineKey(k, outside)).toBe('clipMenu');
        expect(timelineKey(k, { ...outside, selected: 0 })).toBe('clipMenu');
      }
    });

    it('is taken only with its exact modifiers', () => {
      expect(timelineKey(press('F10'), outside)).toBeNull();
      expect(timelineKey(press('ContextMenu', { altKey: true }), outside)).toBeNull();
      expect(timelineKey(press('F10', { shiftKey: true, ctrlKey: true }), outside)).toBeNull();
    });

    it('is left alone with no Clip focused', () => {
      for (const k of menuKeys) expect(timelineKey(k, idle)).toBeNull();
    });

    it('opens it while recording or merging, with its edits off', () => {
      for (const k of menuKeys) {
        expect(timelineKey(k, { ...outside, freeze: 'recording' })).toBe('clipMenu');
        expect(timelineKey(k, { ...inside, freeze: 'merging' })).toBe('clipMenu');
      }
    });

    it('does nothing in Read mode or on a phone', () => {
      for (const k of menuKeys) expect(timelineKey(k, { ...outside, editable: false })).toBeNull();
    });

    it('is left to a text field, a menu or a dialog', () => {
      for (const k of menuKeys) {
        expect(timelineKey(k, { ...outside, inTextField: true })).toBeNull();
        expect(timelineKey(k, { ...outside, inMenuOrDialog: true })).toBeNull();
      }
    });

    it('does nothing while a Track is dragged', () => {
      for (const k of menuKeys) expect(timelineKey(k, { ...outside, draggingTrack: true })).toBeNull();
    });
  });

  it('leaves other keys alone', () => {
    const focused = { ...idle, focusedClip: { inSelection: true } };
    for (const k of [press('Enter'), press('d'), press('z', { ctrlKey: true }), press(' ')]) {
      expect(timelineKey(k, idle)).toBeNull();
      expect(timelineKey(k, focused)).toBeNull();
    }
  });
});
