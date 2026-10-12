// Rhyme mode: suggesting Rhymes for the word at the caret while writing
// (see the GLOSSARY), made once per Song by the Song page, which shows the
// Rhymes card while it's on, and handed to the Lyric Sheet, which draws its
// toggle.
//
// It keeps Rhyme mode's rules:
// - It's only on in Write mode, on a desktop-wide window, and its toggle
//   shows only where it can be on.
// - It and Sync mode are never on together: switching it on switches Sync
//   mode off, and Sync mode coming on ends it. Recording and the Loop don't.
// - It starts off on every visit to a Song.
// - Once ended, for whatever reason, it stays off until switched on again,
//   even when what ended it changes back.
import { untrack } from 'svelte';
import type { Mode } from './songMode';

export interface RhymeModeOptions {
  /** The Song page's mode: Rhyme mode is only on in Write mode. */
  mode: () => Mode;
  /** Whether the window is desktop-wide (80rem and wider): Rhyme mode is only on where it is. */
  wide: () => boolean;
  /** Sync mode, which Rhyme mode is never on with. */
  sync: { readonly on: boolean; end(): void };
}

export class RhymeMode {
  #options: RhymeModeOptions;
  /** Whether Rhyme mode was switched on and hasn't ended since. */
  #switchedOn = $state(false);

  /**
   * Whether Rhyme mode can be switched on: in Write mode, on a desktop-wide
   * window. Sync mode being on doesn't stop it, as switching it on switches
   * Sync mode off.
   */
  readonly canBeOn: boolean = $derived.by(() => {
    const { mode, wide } = this.#options;
    return mode() === 'write' && wide();
  });

  /** Whether Rhyme mode is on. */
  readonly on: boolean = $derived.by(() => this.#switchedOn && this.canBeOn && !this.#options.sync.on);

  constructor(options: RhymeModeOptions) {
    this.#options = options;
    // Ending is kept: once it can't be on, it's off until switched on again.
    $effect(() => {
      if (!this.on) untrack(() => (this.#switchedOn = false));
    });
  }

  /** Switches Rhyme mode on, switching Sync mode off, or off. */
  switch() {
    if (this.on) return this.end();
    if (!this.canBeOn) return;
    this.#switchedOn = true;
    this.#options.sync.end();
  }

  /** Ends Rhyme mode. */
  end() {
    this.#switchedOn = false;
  }
}
