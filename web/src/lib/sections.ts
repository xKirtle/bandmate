import type { Alternate, Section } from './api';
import { isBlank } from './cues';

/** The Alternate whose Lines are sung. The server guarantees exactly one. */
export function activeAlternate(section: Section | undefined): Alternate | undefined {
  return section?.alternates.find((a) => a.active);
}

/** How a Section is named where it's shown in full: its Label, if it has one. */
export function labelOf(section: Section): string {
  return section.label || 'Section without a Label';
}

/** How a Section is named in lists: its Label, else its first Line. */
export function describe(section: Section): string {
  const first = activeAlternate(section)?.lines.find((l) => l.lyrics.trim())?.lyrics.trim();
  return section.label || (first ? `“${first}”` : labelOf(section));
}

/**
 * Whether nothing is written in any of a Section's Alternates: no Lines, or
 * only blank ones. Taken out of the Arrangement, such a Section is deleted
 * rather than kept in the Scrapbook.
 */
export function isEmpty(section: Section): boolean {
  return section.alternates.every((a) => a.lines.every(isBlank));
}

/** How many Lines a Scrapbook card shows before "+N more Lines". */
const CARD_LINES = 4;

/**
 * What a Scrapbook Section's card shows at rest: the first Lines of its active
 * Alternate as written, how many more there are, and how many Alternates it has.
 */
export function card(section: Section): { lines: string[]; more: number; alternates: number } {
  const lines = activeAlternate(section)?.lines ?? [];
  return {
    lines: lines.slice(0, CARD_LINES).map((l) => l.text),
    more: Math.max(0, lines.length - CARD_LINES),
    alternates: section.alternates.length,
  };
}
