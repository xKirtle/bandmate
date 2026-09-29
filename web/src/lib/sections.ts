import type { Alternate, Section, Song } from './api';
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
 * How ⇄, the way into a Section's Alternates mode, is named, e.g.
 * "Alternates · Darker · 1 of 3": with two or more, the active one's name and
 * its place.
 */
export function alternatesLabel(section: Section): string {
  const n = section.alternates.length;
  const active = activeAlternate(section);
  if (n < 2 || !active) return 'Alternates';
  return `Alternates · ${alternateName(section, active)} · ${section.alternates.indexOf(active) + 1} of ${n}`;
}

/** The Sections in a Song's Arrangement, in order. `sections` holds the Song's Sections by id. */
export function sectionsInArrangement(song: Song, sections: Map<number, Section>): Section[] {
  return song.arrangement.flatMap((id) => sections.get(id) ?? []);
}

/** A place in the Lyric Sheet a Section can go, and how it's named in lists. */
export type Place = { position: number; name: string };

/**
 * Where a Section can go in the Lyric Sheet, e.g. one put back from the
 * Scrapbook: at the start, or after any of the Sections in it, `inArrangement`.
 */
export function places(inArrangement: Section[]): Place[] {
  return [
    { position: 0, name: 'At the start' },
    ...inArrangement.map((s, i) => ({ position: i + 1, name: `After ${i + 1}. ${describe(s)}` })),
  ];
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

/** The notice a Section added to another as Alternates leaves, e.g. "Hook added to Verse 1 as an Alternate". */
export function addedNotice(added: Section, to: Section): string {
  const as = added.alternates.length === 1 ? 'an Alternate' : 'Alternates';
  return `${describe(added)} added to ${describe(to)} as ${as}`;
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
