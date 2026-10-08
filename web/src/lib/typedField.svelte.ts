// A field typed in place: one value of the Song or its Timeline, e.g. a
// Track's name or a Cue's time, shown as text and typed over. Every such
// field keeps the same rules, so they're kept here once:
//
// - It shows what's saved until typed in, then what's typed.
// - Committed, e.g. on Enter or blur, what's typed is parsed by the field's
//   own rule, into a value to save, "go back to what's saved", or a message
//   to show, keeping what's typed. A value equal to what's saved does
//   nothing.
// - Once a value is sent, the field shows what's saved again as its save
//   resolves: the value, or what was saved before if it failed. Anything
//   typed since wins over it.
// - Cancelled, e.g. on Esc, it shows what's saved again.
// - Destroyed, e.g. as the page goes, it commits what's typed, dropping it
//   if its rule refuses it.
//
// While what it shows differs from what's saved, it's on Saves' list of
// edits being typed, so the Song has unsaved edits: closing the tab asks
// first, and a refresh doesn't replace what's typed.
import type { Typing } from './saves.svelte';

/** What a field's rule makes of what's typed: a value to save, going back to what's saved, or a message to show. */
export type Parsed<T> = { value: T } | 'back' | { message: string };

export interface TypedFieldOptions<T> {
  /** What's saved, or shown as saved, e.g. on the Timeline as shown. */
  saved: () => T;
  /** A value as the field shows it. */
  format: (value: T) => string;
  /** The field's rule for what's typed. */
  parse: (typed: string) => Parsed<T>;
  /** Saves a value; given a promise, what's typed shows until it resolves. */
  commit: (value: T) => unknown;
  /** Puts an edit on Saves' list of edits being typed, until the function returned is called. */
  typing: (entry: Typing) => () => void;
  /** The Section the field is in, if any. */
  section?: number;
}

export class TypedField<T> implements Typing {
  #options: TypedFieldOptions<T>;
  /** What's typed, or null to show what's saved. */
  #shownTyped = $state<string | null>(null);
  /**
   * The same, kept outside Svelte's state, as committing reads it: destroyed
   * as its component goes, a field's state would read as it was before the
   * update that took it away, e.g. before an Esc that cancelled it.
   */
  #typed: string | null = null;
  /** What's typed that's been sent, while its save is on its way. */
  #sending: string | null = null;
  #message = $state<string | null>(null);
  #leave: () => void;
  readonly section?: number;

  constructor(options: TypedFieldOptions<T>) {
    this.#options = options;
    this.section = options.section;
    this.#leave = options.typing(this);
  }

  /** What the field shows: what's typed, or what's saved. */
  get shown(): string {
    return this.#shownTyped ?? this.#options.format(this.#options.saved());
  }

  set shown(typed: string) {
    this.#type(typed);
    this.#message = null;
  }

  /** Why what's typed was refused, until it's typed in again. */
  get message(): string | null {
    return this.#message;
  }

  /** Whether what it shows differs from what's saved. */
  get unsaved(): boolean {
    return this.#shownTyped !== null && this.#shownTyped !== this.#options.format(this.#options.saved());
  }

  /**
   * Commits what's typed, by the field's rule. Returns whether it's done
   * with it: false when the rule refused it, keeping it with a message.
   */
  commit(): boolean {
    const typed = this.#typed;
    if (typed === null || typed === this.#sending) return true;
    const saved = this.#options.saved();
    if (typed === this.#options.format(saved)) return this.#back();
    const parsed = this.#options.parse(typed);
    if (parsed === 'back') return this.#back();
    if ('message' in parsed) {
      this.#message = parsed.message;
      return false;
    }
    if (Object.is(parsed.value, saved)) return this.#back();
    const sent = this.#options.commit(parsed.value);
    if (!(sent instanceof Promise)) return this.#back();
    // Shown as sent, e.g. trimmed, until its save resolves.
    const shown = this.#options.format(parsed.value);
    this.#type((this.#sending = shown));
    void sent.finally(() => {
      if (this.#sending === shown) this.#sending = null;
      if (this.#typed === shown) this.#type(null);
    });
    return true;
  }

  /** Takes back what's typed, showing what's saved again. */
  cancel() {
    this.#back();
  }

  /** Commits what's typed, dropping it if refused, and leaves Saves' list. */
  destroy = () => {
    if (!this.commit()) this.cancel();
    this.#leave();
  };

  #type(typed: string | null) {
    this.#typed = this.#shownTyped = typed;
  }

  #back(): true {
    this.#type(null);
    this.#message = null;
    return true;
  }
}
