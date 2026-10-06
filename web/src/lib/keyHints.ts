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
 * A keyboard and mouse, as far as a browser can tell: a window at least
 * 40rem wide, the phone breakpoint, whose primary pointer can hover, as
 * the icon button's hover box asks. Some phones report a fine pointer
 * anyway, but none hovers.
 */
export const keyboardAndMouseQuery = '(min-width: 40rem) and (hover: hover)';

/**
 * Whether this looks like a keyboard and mouse, following the window as it
 * resizes and the pointer as one is plugged in or taken away. Shortcuts are
 * for a keyboard and mouse, so on a phone or a narrow window neither the
 * shortcuts button nor any key names show. The Shortcuts still work there.
 */
export function keyboardAndMouse(): boolean {
  query ??= new MediaQuery(keyboardAndMouseQuery);
  return query.current;
}

/**
 * Names Shortcuts' keys in tooltips and hints, and declares them in
 * `aria-keyshortcuts`, as a platform does, but only with a keyboard and mouse.
 * A control's usual keys aren't Shortcuts. Most are written out in a hint
 * as they are, e.g. Enter saving a field, but a number box's ↑/↓ are named
 * here too, so they show as the platform shows them.
 */
export class KeyHints {
  #on: Platform;
  #keyboardAndMouse: () => boolean;

  constructor(on: Platform, keyboardAndMouse: () => boolean) {
    this.#on = on;
    this.#keyboardAndMouse = keyboardAndMouse;
  }

  /** Names `keys` as this platform does, e.g. "⌘Z", or null on a phone or a narrow window. */
  label(keys: readonly Key[]): string | null {
    return this.#keyboardAndMouse() ? keysLabel(keys, this.#on) : null;
  }

  /** Names two-way keys, e.g. a Shortcut's, "⌥↓ or ⌥↑", back first unless asked otherwise, or null on a phone or a narrow window. */
  twoWay(shortcut: TwoWay, first: FirstWay = 'back'): string | null {
    return this.#keyboardAndMouse() ? twoWayLabel(shortcut, this.#on, first) : null;
  }

  /** `text` with `keys` named after it, e.g. "Undo (⌘Z)", or just `text` on a phone or a narrow window. */
  withKeys(text: string, keys: readonly Key[]): string {
    const label = this.label(keys);
    return label ? `${text} (${label})` : text;
  }

  /** Declares `keys` for `aria-keyshortcuts`, or undefined, leaving it off, on a phone or a narrow window. */
  aria(keys: readonly Key[]): string | undefined {
    return this.#keyboardAndMouse() ? ariaKeyShortcuts(keys, this.#on) : undefined;
  }
}

/** Key hints for this browser's platform, window and pointer. */
export function keyHints(): KeyHints {
  return new KeyHints(platform(), keyboardAndMouse);
}
