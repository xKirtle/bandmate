/** Whether what's focused was focused by a pointer, whose focus rings stay hidden. */
export class PointerFocus {
  #fromPointer = false;
  // Whether a pointer had focused it before the last key pressed.
  #beforeKey = false;

  /** Whether focus rings are hidden, as a pointer focused what's focused. */
  get hidesRings(): boolean {
    return this.#fromPointer;
  }

  /** Hears a pointer press, which never shows a ring. */
  pointerDown() {
    this.#fromPointer = true;
  }

  /**
   * Hears a key pressed, which acts on what's focused, so shows its ring,
   * unless it's a shortcut, held with Ctrl, ⌘ or Alt, as Chrome has it.
   */
  keyDown(event: KeyPress) {
    this.#beforeKey = this.#fromPointer;
    if (!(event.ctrlKey || event.metaKey || event.altKey)) this.#fromPointer = false;
  }

  /**
   * Says the key just pressed acted on the page rather than on what's
   * focused, e.g. Space playing, so rings stay as they were before it.
   */
  keyForPage() {
    this.#fromPointer = this.#beforeKey;
  }
}

/** The parts of a key press that say whether it shows a ring. */
export type KeyPress = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>;

const focus = new PointerFocus();
let page: HTMLElement | undefined;

function showOnPage() {
  page?.toggleAttribute('data-pointer-focus', focus.hidesRings);
}

/**
 * Marks the page `data-pointer-focus` while what's focused was focused by a
 * pointer, for focus ring styles to leave it be: Chrome shows its ring at
 * the first key pressed, even one that acted on the page instead.
 */
export function trackPointerFocus(root: HTMLElement = document.documentElement) {
  page = root;
  // Captured, so heard before any handler that says a key was for the page.
  addEventListener('pointerdown', () => (focus.pointerDown(), showOnPage()), { capture: true });
  addEventListener('keydown', (event) => (focus.keyDown(event), showOnPage()), { capture: true });
}

/**
 * Says the key being handled acted on the page rather than on what's
 * focused, e.g. Space playing, so what a pointer focused shows no ring.
 */
export function keyForPage() {
  focus.keyForPage();
  showOnPage();
}
