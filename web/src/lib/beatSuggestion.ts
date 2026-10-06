// Suggested details for a Beat being uploaded, worked out from the file's
// tags where it has them and otherwise from its filename, e.g.
// "dark_trap_140bpm_Am.wav" suggests "Dark Trap" at 140 BPM in Am.
import type { BeatDetails, Fetched } from './api';

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
// A bare number reads as a BPM only in a tempo's range and beside a key, so
// "Room 101" keeps its number.
const bareBpmPattern = new RegExp(`${start}(\\d{2,3})${end}`);
const bareBpmRange = { min: 60, max: 200 };

// A key needs an accidental or a quality, so a lone capital ("A Day") isn't
// one. A lowercase "m" is minor; spelled-out qualities take any case. Either
// may stand apart, e.g. "F# m" or "Bb major".
const quality = '[Mm][Ii][Nn](?:[Oo][Rr])?|[Mm][Aa][Jj](?:[Oo][Rr])?';
const keyPattern = new RegExp(`${start}([A-G])([#b])?(?:(m|${quality})|[\\s_-]+(m|${quality}))?${end}`, 'g');
// A key tag holds only the key, so a lone letter is one.
const keyTagPattern = new RegExp(`^([A-Ga-g])([#b])?\\s*(m|${quality})?$`);

// "(prod. Kofi)", "[Prod. By Kofi]", or "produced by Kofi" up to the next
// "|", " - " or bracket.
const producerPatterns = [
  /[([]\s*prod(?:uced)?\.?\s*(?:by\s+)?([^)\]]+?)\s*[)\]]/i,
  /(?<![A-Za-z])prod(?:uced)?\.?\s+(?:by\s+)?(.+?)\s*(?=\||\s-\s|[([]|$)/i,
];
// Tags uploaders add that aren't part of a title.
const freePattern = /[([]\s*free\s*[)\]]/gi;

/** "Ebm" for Eb and "min", "F#" for f# and "major". */
function keyName(root: string, accidental: string | undefined, quality: string | undefined): string {
  const minor = quality !== undefined && !quality.toLowerCase().startsWith('maj');
  return `${root.toUpperCase()}${accidental ?? ''}${minor ? 'm' : ''}`;
}

// A value found in a filename, and the text it was read from.
interface Found<T> {
  value: T;
  text: string;
}

function findProducer(name: string): Found<string> | null {
  for (const pattern of producerPatterns) {
    const match = name.match(pattern);
    if (match) return { value: match[1].trim(), text: match[0] };
  }
  return null;
}

function findBpm(name: string, besideKey: boolean): Found<number> | null {
  for (const pattern of bpmPatterns) {
    const match = name.match(pattern);
    if (match) return { value: Math.round(Number(match[1])), text: match[0] };
  }
  const bare = besideKey ? name.match(bareBpmPattern) : null;
  const bpm = bare ? Number(bare[1]) : NaN;
  return bare && bpm >= bareBpmRange.min && bpm <= bareBpmRange.max ? { value: bpm, text: bare[0] } : null;
}

/**
 * Whether a key-like word sits among the words of a title, e.g. "Who Am I",
 * "I Am Legend" or "Ab-Soul", and so is read as a word.
 */
function amongWords(before: string, after: string): boolean {
  return (/[A-Za-z] $/.test(before) && /^ [A-Za-z]/.test(after)) || /^-[A-Za-z]/.test(after);
}

function findKey(name: string): Found<string> | null {
  for (const match of name.matchAll(keyPattern)) {
    const [text, root, accidental, joined, apart] = match;
    const spelled = joined ?? apart;
    if (!accidental && !spelled) continue;
    if (amongWords(name.slice(0, match.index), name.slice(match.index + text.length))) continue;
    return { value: keyName(root, accidental, spelled), text };
  }
  return null;
}

/**
 * What's left of a filename once the producer, BPM and key are taken out,
 * tidied into a title. An all-lowercase name gets capitals; one with any keeps
 * its own.
 */
function cleanTitle(name: string, found: string[]): string {
  let title = name;
  for (const text of found) title = title.replace(text, ' ');
  title = title
    .replace(freePattern, ' ')
    .replaceAll('_', ' ')
    // Brackets left empty, e.g. "(A minor, 85bpm)".
    .replace(/[([{][\s,-]*[)\]}]/g, ' ')
    // Dashes left doubled, e.g. "sunset - BPM 92 - Ebmin".
    .replace(/\s+-(?:\s+-)+\s+/g, ' - ')
    .replace(/^[\s,|-]+|[\s,|-]+$/g, '')
    .replace(/\s+/g, ' ');
  if (title !== title.toLowerCase()) return title;
  return title.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/** "C♯m" as "C#m", the way it's typed. */
function plainAccidentals(text: string): string {
  return text.replaceAll('♯', '#').replaceAll('♭', 'b');
}

/** A key tag as keys are written, or as it is if it's in another notation. */
function tagKey(key: string): string {
  const match = key.match(keyTagPattern);
  return match ? keyName(match[1], match[2], match[3]) : key;
}

/** What a link gave of a Beat fetched from it. "" where it gave nothing. */
export type LinkDetails = Pick<Fetched, 'title' | 'producer' | 'sourceLink' | 'fileName'>;

/**
 * A Beat's details from a link: its title, channel and link as the link gave
 * them, and the rest suggested as for an upload, from the file's tags and
 * then the title, e.g. a "140 BPM" in it.
 */
export function suggestFromLink(link: LinkDetails, tags: BeatTags = {}): BeatSuggestion & { sourceLink: string } {
  const file = suggestBeatDetails(link.fileName, tags);
  return {
    title: link.title.trim() || file.title,
    producer: link.producer.trim() || file.producer,
    sourceLink: link.sourceLink,
    bpm: file.bpm,
    key: file.key,
  };
}

/** A file's details: its tags where it has them, otherwise read from its filename. */
export function suggestBeatDetails(fileName: string, tags: BeatTags = {}): BeatSuggestion {
  const name = plainAccidentals(fileName.replace(/\.[^.]+$/, ''));
  const producer = findProducer(name);
  // Read without the producer, whose name may look like a key.
  const rest = producer ? name.replace(producer.text, ' ') : name;
  const key = findKey(rest);
  const bpm = findBpm(rest, key !== null);
  const found = [bpm?.text, key?.text].filter((text) => text !== undefined);
  const title = tags.title?.trim();
  const tagBpm = tags.bpm !== undefined && tags.bpm > 0 ? Math.round(tags.bpm) : null;
  const keyTag = plainAccidentals(tags.key?.trim() ?? '');
  return {
    // A name that's nothing but a BPM and key is kept whole.
    title: title || cleanTitle(rest, found) || name,
    producer: tags.artist?.trim() || (producer?.value ?? ''),
    bpm: tagBpm ?? bpm?.value ?? null,
    key: keyTag ? tagKey(keyTag) : (key?.value ?? ''),
  };
}
