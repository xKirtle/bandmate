// The Song page's fields typed in place: its Details, a custom tuning's
// notes among them, and a Master's name and notes. Each is a TypedField (see typedField.svelte.ts) with its own
// rule for what's typed.
import type { Master, MasterChanges, Song, SongAt, SongChanges } from './api';
import { customTuningField } from './customTuning';
import type { Saves, Typing } from './saves.svelte';
import { TypedField, type Parsed, type TypedFieldOptions } from './typedField.svelte';

/** Sends a change to the Song's Details, as the api's updateSong does. */
export type UpdateSong = (at: SongAt, changes: SongChanges) => Promise<Song>;

/** The Song's Details, each a field typed in place. */
export interface DetailFields {
  title: TypedField<string>;
  key: TypedField<string>;
  bpm: TypedField<number | null>;
  capo: TypedField<number | null>;
  /** A custom tuning's notes, typed in the tuning field, and set as the tuning; before it, so it's committed first. */
  customTuning: TypedField<string>;
  tuning: TypedField<string>;
  notes: TypedField<string>;
}

/** A field of text typed in place, shown as it's saved. */
function textField(options: Omit<TypedFieldOptions<string>, 'format'>): TypedField<string> {
  return new TypedField<string>({ ...options, format: (value) => value });
}

type TextDetail = 'title' | 'key' | 'tuning' | 'notes';
type NumberDetail = 'bpm' | 'capo';

/**
 * The Song's Details as fields typed in place, each saved through Saves on
 * its own. Text is saved trimmed, but for the notes, kept as typed. A BPM
 * or Capo is a whole number, or blank for none: anything else says so and
 * goes back to what's saved. Refused as the Song changed elsewhere, what's
 * typed stays, to copy out.
 */
export function detailFields(saves: Saves, update: UpdateSong): DetailFields {
  const save = (changes: SongChanges) => saves.submit((at) => update(at, changes));

  const text = (detail: TextDetail) =>
    textField({
      saved: () => saves.saved[detail],
      parse: (typed) => ({ value: detail === 'notes' ? typed : typed.trim() }),
      commit: (value) => save({ [detail]: value }),
      typing: saves.typing,
    });

  const number = (detail: NumberDetail, label: string) =>
    new TypedField<number | null>({
      saved: () => saves.saved[detail],
      format: (value) => value?.toString() ?? '',
      parse: (typed): Parsed<number | null> => {
        const trimmed = typed.trim();
        if (trimmed === '') return { value: null };
        if (/^\d+$/.test(trimmed)) return { value: Number(trimmed) };
        saves.report(`${label} must be a whole number`);
        return 'back';
      },
      commit: (value) => save({ [detail]: value }),
      typing: saves.typing,
    });

  const tuning = text('tuning');
  return {
    title: text('title'),
    key: text('key'),
    bpm: number('bpm', 'BPM'),
    capo: number('capo', 'Capo'),
    customTuning: customTuningField({
      tuning: () => tuning.shown,
      commit: (typed) => {
        tuning.shown = typed;
        tuning.commit();
      },
      invalid: saves.report,
      typing: saves.typing,
    }),
    tuning,
    notes: text('notes'),
  };
}

/** Sends a change to a Master's name or notes, as the api's updateMaster does. */
export type UpdateMaster = (at: SongAt, masterId: number, changes: MasterChanges) => Promise<Song>;

export interface MasterFieldsOptions {
  /** The Master as saved, while the Song has it. */
  master: () => Master | undefined;
  /** Sends a change to the Song; resolves to whether it was saved. */
  change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
  /** Puts an edit on Saves' list of edits being typed (see Saves.typing). */
  typing: (entry: Typing) => () => void;
  /** Sends a change to the Master, against the Song as saved. */
  update: UpdateMaster;
  /** Shows why what was typed was refused. */
  refuse: (message: string) => void;
}

/** A Master's name and notes, each a field typed in place. */
export interface MasterFields {
  name: TypedField<string>;
  notes: TypedField<string>;
}

/**
 * A Master's name and notes as fields typed in place. A name is saved
 * trimmed; a blank one is refused, saying why, and goes back to what's
 * saved. The notes are saved as typed. A save that fails, or is refused as
 * the Song changed elsewhere, shows what's saved again. Once the Master's
 * removed, what's typed is dropped.
 */
export function masterFields(masterId: number, options: MasterFieldsOptions): MasterFields {
  const field = (detail: 'name' | 'notes', parse: (typed: string) => Parsed<string>) =>
    textField({
      saved: () => options.master()?.[detail] ?? '',
      parse,
      commit: (value) => options.change((at) => options.update(at, masterId, { [detail]: value })),
      exists: () => options.master() !== undefined,
      typing: options.typing,
    });

  return {
    name: field('name', (typed) => {
      if (typed.trim()) return { value: typed.trim() };
      options.refuse('A Master needs a name once there are several.');
      return 'back';
    }),
    notes: field('notes', (typed) => ({ value: typed })),
  };
}
