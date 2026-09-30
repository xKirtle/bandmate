import { describe, expect, it } from 'vitest';
import { carriesFiles, fileDropTrack, importEach } from './fileDrop';

describe('carriesFiles', () => {
  it('is true for files dragged in from outside the page', () => {
    expect(carriesFiles(['Files'])).toBe(true);
    expect(carriesFiles(['text/uri-list', 'Files'])).toBe(true);
  });

  it('is false for text, links or anything else dragged', () => {
    expect(carriesFiles(['text/plain'])).toBe(false);
    expect(carriesFiles(['text/uri-list', 'text/html'])).toBe(false);
    expect(carriesFiles([])).toBe(false);
  });
});

// The Tracks area from 100px to 400px down the page: the ruler, then three
// Tracks 80px tall, with room left below the last.
const area = { top: 100, bottom: 400 };
const rows = [
  { top: 130, bottom: 210 },
  { top: 210, bottom: 290 },
  { top: 290, bottom: 370 },
];
const tracks = [7, 8, 9];
const chosen = 8;

describe('fileDropTrack', () => {
  it('is the Track whose row the files are over', () => {
    expect(fileDropTrack(140, area, rows, tracks, chosen)).toBe(7);
    expect(fileDropTrack(250, area, rows, tracks, chosen)).toBe(8);
    expect(fileDropTrack(369, area, rows, tracks, chosen)).toBe(9);
  });

  it('is the Chosen Track below the last Track', () => {
    expect(fileDropTrack(380, area, rows, tracks, chosen)).toBe(8);
  });

  it('is the Chosen Track below the Tracks area, e.g. in the Timeline under it', () => {
    expect(fileDropTrack(450, area, rows, tracks, chosen)).toBe(8);
  });

  it('is the Chosen Track under the area, even where a Track scrolled out of view would be', () => {
    const scrolled = [
      { top: 250, bottom: 330 },
      { top: 330, bottom: 410 },
      { top: 410, bottom: 490 },
    ];
    expect(fileDropTrack(420, area, scrolled, tracks, chosen)).toBe(8);
  });

  it('is nothing above the first Track, e.g. over the ruler or the toolbar', () => {
    expect(fileDropTrack(120, area, rows, tracks, chosen)).toBeNull();
    expect(fileDropTrack(50, area, rows, tracks, chosen)).toBeNull();
  });
});

describe('importEach', () => {
  it('imports each file in turn, in the order dropped, starting one once the last is done', async () => {
    const log: string[] = [];
    await importEach(['a', 'b', 'c'], async (f) => {
      log.push(`start ${f}`);
      await new Promise((r) => setTimeout(r, f === 'a' ? 10 : 0));
      log.push(`done ${f}`);
    });
    expect(log).toEqual(['start a', 'done a', 'start b', 'done b', 'start c', 'done c']);
  });

  it('goes on past a file refused, and gives what each refusal said', async () => {
    const imported: string[] = [];
    const refused = await importEach(['a.mp3', 'b.txt', 'c.wav', 'd.zip'], async (f) => {
      if (!/\.(mp3|wav)$/.test(f)) throw new Error(`“${f}” can't be played`);
      imported.push(f);
    });
    expect(imported).toEqual(['a.mp3', 'c.wav']);
    expect(refused).toEqual(["“b.txt” can't be played", "“d.zip” can't be played"]);
  });
});
