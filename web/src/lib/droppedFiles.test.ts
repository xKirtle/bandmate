import { describe, expect, it } from 'vitest';
import { audioDropped, filesIn, skippedNote, type DroppedEntry } from './droppedFiles';

// Stand-ins for what a drop gives: a file, or a folder whose reader hands
// its entries back a few at a time, as browsers do, then nothing.
function file(name: string): DroppedEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (done) => done(new File(['x'], name)),
  };
}

function folder(name: string, entries: DroppedEntry[], perRead = 2): DroppedEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (done) => {
          const batch = entries.slice(at, at + perRead);
          at += batch.length;
          setTimeout(() => done(batch));
        },
      };
    },
  };
}

const names = (files: File[]) => files.map((f) => f.name);

describe('filesIn', () => {
  it('is the files dropped', async () => {
    expect(names(await filesIn([file('a.mp3'), file('b.wav')]))).toEqual(['a.mp3', 'b.wav']);
  });

  it('reads a folder dropped, with its subfolders, however many entries it has', async () => {
    const dropped = [
      folder('Beats', [
        file('one.mp3'),
        folder('Old', [file('two.wav'), folder('Older', [file('three.flac')])]),
        file('four.mp3'),
        file('five.mp3'),
        file('six.mp3'),
      ]),
      file('loose.mp3'),
    ];
    expect(names(await filesIn(dropped)).sort()).toEqual(
      ['five.mp3', 'four.mp3', 'loose.mp3', 'one.mp3', 'six.mp3', 'three.flac', 'two.wav'].sort(),
    );
  });

  it('is nothing for an empty folder', async () => {
    expect(await filesIn([folder('Empty', [])])).toEqual([]);
  });

  it('leaves out a file or folder that cannot be read, keeping the rest', async () => {
    const broken: DroppedEntry = {
      isFile: true,
      isDirectory: false,
      name: 'gone.mp3',
      file: (_, fail) => fail?.(new Error('gone')),
    };
    const locked: DroppedEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Locked',
      createReader: () => ({ readEntries: (_, fail) => fail?.(new Error('denied')) }),
    };
    expect(names(await filesIn([broken, locked, file('kept.mp3')]))).toEqual(['kept.mp3']);
  });
});

describe('audioDropped', () => {
  const typed = (name: string, type: string) => new File(['x'], name, { type });

  it('keeps the audio files and counts the rest as skipped', () => {
    const dropped = [
      typed('one.mp3', 'audio/mpeg'),
      typed('notes.txt', 'text/plain'),
      typed('two.wav', 'audio/wav'),
      typed('cover.jpg', 'image/jpeg'),
      typed('project.zip', 'application/zip'),
    ];
    const { audio, skipped } = audioDropped(dropped);
    expect(names(audio)).toEqual(['one.mp3', 'two.wav']);
    expect(skipped).toBe(3);
  });

  it('goes by the file name where the browser gives no type', () => {
    const { audio, skipped } = audioDropped([typed('take.OPUS', ''), typed('one.flac', ''), typed('readme', '')]);
    expect(names(audio)).toEqual(['take.OPUS', 'one.flac']);
    expect(skipped).toBe(1);
  });

  it('keeps an audio file the browser gives another type, going by its name', () => {
    const { audio, skipped } = audioDropped([
      typed('loop.ogg', 'video/ogg'),
      typed('one.flac', 'application/octet-stream'),
    ]);
    expect(names(audio)).toEqual(['loop.ogg', 'one.flac']);
    expect(skipped).toBe(0);
  });

  it('leaves out hidden files without counting them, e.g. a folder’s .DS_Store', () => {
    const { audio, skipped } = audioDropped([
      typed('.DS_Store', ''),
      typed('._one.mp3', 'audio/mpeg'),
      typed('one.mp3', 'audio/mpeg'),
    ]);
    expect(names(audio)).toEqual(['one.mp3']);
    expect(skipped).toBe(0);
  });
});

describe('skippedNote', () => {
  it('says how many files were skipped', () => {
    expect(skippedNote(3)).toBe("Skipped 3 files that aren't audio");
    expect(skippedNote(1)).toBe("Skipped 1 file that isn't audio");
  });

  it('is nothing when none were', () => {
    expect(skippedNote(0)).toBeNull();
  });
});
