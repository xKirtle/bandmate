// Adding several Beats at once: the review table's rows, one per file, and
// the rules for when they can be added.
import type { Beat, DecodedAudio } from './api';
import { invalidFields, sameDraft, type BeatDraft } from './beatDraft';

/** One file in the batch, from picking it until its Beat is saved or it's removed. */
export interface BatchRow {
  /** Tells rows apart, even two files with the same name. */
  key: number;
  file: File;
  /**
   * Whether the file has been read yet: checked it can be played and its
   * duration worked out. An unreadable file can't be added.
   */
  status: 'reading' | 'ready' | 'unreadable';
  /** Once read, its duration and peaks. */
  decoded: DecodedAudio | null;
  /** The details the file's tags and name suggested, to tell whether any were edited. */
  suggested: BeatDraft;
  draft: BeatDraft;
  /** Whether Add adds it. */
  ticked: boolean;
  /** The fields set from the bar above the table while the file was being read. */
  setWhileReading: Partial<BeatDraft>;
  /** Why it can't be read, or why its last upload failed. */
  error: string | null;
}

/** Whether a row can be ticked: any file but one that can't be added. */
export function canTick(row: Pick<BatchRow, 'status'>): boolean {
  return row.status !== 'unreadable';
}

/** How many of the rows that can be ticked are, for the header's tick box. */
export function tickedState(rows: readonly Pick<BatchRow, 'status' | 'ticked'>[]): 'all' | 'some' | 'none' {
  const tickable = rows.filter(canTick);
  const ticked = tickable.filter((row) => row.ticked).length;
  if (ticked === 0) return 'none';
  return ticked === tickable.length ? 'all' : 'some';
}

/**
 * Ticks or unticks, as `on` says, every row that can be ticked from the one
 * clicked last to the one clicked now, in the table's order, as shift-clicking
 * does. With the last one gone, only the one clicked now.
 */
export function tickRange(
  rows: readonly Pick<BatchRow, 'key' | 'status' | 'ticked'>[],
  lastKey: number,
  key: number,
  on: boolean,
) {
  const to = rows.findIndex((row) => row.key === key);
  const last = rows.findIndex((row) => row.key === lastKey);
  const from = last === -1 ? to : last;
  for (const row of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) if (canTick(row)) row.ticked = on;
}

/** Whether any row has details typed over the ones its file suggested, which cancelling would lose. */
export function anyEdited(rows: readonly Pick<BatchRow, 'suggested' | 'draft'>[]): boolean {
  return rows.some((row) => !sameDraft(row.draft, row.suggested));
}

/** Whether Add can start: there's a ticked row, and every ticked row is read and valid. */
export function canAdd(rows: readonly Pick<BatchRow, 'status' | 'ticked' | 'draft'>[]): boolean {
  const ticked = rows.filter((row) => row.ticked);
  return ticked.length > 0 && ticked.every((row) => row.status === 'ready' && invalidFields(row.draft).length === 0);
}

const fileNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Orders rows by file name, as a file browser would: "Beat 2" before "beat 10". */
export function byFileName(a: { file: { name: string } }, b: { file: { name: string } }): number {
  return fileNames.compare(a.file.name, b.file.name);
}

/** A row as far as telling whether its file was picked before: when it was picked, and its file. */
type PickedRow = { key: number; file: Pick<File, 'name' | 'size'> };

/** Where a row's file probably is already: in the Library, as the Beat with this title, or in the batch. */
export type AlreadyIn = { in: 'library'; title: string } | { in: 'batch' };

/**
 * Where a row's file probably is already, going by its file name and size,
 * which Bandmate keeps for every Beat: in the Library, or in the batch, as a
 * row picked before it.
 */
export function alreadyIn(
  row: PickedRow,
  library: readonly Pick<Beat, 'title' | 'fileName' | 'size'>[],
  rows: readonly PickedRow[],
): AlreadyIn | null {
  const same = (name: string, size: number) => name === row.file.name && size === row.file.size;
  const beat = library.find((b) => same(b.fileName, b.size));
  if (beat) return { in: 'library', title: beat.title };
  // Keys count up as files are picked, so a lower key was picked earlier.
  return rows.some((r) => r.key < row.key && same(r.file.name, r.file.size)) ? { in: 'batch' } : null;
}

/** A field the bar above the table can set on every ticked row at once. */
export type SharedField = Exclude<keyof BeatDraft, 'title'>;

/**
 * Sets one field to one value on every ticked row, over whatever it held. A
 * row still being read keeps it once read, over what its file suggests.
 */
export function setOnTicked(
  rows: readonly Pick<BatchRow, 'status' | 'ticked' | 'draft' | 'setWhileReading'>[],
  field: SharedField,
  value: string,
) {
  for (const row of rows) {
    if (!row.ticked) continue;
    row.draft[field] = value;
    if (row.status === 'reading') row.setWhileReading[field] = value;
  }
}

/** A row's details once its file is read: what the file suggested, under what was set on it meanwhile. */
export function draftOnceRead(row: Pick<BatchRow, 'setWhileReading'>, suggested: BeatDraft): BeatDraft {
  return { ...suggested, ...row.setWhileReading };
}
