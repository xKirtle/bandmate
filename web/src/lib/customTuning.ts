// A custom tuning's notes, typed in place in the tuning field (see
// TuningField.svelte): a TypedField (see typedField.svelte.ts) whose rule
// reads six notes, low string to high, as the tuning's text.
import { tunings, tuningNotes, tuningText } from './chordFinder';
import type { Typing } from './saves.svelte';
import { TypedField } from './typedField.svelte';

export interface CustomTuningOptions {
  /** The tuning as text, as the field shows it. */
  tuning: () => string;
  /** Sets the tuning to the notes typed, as its text. */
  commit: (text: string) => void;
  /** Says why the notes typed can't be read. */
  invalid: (message: string) => void;
  /**
   * Puts the notes typed on a list of edits being typed, e.g. Saves', until
   * the function returned is called. Without one, they're on no list.
   */
  typing?: (entry: Typing) => () => void;
}

/**
 * A custom tuning's notes as a field typed in place. It shows the tuning's
 * notes, or standard tuning's when it has none, e.g. none picked or a named
 * one. What's typed is set as the tuning's text, its name if it's a named
 * tuning; notes that can't be read say why, and stay.
 */
export function customTuningField(options: CustomTuningOptions): TypedField<string> {
  return new TypedField<string>({
    saved: options.tuning,
    format: (tuning) => tuningNotes(tuning) ?? tuningNotes(tunings[0])!,
    parse: (typed) => {
      const text = tuningText(typed);
      if (text) return { value: text };
      const message = 'A custom tuning is six notes, low string to high, like D A D G B E';
      options.invalid(message);
      return { message };
    },
    commit: options.commit,
    typing: options.typing ?? (() => () => {}),
  });
}
