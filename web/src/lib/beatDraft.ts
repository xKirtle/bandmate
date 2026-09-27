// A Beat's details as its form's inputs hold them: numbers stay text while
// typing.
import type { Beat, BeatDetails } from './api';

export interface BeatDraft {
  title: string;
  producer: string;
  sourceLink: string;
  bpm: string;
  key: string;
  notes: string;
}

export function toDraft(beat: BeatDetails | null, title = ''): BeatDraft {
  return {
    title: beat?.title ?? title,
    producer: beat?.producer ?? '',
    sourceLink: beat?.sourceLink ?? '',
    bpm: beat?.bpm?.toString() ?? '',
    key: beat?.key ?? '',
    notes: beat?.notes ?? '',
  };
}

/** The details a draft holds, or a message saying what's wrong with it. */
export function fromDraft(draft: BeatDraft): BeatDetails | string {
  const bpm = draft.bpm.trim();
  if (bpm !== '' && !/^\d+$/.test(bpm)) return 'BPM must be a whole number';
  return {
    title: draft.title.trim(),
    producer: draft.producer.trim(),
    sourceLink: draft.sourceLink.trim(),
    bpm: bpm === '' ? null : Number(bpm),
    key: draft.key.trim(),
    notes: draft.notes,
  };
}

/** The details that differ from the Beat's, for a partial update. */
export function changedDetails(beat: Beat, details: BeatDetails): Partial<BeatDetails> {
  const changes: Partial<BeatDetails> = {};
  for (const field of Object.keys(details) as (keyof BeatDetails)[]) {
    if (details[field] !== beat[field]) Object.assign(changes, { [field]: details[field] });
  }
  return changes;
}
