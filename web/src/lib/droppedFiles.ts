// Files and folders dropped from the computer onto the Beat Library: the
// files a drop holds, its folders read with their subfolders, and which of
// them are audio.

/**
 * A file or folder dropped, as far as reading it goes: the parts of the
 * browser's FileSystemEntry used here, so a drop can be stood in for.
 */
export type DroppedEntry =
  | {
      isFile: true;
      isDirectory: false;
      name: string;
      file: (done: (file: File) => void, fail?: (error: unknown) => void) => void;
    }
  | {
      isFile: false;
      isDirectory: true;
      name: string;
      createReader: () => {
        readEntries: (done: (entries: DroppedEntry[]) => void, fail?: (error: unknown) => void) => void;
      };
    };

/**
 * What a drop holds, as files and folders to read, or null where the browser
 * can't tell folders from files, and only its files can be read. It must be
 * asked while the drop is handled: once that's over, the drop is emptied.
 */
export function entriesDropped(data: DataTransfer): DroppedEntry[] | null {
  const items = [...data.items].filter((item) => item.kind === 'file');
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.some((entry) => entry === null)) return null;
  return entries as unknown as DroppedEntry[];
}

/**
 * The files dropped, and those in each folder dropped and its subfolders. A
 * file or folder the browser can't read is left out, keeping the rest.
 */
export async function filesIn(entries: readonly DroppedEntry[]): Promise<File[]> {
  const files = await Promise.all(entries.map(filesInEntry));
  return files.flat();
}

/** The file an entry is, or the files in the folder it is and its subfolders. */
async function filesInEntry(entry: DroppedEntry): Promise<File[]> {
  try {
    if (entry.isFile) return [await new Promise<File>((done, fail) => entry.file(done, fail))];
    return await filesIn(await folderEntries(entry));
  } catch {
    return [];
  }
}

/** A folder's entries: its reader gives them a few at a time, until it gives none. */
async function folderEntries(folder: Extract<DroppedEntry, { isDirectory: true }>): Promise<DroppedEntry[]> {
  const reader = folder.createReader();
  const all: DroppedEntry[] = [];
  for (;;) {
    const some = await new Promise<DroppedEntry[]>((done, fail) => reader.readEntries(done, fail));
    if (some.length === 0) return all;
    all.push(...some);
  }
}

// Audio a browser may give no type, or another, going by the file name's
// extension: those the upload hint names, and others browsers commonly play.
const audioExtensions = /\.(mp3|wav|flac|m4a|ogg|oga|opus|aac|aif|aiff|weba)$/i;

function isAudio(file: File): boolean {
  return file.type.startsWith('audio/') || audioExtensions.test(file.name);
}

/**
 * The audio files among those dropped, as picking would offer them, and how
 * many weren't audio. Hidden files, e.g. a folder's .DS_Store, aren't
 * something the user meant to drop, so they're left out without being counted.
 */
export function audioDropped(files: readonly File[]): { audio: File[]; skipped: number } {
  const shown = files.filter((file) => !file.name.startsWith('.'));
  const audio = shown.filter(isAudio);
  return { audio, skipped: shown.length - audio.length };
}

/** What to say of the files skipped for not being audio, if any were. */
export function skippedNote(skipped: number): string | null {
  if (skipped === 0) return null;
  return skipped === 1 ? "Skipped 1 file that isn't audio" : `Skipped ${skipped} files that aren't audio`;
}
