// A Sound's name, worked out when it's imported: its file's title tag, or
// else its filename without the extension, as it is. Unlike a Beat's title,
// nothing is read out of the filename, and the name never changes after.
import { readTags } from './beatTags';
import type { BeatTags } from './beatSuggestion';

/** The name a file gives its Sound, from its title tag if it has one. */
export function soundName(fileName: string, tags: Pick<BeatTags, 'title'> = {}): string {
  return tags.title?.trim() || fileName.replace(/\.[^.]+$/, '');
}

/** Reads a file's tags to name its Sound. */
export async function nameSound(file: File): Promise<string> {
  return soundName(file.name, await readTags(file));
}
