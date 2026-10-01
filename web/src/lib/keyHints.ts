import { MediaQuery } from 'svelte/reactivity';
import {
  ariaKeyShortcuts,
  keysLabel,
  platform,
  twoWayLabel,
  type FirstWay,
  type Key,
  type Platform,
  type TwoWay,
} from './shortcuts';

// Made when first asked, as only a browser has media queries.
let query: MediaQuery | undefined;

/**
 * Whether this device has a fine pointer, e.g. a mouse or a trackpad,
 * following it as one is plugged in or taken away. Shortcuts are for a
 * keyboard and mouse, so without one, e.g. on a phone, nothing names them.
 */
export function finePointer(): boolean {
  query ??= new MediaQuery('any-pointer: fine');
  return query.current;
}

/**
 * Names Shortcuts' keys in tooltips and hints, and declares them in
 * `aria-keyshortcuts`, as a platform does, but only with a fine pointer.
 * A control's usual keys aren't Shortcuts. Most are written out in a hint
 * as they are, e.g. Enter saving a field, but a number box's ↑/↓ are named
 * here too, so they show as the platform shows them.
 */
export class KeyHints {
  #on: Platform;
  #finePointer: () => boolean;

  constructor(on: Platform, finePointer: () => boolean) {
    this.#on = on;
    this.#finePointer = finePointer;
  }

  /** Names `keys` as this platform does, e.g. "⌘Z", or null without a fine pointer. */
  label(keys: readonly Key[]): string | null {
    return this.#finePointer() ? keysLabel(keys, this.#on) : null;
  }

  /** Names two-way keys, e.g. a Shortcut's, "⌥↓ or ⌥↑", back first unless asked otherwise, or null without a fine pointer. */
  twoWay(shortcut: TwoWay, first: FirstWay = 'back'): string | null {
    return this.#finePointer() ? twoWayLabel(shortcut, this.#on, first) : null;
  }

  /** `text` with `keys` named after it, e.g. "Undo (⌘Z)", or just `text` without a fine pointer. */
  withKeys(text: string, keys: readonly Key[]): string {
    const label = this.label(keys);
    return label ? `${text} (${label})` : text;
  }

  /** Declares `keys` for `aria-keyshortcuts`, or undefined, leaving it off, without a fine pointer. */
  aria(keys: readonly Key[]): string | undefined {
    return this.#finePointer() ? ariaKeyShortcuts(keys, this.#on) : undefined;
  }
}

/** Key hints for this browser's platform and pointer. */
export function keyHints(): KeyHints {
  return new KeyHints(platform(), finePointer);
}
