import type { Status } from './api';

/** Whether the Song page offers editing (Write) or only shows the Song to play from (Read). */
export type Mode = 'write' | 'read';

/**
 * The mode a Song opens in: Read once it's Finished, so it can't be changed
 * by accident while playing from it. Switching lasts only for the visit.
 */
export function openingMode(status: Status): Mode {
  return status === 'finished' ? 'read' : 'write';
}

/** A Song's Details as one line of text, as Read mode shows them, e.g. "C#m · 92 BPM · Capo 2 · Standard". */
export function detailsSummary(details: { key: string; bpm: string; capo: string; tuning: string }): string {
  const key = details.key.trim();
  const bpm = details.bpm.trim();
  const capo = details.capo.trim();
  const tuning = details.tuning.trim();
  return [key, bpm && `${bpm} BPM`, capo && `Capo ${capo}`, tuning].filter(Boolean).join(' · ');
}

/** A part of the Song page kept beside the Lyric Sheet on desktop, and after it on narrower windows. */
export type SidePart = 'scrapbook' | 'masters';

/**
 * The side column's parts in order, and whether each starts open on desktop.
 * Write mode gives the Scrapbook the room, with the Masters folded away
 * beneath it; Read mode has no Scrapbook, so the Masters show.
 */
export function sideParts(mode: Mode): { part: SidePart; open: boolean }[] {
  return mode === 'write'
    ? [
        { part: 'scrapbook', open: true },
        { part: 'masters', open: false },
      ]
    : [{ part: 'masters', open: true }];
}
