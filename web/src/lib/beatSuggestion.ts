// Suggested details for a Beat being uploaded, worked out from the file's
// tags where it has them and otherwise from its filename, e.g.
// "dark_trap_140bpm_Am.wav" suggests "Dark Trap" at 140 BPM in Am.
import type { BeatDetails } from './api';

/** Details a file suggests. "" and null mean it suggests nothing for that field. */
export type BeatSuggestion = Pick<BeatDetails, 'title' | 'producer' | 'bpm' | 'key'>;

/** The tags an audio file carries, where its format has them. */
export interface BeatTags {
  title?: string;
  artist?: string;
  bpm?: number;
  key?: string;
}

// Where a word starts and ends in a filename: separators are anything but
// letters, digits and sharps, so "_", "-", spaces and brackets all count.
const start = String.raw`(?<![A-Za-z0-9#.])`;
const end = String.raw`(?![A-Za-z0-9#])`;

const number = String.raw`(\d{2,3}(?:\.\d+)?)`;
const bpmPatterns = [
  new RegExp(`${start}${number}\\s*bpm${end}`, 'i'),
  new RegExp(`${start}bpm[\\s_-]*${number}${end}`, 'i'),
];
// A bare number reads as a BPM only where a tempo is likely.
const bareBpmPattern = new RegExp(`${start}(\\d{2,3})${end}`);
const bareBpmRange = { min: 60, max: 200 };

// A key needs an accidental or a quality, so a lone capital ("A Day") isn't
// one. A lowercase "m" is minor; spelled-out qualities take any case and may
// stand apart, e.g. "Bb major".
const quality = '[Mm][Ii][Nn](?:[Oo][Rr])?|[Mm][Aa][Jj](?:[Oo][Rr])?';
const keyPattern = new RegExp(`${start}([A-G])([#b])?(?:(m|${quality})|[\\s_-]+(${quality}))?${end}`, 'g');
// A key tag holds only the key, so a lone capital is one.
const keyTagPattern = new RegExp(`^([A-G])([#b])?\\s*(m|${quality})?$`);

/** "Ebm" for Eb and "min", "F#" for F# and "major". */
function keyName(root: string, accidental: string | undefined, quality: string | undefined): string {
  const minor = quality !== undefined && !quality.toLowerCase().startsWith('maj');
  return `${root}${accidental ?? ''}${minor ? 'm' : ''}`;
}

// A value found in a filename, and the text it was read from.
interface Found<T> {
  value: T;
  text: string;
}

function findBpm(name: string): Found<number> | null {
  for (const pattern of bpmPatterns) {
    const match = name.match(pattern);
    if (match) return { value: Math.round(Number(match[1])), text: match[0] };
  }
  const bare = name.match(bareBpmPattern);
  const bpm = bare ? Number(bare[1]) : NaN;
  return bare && bpm >= bareBpmRange.min && bpm <= bareBpmRange.max ? { value: bpm, text: bare[0] } : null;
}

function findKey(name: string): Found<string> | null {
  for (const [text, root, accidental, joined, apart] of name.matchAll(keyPattern)) {
    const q = joined ?? apart;
    if (!accidental && !q) continue;
    return { value: keyName(root, accidental, q), text };
  }
  return null;
}

/**
 * What's left of a filename once the BPM and key are taken out, tidied into a
 * title. An all-lowercase name gets capitals; one with any keeps its own.
 */
function cleanTitle(name: string, found: string[]): string {
  let title = name;
  for (const text of found) title = title.replace(text, ' ');
  title = title
    .replaceAll('_', ' ')
    // Brackets left empty, e.g. "(A minor, 85bpm)".
    .replace(/[([{][\s,-]*[)\]}]/g, ' ')
    // Dashes left doubled, e.g. "sunset - BPM 92 - Ebmin".
    .replace(/\s+-(?:\s+-)+\s+/g, ' - ')
    .replace(/^[\s,-]+|[\s,-]+$/g, '')
    .replace(/\s+/g, ' ');
  if (title !== title.toLowerCase()) return title;
  return title.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/** "C♯m" as "C#m", the way it's typed. */
function plainAccidentals(text: string): string {
  return text.replaceAll('♯', '#').replaceAll('♭', 'b');
}

/** A key tag in the form Keys take, or as it is if it's in another notation. */
function tagKey(key: string): string {
  const match = key.match(keyTagPattern);
  return match ? keyName(match[1], match[2], match[3]) : key;
}

/** A file's details: its tags where it has them, otherwise read from its filename. */
export function suggestBeatDetails(fileName: string, tags: BeatTags = {}): BeatSuggestion {
  const name = plainAccidentals(fileName.replace(/\.[^.]+$/, ''));
  const bpm = findBpm(name);
  const key = findKey(name);
  const found = [bpm?.text, key?.text].filter((text) => text !== undefined);
  const title = tags.title?.trim();
  const tagBpm = tags.bpm !== undefined && tags.bpm > 0 ? Math.round(tags.bpm) : null;
  const keyTag = plainAccidentals(tags.key?.trim() ?? '');
  return {
    // A name that's nothing but a BPM and key is kept whole.
    title: title || cleanTitle(name, found) || name,
    producer: tags.artist?.trim() ?? '',
    bpm: tagBpm ?? bpm?.value ?? null,
    key: keyTag ? tagKey(keyTag) : (key?.value ?? ''),
  };
}
