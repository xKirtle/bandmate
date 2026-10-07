import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from './api';
import { LyricSheetEditing } from './lyricSheetEditing.svelte';
import { Saves } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';

/** A Song of one Section, the Verse, whose one Alternate has two Lines. */
const verseSong = () =>
  emptySong({
    arrangement: [1],
    sections: [
      {
        id: 1,
        label: 'Verse',
        alternates: [
          {
            id: 1,
            name: '',
            active: true,
            lines: [
              { id: 10, text: 'One', lyrics: 'One', chords: [], chordLine: false, cue: null },
              { id: 11, text: 'Two', lyrics: 'Two', chords: [], chordLine: false, cue: null },
            ],
          },
        ],
      },
    ],
  });

/** The text of the Verse's Alternate. */
const textOf = (song: Song) => song.sections[0].alternates[0].lines.map((l) => l.text).join('\n');

/** The Verse's Alternate's Lines changed to the text given, a row each, as changed elsewhere. */
const withText = (song: Song, text: string): Partial<Song> => {
  const [verse] = song.sections;
  const [alternate] = verse.alternates;
  const lines = text.split('\n').map((t, i) => ({ ...alternate.lines[i], text: t, lyrics: t }));
  return { sections: [{ ...verse, alternates: [{ ...alternate, lines }] }] };
};

/** Lyric Sheet editing on top of Saves for the Song the server holds, as the Song page makes it. */
async function editingFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  let editing: LyricSheetEditing | null = null;
  const saves = new Saves({ server, song, timeline, editsOutside: () => editing?.unsaved ?? false });
  editing = new LyricSheetEditing(saves);
  return { saves, editing };
}

/** Lets everything waiting on the fake server's answers run. */
const settled = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Lyric Sheet editing, an Alternate's text", () => {
  it('saves 800 ms after the last keystroke', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThr');
    await vi.advanceTimersByTimeAsync(500);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(799);
    expect(server.landed).toBe(0);
    expect(editing.unsaved).toBe(true);
    expect(saves.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await settled();
    expect(server.landed).toBe(1);
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(textOf(saves.song)).toBe('One\nTwo\nThree');
    expect(box.text).toBe('One\nTwo\nThree');
    expect(editing.unsaved).toBe(false);
    expect(saves.unsaved).toBe(false);
  });

  it('saves at once on blur', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.blur();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(editing.unsaved).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(server.landed).toBe(1);
  });

  it('sends nothing on blur when the text is back as saved', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.type('One\nTwo');
    box.blur();
    await settled();
    expect(server.landed).toBe(0);
    expect(editing.unsaved).toBe(false);
  });

  it('saves at once when the box closes, as leaving the page does without a blur', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.close();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(editing.unsaved).toBe(false);
  });

  it('keeps the text after a failed save, shows the save error, and sends it again on the next keystroke', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(1);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(box.text).toBe('One\nTwo\nThree');
    expect(textOf(saves.song)).toBe('One\nTwo');
    expect(editing.unsaved).toBe(true);
    // It isn't tried again by itself.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.landed).toBe(0);
    box.type('One\nTwo\nThree!');
    await vi.advanceTimersByTimeAsync(800);
    expect(textOf(server.song)).toBe('One\nTwo\nThree!');
    expect(saves.saveError).toBeNull();
    expect(editing.unsaved).toBe(false);
  });

  it('sends a failed save again on blur, though the text is as it was', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(1);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(editing.unsaved).toBe(true);
    box.blur();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(saves.saveError).toBeNull();
    expect(editing.unsaved).toBe(false);
  });

  it("keeps its own text over the server's while a save is on its way, or failed", async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    // A Tag saved ahead of it, on its way, moves the Song on, its text as it was.
    const release = server.holdNextAnswer();
    const tagging = saves.setTags(['Live']);
    box.focus();
    box.type('Mine');
    box.blur();
    expect(box.text).toBe('Mine');
    release();
    await tagging;
    expect(textOf(saves.song)).toBe('One\nTwo');
    expect(box.text).toBe('Mine');
    await settled();
    expect(textOf(saves.song)).toBe('Mine');

    server.failNext(1);
    box.focus();
    box.type('Mine, failed');
    box.blur();
    await settled();
    expect(saves.saveError).not.toBeNull();
    expect(await saves.change((at) => server.update(at, { key: 'Am' }))).toBe(true);
    expect(textOf(saves.song)).toBe('Mine');
    expect(box.text).toBe('Mine, failed');
  });

  it("shows the server's text as it changes while the box holds nothing of its own", async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    expect(box.text).toBe('One\nTwo');
    server.changeElsewhere(withText(server.song, 'Uno\nDos'));
    await saves.refresh();
    expect(box.text).toBe('Uno\nDos');
  });
});

describe("Lyric Sheet editing, the Lyric Sheet's edits not saved yet", () => {
  it('stops counting a box closed on a failed save as unsaved once that save is over', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(2);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(editing.unsaved).toBe(true);
    box.close();
    expect(editing.unsaved).toBe(true);
    await settled();
    expect(server.landed).toBe(0);
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(editing.unsaved).toBe(false);
    expect(saves.unsaved).toBe(false);
  });

  it('counts a Label or an Alternate name being typed until it saves, in its Section', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const naming = {};
    editing.naming(naming, 1, true);
    expect(editing.unsaved).toBe(true);
    expect(saves.unsaved).toBe(true);
    expect(editing.unsavedIn(1)).toBe(true);
    expect(editing.unsavedIn(2)).toBe(false);
    editing.naming(naming, 1, false);
    expect(editing.unsaved).toBe(false);
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it("counts the edits typed into a Section's editor, Lines text and names alike", async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    editing.naming({}, 1, true);
    expect(editing.typedIn(1)).toBe(2);
    expect(editing.typedIn(2)).toBe(0);
    expect(editing.unsavedIn(1)).toBe(true);
  });

  it('marks the Song stale on a refresh while text waits to be saved, rather than replace it', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(saves.song.title).toBe('Untitled');
    expect(box.text).toBe('One\nTwo\nThree');
  });
});
