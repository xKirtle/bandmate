import type { Section } from './api';
import { isBlank } from './cues';

/** How a Section is named in lists: its Label, else its first Line. */
export function describe(section: Section): string {
  const first = section.alternates.find((a) => a.active)?.lines.find((l) => l.lyrics.trim())?.lyrics.trim();
  return section.label || (first ? `“${first}”` : 'Section without a Label');
}

/**
 * Whether nothing is written in any of a Section's Alternates: no Lines, or
 * only blank ones. Taken out of the Arrangement, such a Section is deleted
 * rather than kept in the Scrapbook.
 */
export function isEmpty(section: Section): boolean {
  return section.alternates.every((a) => a.lines.every(isBlank));
}
