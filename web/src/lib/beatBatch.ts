// Adding several Beats at once: the review table's rows, one per file, and
// the rules for when they can be added.
import type { DecodedAudio } from './api';
import { sameDraft, type BeatDraft } from './beatDraft';

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

/** Whether any row has details typed over the ones its file suggested, which cancelling would lose. */
export function anyEdited(rows: readonly Pick<BatchRow, 'suggested' | 'draft'>[]): boolean {
  return rows.some((row) => !sameDraft(row.draft, row.suggested));
}

/** Whether Add can start: there's a ticked row, and every ticked row is read and valid. */
export function canAdd(rows: readonly Pick<BatchRow, 'status' | 'ticked' | 'draft'>[]): boolean {
  const ticked = rows.filter((row) => row.ticked);
  return ticked.length > 0 && ticked.every((row) => row.status === 'ready' && invalidFields(row.draft).length === 0);
}

/** A field of a Beat's draft that can't be saved as it is. */
export type InvalidField = 'title' | 'bpm' | 'sourceLink';

/**
 * The fields the server would refuse, in the table's order: a missing Title,
 * a BPM that isn't a whole number from 1 to 999, or a Source link that isn't
 * a web address.
 */
export function invalidFields(draft: BeatDraft): InvalidField[] {
  const invalid: InvalidField[] = [];
  if (draft.title.trim() === '') invalid.push('title');
  const bpm = draft.bpm.trim();
  if (bpm !== '' && !(/^\d+$/.test(bpm) && Number(bpm) >= 1 && Number(bpm) <= 999)) invalid.push('bpm');
  const link = draft.sourceLink.trim();
  if (link !== '' && !isWebAddress(link)) invalid.push('sourceLink');
  return invalid;
}

const fileNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Orders rows by file name, as a file browser would: "Beat 2" before "beat 10". */
export function byFileName(a: { file: { name: string } }, b: { file: { name: string } }): number {
  return fileNames.compare(a.file.name, b.file.name);
}

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '';
  } catch {
    return false;
  }
}
