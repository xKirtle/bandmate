import type { Status } from './api';
import { transposeKey } from './transpose';
import { transposeText } from './transposeAmount';

/** Whether the Song page offers editing (Write) or only shows the Song to play from (Read). */
export type Mode = 'write' | 'read';

/**
 * The mode a Song opens in: Read once it's Finished, so it can't be changed
 * by accident while playing from it. Switching lasts only for the visit.
 */
export function openingMode(status: Status): Mode {
  return status === 'finished' ? 'read' : 'write';
}

/**
 * A Song's Details as one line of text, as Read mode shows them, e.g. "C#m · 92 BPM · Capo 2 · Standard".
 * With the Chords transposed by semitones, a readable key shows as the one
 * they're shown in, with the written one: "A (written G)".
 */
export function detailsSummary(
  details: { key: string; bpm: string; capo: string; tuning: string },
  transpose = 0,
): string {
  const key = details.key.trim();
  const shownKey = transposeKey(key, transpose);
  const bpm = details.bpm.trim();
  const capo = details.capo.trim();
  const tuning = details.tuning.trim();
  return [shownKey ? `${shownKey} (written ${key})` : key, bpm && `${bpm} BPM`, capo && `Capo ${capo}`, tuning]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A Song's Details as one line of text, as they print, e.g. "G · transposed +2 · Capo 2 · Drop D · 92 BPM":
 * what sets up the instrument first, then the BPM. The Key is as written,
 * so the paper never claims a Key the Song isn't in, with how far the Chords
 * are transposed beside it.
 */
export function printedDetails(
  details: { key: string; bpm: string; capo: string; tuning: string },
  transpose = 0,
): string {
  const key = details.key.trim();
  const amount = transpose === 0 ? '' : transposeText(transpose);
  const bpm = details.bpm.trim();
  const capo = details.capo.trim();
  const tuning = details.tuning.trim();
  const keyed = amount && (key ? `${key} · transposed ${amount}` : `Transposed ${amount}`);
  return [keyed || key, capo && `Capo ${capo}`, tuning, bpm && `${bpm} BPM`].filter(Boolean).join(' · ');
}

/** A part of the Song page kept beside the Lyric Sheet on desktop, and after it on narrower windows. */
export type SidePart = 'rhymes' | 'scrapbook' | 'masters';

/**
 * The side column's parts in order, and whether each starts open on desktop.
 * Write mode gives the Scrapbook the room, with the Masters folded away
 * beneath it, and Rhymes above it in Rhyme mode, nearest the top so they
 * stay in sight as the Lines are written; Read mode has no Scrapbook or
 * Rhymes, so the Masters show.
 */
export function sideParts(mode: Mode, { rhymes = false } = {}): { part: SidePart; open: boolean }[] {
  return mode === 'write'
    ? [
        ...(rhymes ? [{ part: 'rhymes' as const, open: true }] : []),
        { part: 'scrapbook', open: true },
        { part: 'masters', open: false },
      ]
    : [{ part: 'masters', open: true }];
}
