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
