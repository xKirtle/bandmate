import type { Section } from './api';

/** How a Section is named in lists: its Label, else its first Line. */
export function describe(section: Section): string {
  const first = section.alternates.find((a) => a.active)?.lines.find((l) => l.lyrics.trim())?.lyrics.trim();
  return section.label || (first ? `“${first}”` : 'Section without a Label');
}
