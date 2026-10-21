import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, Track } from './api';
import type { Freeze } from './freeze';
import { LyricSheetEditing } from './lyricSheetEditing.svelte';
import { Saves, type Undone } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import { SongUndo } from './songUndo.svelte';

/** A Clip of Beat 1, from start to end seconds. */
const beatClip = (id: number, start: number, end: number): Clip => ({
  id,
  beatId: 1,
  soundId: null,
  name: null,
  gain: 0,
  tempo: 1,
  pitch: 0,
  nudge: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: end - start,
});

/** Two Tracks: a Beat in Clips 1 (0–10 s) and 2 (20–30 s), and an empty one. */
const twoTracks = (): Track[] => [
  { id: 1, name: 'Track 1', volume: 0, muted: false, soloed: false, clips: [beatClip(1, 0, 10), beatClip(2, 20, 30)] },
  { id: 2, name: 'Track 2', volume: 0, muted: false, soloed: false, clips: [] },
];

/**
 * Song undo on top of Saves for the Song the server holds, as the Song page
 * makes it, with the freeze set by the test and what leaving the text field
 * does, set by the test too.
 */
async function undoFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const state = { freeze: null as Freeze, leaveField: () => {} };
  const undo = new SongUndo({ saves, freeze: () => state.freeze, leaveField: () => state.leaveField() });
  return { saves, undo, state };
}

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
const textOf = (server: FakeSongServer) => server.song.sections[0].alternates[0].lines.map((l) => l.text).join('\n');

/** Records a new Take on Track 2 from the start given, as the Take recorder saves one. */
const recordTake = (server: FakeSongServer, saves: Saves, start: number) =>
  saves.make(async (at) => ({
    timeline: await server.recordTake(at, new Blob(), {
      trackId: 2,
      start,
      captureStart: start,
      latencyOffset: 0,
      peaks: new Array(100).fill(0),
    }),
    kept: 'take',
  }));

/** The ids of the Clips on a Track, in Timeline order. */
const clipIdsOn = (server: FakeSongServer, trackId: number) =>
  server.timeline.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Song undo, whether Undo and Redo can be pressed', () => {
  it('can neither undo nor redo with nothing kept, and does nothing when pressed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { undo } = await undoFor(server);
    expect(undo.undoes).toBe(false);
    expect(undo.redoes).toBe(false);
    expect(await undo.undo()).toBeNull();
    expect(await undo.redo()).toBeNull();
    expect(server.landed).toBe(0);
  });

  it('can’t undo with only a save that isn’t kept to undo queued, e.g. the title, and does nothing when pressed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const release = server.holdNextAnswer();
    const titling = saves.change((at) => server.update(at, { title: 'New title' }));
    expect(saves.pending).toBe(1);
    expect(undo.undoes).toBe(false);
    const undoing = undo.undo();
    release();
    await titling;
    expect(await undoing).toBeNull();
    expect(server.song.title).toBe('New title');
  });

  it('can undo an edit kept to undo while it’s still queued, and undoes it once it lands', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const deleting = saves.edit({ kind: 'deleteClip', clipId: 2 });
    expect(saves.canUndo).toBe(false);
    expect(undo.undoes).toBe(true);
    const undoing = undo.undo();
    await deleting;
    expect(await undoing).not.toBeNull();
    expect(server.timeline.tracks[0].clips.map((c) => c.start)).toEqual([0, 20]);
    expect(undo.undoes).toBe(false);
    expect(undo.redoes).toBe(true);
  });
});

describe('Song undo, typing into a Section', () => {
  it('can undo typing into a Section not saved yet, and undoes it first, leaving its field', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, undo, state } = await undoFor(server);
    const editing = new LyricSheetEditing(saves, () => {});
    await editing.change({ kind: 'setSectionLabel', sectionId: 1, label: 'Chorus' });
    await undo.undo();
    expect(undo.undoes).toBe(false);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    state.leaveField = () => box.blur();
    expect(undo.undoes).toBe(true);
    expect(await undo.undo()).toMatchObject({ section: 1 });
    expect(textOf(server)).toBe('One\nTwo');
    expect(server.song.sections[0].label).toBe('Verse');
    expect(undo.undoes).toBe(false);
  });
});

