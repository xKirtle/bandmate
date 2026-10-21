import { describe, expect, it } from 'vitest';
import { Rebinding, type RebindPress } from './rebinding.svelte';
import { defaultShortcutKeys, keysIn, type ShortcutId, type ShortcutKeys } from './shortcutKeys';

/** The Shortcuts' keys as the Device Setting holds them, kept in the test alone. */
class FakeKeys {
  value = $state<ShortcutKeys>(defaultShortcutKeys);

  set(value: ShortcutKeys) {
    this.value = value;
  }
}

/** One Shortcut's rebinding, as its fold makes it, over keys the test can share between folds. */
function rebindingFor(id: ShortcutId, keys = new FakeKeys()) {
  return { rebinding: new Rebinding({ id: () => id, keys, on: 'other' }), keys };
}

/** A key pressed with nothing held, or with whatever `more` says, e.g. a repeat. */
function pressOf(key: string, more: Partial<RebindPress> = {}): RebindPress {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more };
}

/** A Shortcut's only list of keys, as its editor lists them. */
function keysOf(keys: FakeKeys, id: ShortcutId) {
  return keysIn(keys.value.keys, id, 'keys');
}

/**
 * Rebinding Record, waiting for a key for the key it has, with Split at the
 * playhead's S refused for it, so a message is showing and it's still waiting.
 */
function refusedS() {
  const { rebinding, keys } = rebindingFor('record');
  rebinding.listen('keys', 0);
  rebinding.press(pressOf('s'));
  expect(rebinding.message).toEqual({ text: 'S is already used by', by: 'splitClips' });
  return { rebinding, keys };
}

describe('Rebinding, choosing a key', () => {
  it('replaces the key in the slot and stops listening', () => {
    const { rebinding, keys } = rebindingFor('record');
    rebinding.listen('keys', 0);
    rebinding.press(pressOf('q'));
    expect(keysOf(keys, 'record')).toEqual([{ key: 'q' }]);
    expect(rebinding.listening).toBe(null);
    expect(rebinding.message).toBe(null);
  });

  it('keeps listening and names the Shortcut that has a key refused', () => {
    const { rebinding, keys } = refusedS();
    expect(rebinding.listening).toEqual({ id: 'record', list: 'keys', index: 0 });
    expect(keysOf(keys, 'record')).toEqual([{ key: 'r' }]);
  });

  it('cancels and clears on Esc while listening', () => {
    const { rebinding, keys } = refusedS();
    rebinding.press(pressOf('Escape'));
    expect(rebinding.listening).toBe(null);
    expect(rebinding.message).toBe(null);
    expect(keysOf(keys, 'record')).toEqual([{ key: 'r' }]);
  });

  it('ignores clicking the slot already listening, message and all', () => {
    const { rebinding } = refusedS();
    rebinding.listen('keys', 0);
    expect(rebinding.message).toEqual({ text: 'S is already used by', by: 'splitClips' });
    expect(rebinding.listening).toEqual({ id: 'record', list: 'keys', index: 0 });
  });

  it('ignores a held key repeating', () => {
    const { rebinding, keys } = rebindingFor('record');
    rebinding.listen('keys', 0);
    rebinding.press(pressOf('q', { repeat: true }));
    expect(keysOf(keys, 'record')).toEqual([{ key: 'r' }]);
    expect(rebinding.listening).toEqual({ id: 'record', list: 'keys', index: 0 });
  });

  it('ignores a press an input method is taking', () => {
    const { rebinding, keys } = rebindingFor('record');
    rebinding.listen('keys', 0);
    const press = pressOf('q', { isComposing: true });
    expect(rebinding.takesPress(press)).toBe(false);
    rebinding.press(press);
    expect(keysOf(keys, 'record')).toEqual([{ key: 'r' }]);
    expect(rebinding.listening).toEqual({ id: 'record', list: 'keys', index: 0 });
  });
});

describe('Rebinding, the message showing', () => {
  it('goes once a key is removed', () => {
    const { rebinding, keys } = refusedS();
    rebinding.remove('keys', 0);
    expect(keysOf(keys, 'record')).toEqual([]);
    expect(rebinding.message).toBe(null);
  });

  it('goes on Esc with nothing listening', () => {
    const { rebinding } = refusedS();
    rebinding.focusLeft('holder');
    rebinding.escape(pressOf('Escape'));
    expect(rebinding.message).toBe(null);
  });

  it('goes once the Shortcut it names is revealed', () => {
    const { rebinding } = refusedS();
    rebinding.holderRevealed();
    expect(rebinding.message).toBe(null);
  });

  it('stays, the listening stopped, while focus goes to the Shortcut it names', () => {
    const { rebinding } = refusedS();
    rebinding.focusLeft('holder');
    expect(rebinding.message).toEqual({ text: 'S is already used by', by: 'splitClips' });
    expect(rebinding.listening).toBe(null);
  });

  it('goes with the listening once focus leaves anywhere else', () => {
    const { rebinding } = refusedS();
    rebinding.focusLeft('elsewhere');
    expect(rebinding.message).toBe(null);
    expect(rebinding.listening).toBe(null);
  });
});

describe('Rebinding a mouse Shortcut and resetting', () => {
  it("leaves a mouse Shortcut held as it was, saying why its last modifier can't be turned off", () => {
    const { rebinding, keys } = rebindingFor('toggleClip');
    rebinding.toggle('mod');
    expect(rebinding.message).toEqual({
      text: 'Needs at least one modifier: a plain click does something else.',
      by: null,
    });
    expect(keysOf(keys, 'toggleClip')).toEqual([{ key: 'click', mod: true }]);
  });

  it("shows a refused Reset in Reset's wording", () => {
    const keys = new FakeKeys();
    const { rebinding } = rebindingFor('record', keys);
    const split = rebindingFor('splitClips', keys).rebinding;
    // Record's R is free, and Split at the playhead is given it.
    rebinding.remove('keys', 0);
    split.listen('keys', 0);
    split.press(pressOf('r'));
    expect(keysOf(keys, 'splitClips')).toEqual([{ key: 'r' }]);

    rebinding.reset();
    expect(rebinding.message).toEqual({ text: "Can't reset: R is used by", by: 'splitClips' });
    expect(keysOf(keys, 'record')).toEqual([]);
  });
});
