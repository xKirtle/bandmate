// A Beat's details as its form's inputs hold them: numbers stay text while
// typing.
import type { Beat, BeatDetails } from './api';
import type { BeatSuggestion } from './beatSuggestion';

export interface BeatDraft {
  title: string;
  producer: string;
  sourceLink: string;
  bpm: string;
  key: string;
  notes: string;
}

/** A draft of a Beat's details, or of a new Beat's suggested ones. */
export function toDraft(beat: Partial<BeatDetails> | null): BeatDraft {
  return {
    title: beat?.title ?? '',
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

/**
 * The suggested values a draft doesn't already hold, e.g. to offer after
 * replacing a Beat's file. Fields the file suggests nothing for are left out.
 */
export function offeredChanges(draft: BeatDraft, suggestion: BeatSuggestion): Partial<BeatDraft> {
  const suggested = toDraft(suggestion);
  const changes: Partial<BeatDraft> = {};
  for (const field of Object.keys(suggestion) as (keyof BeatSuggestion)[]) {
    const value = suggested[field];
    if (value !== '' && value !== draft[field].trim()) changes[field] = value;
  }
  return changes;
}

/** An offer of changes in a line, e.g. “Night Drive” · by Pryme · 140 BPM · Am. */
export function describeOffer(changes: Partial<BeatDraft>): string {
  return [
    changes.title && `“${changes.title}”`,
    changes.producer && `by ${changes.producer}`,
    changes.bpm && `${changes.bpm} BPM`,
    changes.key,
  ]
    .filter(Boolean)
    .join(' · ');
}
