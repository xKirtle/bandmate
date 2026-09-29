import type { Alternate, Section } from './api';
import { isBlank } from './cues';

/** The Alternate whose Lines are sung. The server guarantees exactly one. */
export function activeAlternate(section: Section | undefined): Alternate | undefined {
  return section?.alternates.find((a) => a.active);
}

/** How an Alternate is called: its name, else its place among its Section's Alternates. */
export function alternateName(section: Section, alt: Alternate): string {
  return alt.name || `Alternate ${section.alternates.indexOf(alt) + 1}`;
}

/**
 * What a Section's header shows of its Alternates, e.g. "Darker · 1 of 3": the
 * active one's name and its place. Null with only one, as there's nothing to choose.
 */
export function alternatesEntry(section: Section): { name: string; place: string } | null {
  const n = section.alternates.length;
  const active = activeAlternate(section);
  if (n < 2 || !active) return null;
  return { name: alternateName(section, active), place: `${section.alternates.indexOf(active) + 1} of ${n}` };
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