describe('Song undo, frozen', () => {
  it('can neither undo nor redo while frozen, and does nothing when pressed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo, state } = await undoFor(server);
    await saves.edit({ kind: 'deleteClip', clipId: 1 });
    await saves.edit({ kind: 'deleteClip', clipId: 2 });
    await saves.undo();
    let left = 0;
    state.leaveField = () => left++;
    for (const freeze of ['recording', 'merging'] as const) {
      state.freeze = freeze;
      expect(undo.undoes).toBe(false);
      expect(undo.redoes).toBe(false);
      expect(await undo.undo()).toBeNull();
      expect(await undo.redo()).toBeNull();
    }
    expect(left).toBe(0);
    // Clip 2 back, with a new id, and Clip 1 still deleted.
    expect(server.timeline.tracks[0].clips.map((c) => c.start)).toEqual([20]);
    expect(server.landed).toBe(3);
  });

  it('does nothing when the Song froze while the saves queued before it landed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo, state } = await undoFor(server);
    const release = server.holdNextAnswer();
    const deleting = saves.edit({ kind: 'deleteClip', clipId: 1 });
    const undoing = undo.undo();
    state.freeze = 'merging';
    release();
    await deleting;
    expect(await undoing).toBeNull();
    expect(clipIdsOn(server, 1)).toEqual([2]);
    expect(saves.canUndo).toBe(true);
  });
});

describe('Song undo, its followers', () => {
  /** Follows the Song undo, keeping each result it's given. */
  const following = (undo: SongUndo) => {
    const heard: Undone[] = [];
    const stop = undo.follow((undone) => heard.push(undone));
    return { heard, stop };
  };

  it('gives each follower the Clips brought back to reselect', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const first = following(undo);
    const second = following(undo);
    await saves.edit({ kind: 'deleteClips', clipIds: [1, 2] });
    const undone = await undo.undo();
    const back = clipIdsOn(server, 1);
    expect(back).toHaveLength(2);
    expect(undone?.reselect).toEqual(back);
    expect(first.heard).toEqual([undone]);
    expect(second.heard[0]).toBe(first.heard[0]);
  });

  it('gives them the Clips a redone Split selects, the right halves', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const { heard } = following(undo);
    await saves.edit({ kind: 'splitClips', clipIds: [1], at: 4 });
    await undo.undo();
    const [whole] = server.timeline.tracks[0].clips;
    expect(heard[0].reselect).toEqual([whole.id]);
    await undo.redo();
    const [, right] = server.timeline.tracks[0].clips;
    expect(heard[1].reselect).toEqual([right.id]);
  });

  it('gives them where a new Take undone started, to return the playhead to', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const { heard } = following(undo);
    await recordTake(server, saves, 12);
    await undo.undo();
    expect(heard).toMatchObject([{ playhead: 12 }]);
    expect(clipIdsOn(server, 2)).toEqual([]);
  });

  it('gives them no playhead when a recording started since Undo was pressed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo, state } = await undoFor(server);
    const { heard } = following(undo);
    await recordTake(server, saves, 12);
    // Pressed before the recording started, and landing after.
    const release = server.holdNextAnswer();
    const undoing = undo.undo();
    await vi.advanceTimersByTimeAsync(0);
    state.freeze = 'recording';
    release();
    expect(await undoing).toMatchObject({ playhead: null });
    expect(heard).toMatchObject([{ playhead: null }]);
    expect(clipIdsOn(server, 2)).toEqual([]);
  });

  it('gives them the Section a Lyric Sheet change undone or redone changed', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, undo } = await undoFor(server);
    const { heard } = following(undo);
    await saves.changeLyricSheet({ kind: 'setSectionLabel', sectionId: 1, label: 'Chorus' });
    await undo.undo();
    await undo.redo();
    expect(heard).toMatchObject([{ section: 1 }, { section: 1 }]);
  });

  it('gives nothing to a follower that stopped following, even during the undo', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, undo } = await undoFor(server);
    const gone = following(undo);
    const leaving = following(undo);
    const staying = following(undo);
    gone.stop();
    await saves.edit({ kind: 'deleteClip', clipId: 1 });
    const undoing = undo.undo();
    leaving.stop();
    await undoing;
    expect(gone.heard).toEqual([]);
    expect(leaving.heard).toEqual([]);
    expect(staying.heard).toHaveLength(1);
  });

  it('gives nothing when nothing was undone', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { undo } = await undoFor(server);
    const { heard } = following(undo);
    await undo.undo();
    await undo.redo();
    expect(heard).toEqual([]);
  });
});
