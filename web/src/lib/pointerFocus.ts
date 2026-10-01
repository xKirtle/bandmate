// Keeping focus rings off what a pointer focused. Chrome shows the ring of
// what a click focused at the first key pressed, even a key that acts on the
// page rather than on it, e.g. Space playing.

/** Whether what's focused was focused by a pointer, whose focus rings stay hidden. */
export class PointerFocus {
  #fromPointer = false;
  #fromPointerBeforeKey = false;

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
   * unless it's a shortcut, held with Ctrl, ⌘ or Alt, as Chrome has it. A
   * key held down acted when first pressed; its repeats change nothing.
   */
  keyDown(event: RingKeyPress) {
    if (event.repeat) return;
    this.#fromPointerBeforeKey = this.#fromPointer;
    if (!(event.ctrlKey || event.metaKey || event.altKey)) this.#fromPointer = false;
  }

  /**
   * Says the key just pressed acted on the page rather than on what's
   * focused, e.g. Space playing, so rings stay as they were before it.
   */
  keyActedOnPage() {
    this.#fromPointer = this.#fromPointerBeforeKey;
  }
}

/** The parts of a key press that say whether it shows a ring. */
export type RingKeyPress = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>;

const focus = new PointerFocus();

function showOnPage() {
  document.documentElement.toggleAttribute('data-pointer-focus', focus.hidesRings);
}

/**
 * Marks the page `data-pointer-focus` while what's focused was focused by a
 * pointer, for focus ring styles to leave it be. Called once, at start.
 */
export function trackPointerFocus() {
  // Captured, so heard before any handler that says a key acted on the page.
  addEventListener(
    'pointerdown',
    () => {
      focus.pointerDown();
      showOnPage();
    },
    { capture: true },
  );
  addEventListener(
    'keydown',
    (event) => {
      focus.keyDown(event);
      showOnPage();
    },
    { capture: true },
  );
}

/**
 * Says the key being handled acted on the page rather than on what's
 * focused, e.g. Space playing, so what a pointer focused shows no ring.
 */
export function keyActedOnPage() {
  focus.keyActedOnPage();
  showOnPage();
}
