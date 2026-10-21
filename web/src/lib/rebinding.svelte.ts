/**
 * One Shortcut's rebinding, in its fold in Settings' Shortcuts tab (see
 * KeysEditor.svelte, which draws it): which of its key slots is waiting for
 * a key, which refusal it's showing, and the one place a choice becomes
 * either new keys or that refusal. The rules it keeps:
 *
 * - A slot waits for the next key pressed. Clicking the slot already
 *   waiting changes nothing, so Space letting go of its button doesn't
 *   re-arm it, and starting to wait clears the message.
 * - While a slot waits, a press is for choosing: a press an input method is
 *   taking, or a held key's repeat, is ignored, a bare Esc cancels and
 *   clears, and a press that names no key, e.g. a modifier on its own,
 *   keeps it waiting.
 * - A key, a modifier or a Reset refused shows why, naming the Shortcut
 *   that has the key; a refused key keeps the slot waiting for another try,
 *   and Reset's refusal is worded as Reset's.
 * - The message goes on the next key, modifier or Reset taken, on a key
 *   removed, on Esc, and once the Shortcut that has the key is revealed.
 * - Focus leaving stops the waiting, and clears the message unless it's
 *   leaving to that Shortcut's own button: a message can't be read while
 *   reaching for its link. The fold unmounting the editor clears both by
 *   construction.
 */
import {
  choose,
  keyChosen,
  refusalMessage,
  removeKey,
  reset as toDefaults,
  toggleModifier,
  type KeyList,
  type ShortcutId,
  type ShortcutKeys,
  type Slot,
} from './shortcutKeys';
import type { KeyPress, Modifier, Platform } from './shortcuts';

/**
 * A press as rebinding hears it: a key press, with whether it's a held
 * key's repeat and whether an input method is taking it, as a
 * `KeyboardEvent` gives them. A handler on the Song page hears a press as a
 * `KeyDown` instead (see shortcuts.ts): what it reads of one differs, as it
 * acts on the keys rather than choosing them.
 */
export type RebindPress = KeyPress & Partial<Pick<KeyboardEvent, 'repeat' | 'isComposing'>>;

/** A refusal as the editor shows it: why, and the Shortcut that has the key, as a button leading to it. */
export type RefusalShown = { text: string; by: ShortcutId | null };

/** Where focus went when it left the editor: the button naming the Shortcut that has the key refused, or anywhere else. */
export type FocusGone = 'holder' | 'elsewhere';

/** The Shortcuts' keys as rebinding reads and sets them: the Device Setting that holds them, in the app. */
export interface KeysSetting {
  readonly value: ShortcutKeys;
  set(value: ShortcutKeys): void;
}

export interface RebindingOptions {
  /** The Shortcut being rebound: one editor, and one of these, per Shortcut. */
  id: () => ShortcutId;
  /** The Shortcuts' keys on this device, which rebinding reads and sets. */
  keys: KeysSetting;
  /** The platform a refusal names its key for. */
  on: Platform;
}

export class Rebinding {
  /** Where the next key pressed goes, while a slot is waiting for one, or null while none is. */
  listening = $state<Slot | null>(null);
  /** Why the last key, modifier or Reset was refused, while it's showing, or null while none is. */
  message = $state<RefusalShown | null>(null);

  #options: RebindingOptions;

  constructor(options: RebindingOptions) {
    this.#options = options;
  }

  /** Whether a slot is the one waiting for a key. */
  isListening(list: KeyList, index: number): boolean {
    return this.listening?.list === list && this.listening.index === index;
  }

  /** Waits for the next key pressed, for a slot: the key at `index` in `list`, or the list's length to add one. */
  listen(list: KeyList, index: number) {
    // Space lets go of the button it's pressed on, clicking it again.
    if (this.isListening(list, index)) return;
    this.message = null;
    this.listening = { id: this.#options.id(), list, index };
  }

  /**
   * Whether a press is for choosing a key, rather than for the button or
   * the page, which is what the editor keeps it from.
   */
  takesPress(press: RebindPress): boolean {
    return this.listening !== null && !press.isComposing;
  }

  /** Takes a key pressed for the slot waiting for one, or shows why it's refused, the slot still waiting. */
  press(press: RebindPress) {
    const slot = this.listening;
    if (!slot || !this.takesPress(press)) return;
    if (press.repeat) return;
    if (press.key === 'Escape' && !press.ctrlKey && !press.metaKey && !press.altKey && !press.shiftKey) {
      this.listening = null;
      this.message = null;
      return;
    }
    const key = keyChosen(press);
    if (!key) return;
    const choice = choose(this.#options.keys.value, slot, key);
    if (!choice.ok) {
      this.message = refusalMessage(choice.refusal, this.#options.on);
      return;
    }
    this.#take(choice.keys);
    this.listening = null;
  }

  /** Takes the key at a slot off the Shortcut. */
  remove(list: KeyList, index: number) {
    const { keys, id } = this.#options;
    this.#take(removeKey(keys.value, { id: id(), list, index }));
  }

  /** Turns a modifier a mouse Shortcut is held with on or off, or shows why it's refused. */
  toggle(modifier: Modifier) {
    const { keys, id, on } = this.#options;
    const choice = toggleModifier(keys.value, id(), modifier);
    if (!choice.ok) {
      this.message = refusalMessage(choice.refusal, on);
      return;
    }
    this.#take(choice.keys);
  }

  /** Puts the Shortcut's default keys back, or shows why it's refused, in Reset's wording. */
  reset() {
    const { keys, id, on } = this.#options;
    const choice = toDefaults(keys.value, id());
    if (!choice.ok) {
      this.message = refusalMessage(choice.refusal, on, true);
      return;
    }
    this.#take(choice.keys);
  }

  /** Clears a message on Esc, when one is showing and no slot is waiting for a key, which takes Esc itself. */
  escape(press: RebindPress) {
    if (press.key === 'Escape' && this.message && !this.listening) this.message = null;
  }

  /** Focus leaving the editor: the waiting stops, and the message goes unless focus went to the Shortcut it names. */
  focusLeft(to: FocusGone) {
    this.listening = null;
    if (to === 'elsewhere') this.message = null;
  }

  /** The Shortcut the message names revealed: the message has been acted on, so it goes. */
  holderRevealed() {
    this.message = null;
  }

  // Keeps the keys a choice leaves, the message it answers gone with it.
  #take(keys: ShortcutKeys) {
    this.#options.keys.set(keys);
    this.message = null;
  }
}
