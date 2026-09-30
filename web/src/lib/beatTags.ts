// Reads an audio file's tags in the browser (e.g. ID3 in mp3, Vorbis comments
// in flac and ogg) to suggest a Beat's details, or name a Sound, before it's
// uploaded.
import { suggestBeatDetails, type BeatSuggestion, type BeatTags } from './beatSuggestion';

/** The tags a file carries; none if its format has none or they can't be read. */
export async function readTags(file: File): Promise<BeatTags> {
  try {
    // Loaded on first use: only uploading needs it.
    const { parseBlob } = await import('music-metadata');
    const { common, native } = await parseBlob(file, { duration: false, skipCovers: true });
    // DJ software writes a Vorbis comment's key as INITIALKEY, which the
    // library doesn't map.
    const initialKey = Object.values(native)
      .flat()
      .find((tag) => tag.id.toUpperCase() === 'INITIALKEY')?.value;
    const key = common.key ?? (typeof initialKey === 'string' ? initialKey : undefined);
    return { title: common.title, artist: common.artist, bpm: common.bpm, key };
  } catch {
    return {};
  }
}

/** The details a file suggests for its Beat, from its tags and filename. */
export async function suggestForFile(file: File): Promise<BeatSuggestion> {
  return suggestBeatDetails(file.name, await readTags(file));
}
