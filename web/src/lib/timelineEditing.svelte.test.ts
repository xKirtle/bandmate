import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, Song, Track } from './api';
import type { DragSave } from './clipDrag.svelte';
import { Saves } from './saves.svelte';
import { Selection } from './selection.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import { offerFor, TimelineEditing } from './timelineEditing.svelte';

/** A Clip of Beat 1, from start to end seconds. */
const beatClip = (id: number, start: number, end: number): Clip => ({
  id,
  beatId: 1,
  soundId: null,
  name: null,
  gain: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: end - start,
});

/** A Track at 0 dB, neither muted nor soloed, holding the Clips given. */
const track = (id: number, clips: Clip[] = []): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0,
  muted: false,
  soloed: false,
  clips,
});

/** Two Tracks: a Beat in Clips 1 (0–10 s) and 2 (20–30 s), and an empty one. */
const twoTracks = () => [track(1, [beatClip(1, 0, 10), beatClip(2, 20, 30)]), track(2)];

/**
 * Timeline editing on top of Saves for the Song the server holds, as the
 * Timeline makes it, with whether a recording is on, set by the test, and
 * the Tracks it chose.
 */
async function editingFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const state = { recording: false, chosen: [] as number[] };
  let editing!: TimelineEditing;
  let selection!: Selection;
  const dispose = $effect.root(() => {
    selection = new Selection(
      () => saves.timeline.tracks,
      () => editing.freeze,
    );
    editing = new TimelineEditing({
      saves,
      selection,
      recording: () => state.recording,
      choose: (trackId) => state.chosen.push(trackId),
    });
  });
  disposers.push(() => {
    editing.close();
    dispose();
  });
  return { saves, editing, selection, state };
}

const disposers: (() => void)[] = [];

/** The ids of the Clips on a Track, in Timeline order. */
const clipIdsOn = (server: FakeSongServer, trackId: number) =>
  server.timeline.tracks.find((t) => t.id === trackId)!.clips.map((c) => c.id);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.useRealTimers();
});

describe('Timeline editing, the freeze', () => {
  it('refuses an edit while a recording is on, but a Track’s mute, solo or volume', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, state } = await editingFor(server);
    state.recording = true;
    expect(editing.freeze).toBe('recording');
    expect(await editing.edit({ kind: 'deleteClip', clipId: 1 })).toBeNull();
    expect(await editing.edit({ kind: 'updateTrack', trackId: 1, changes: { name: 'Vocals' } })).toBeNull();
    expect(server.landed).toBe(0);
    expect(
      await editing.edit({ kind: 'updateTrack', trackId: 1, changes: { muted: true, volume: -6 } }),
    ).not.toBeNull();
    expect(server.timeline.tracks[0]).toMatchObject({ muted: true, volume: -6, name: 'Track 1' });
  });

  it('refuses an edit while a Merge is under way, but a Track’s levels, until it ends', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    let finish!: () => void;
    const merge = editing.whileMerging(() => new Promise<void>((done) => (finish = done)));
    expect(editing.freeze).toBe('merging');
    expect(await editing.edit({ kind: 'deleteClip', clipId: 1 })).toBeNull();
    expect(await editing.edit({ kind: 'updateTrack', trackId: 2, changes: { soloed: true } })).not.toBeNull();
    finish();
    await merge;
    expect(editing.freeze).toBeNull();
    expect(await editing.edit({ kind: 'deleteClip', clipId: 1 })).not.toBeNull();
    expect(clipIdsOn(server, 1)).toEqual([2]);
  });

  it('refuses undo and redo while frozen', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing, state } = await editingFor(server);
    await editing.edit({ kind: 'deleteClip', clipId: 1 });
    await editing.undo();
    state.recording = true;
    await editing.redo();
    expect(clipIdsOn(server, 1)).toHaveLength(2);
    expect(saves.canRedo).toBe(true);
    state.recording = false;
    await editing.redo();
    state.recording = true;
    await editing.undo();
    expect(saves.canUndo).toBe(true);
    expect(clipIdsOn(server, 1)).toEqual([2]);
    expect(server.landed).toBe(3);
  });
});

describe('Timeline editing, undo and redo', () => {
  it('does nothing with nothing to undo or redo, and nothing queued', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    expect(editing.undoes).toBe(false);
    expect(editing.redoes).toBe(false);
    await editing.undo();
    await editing.redo();
    expect(server.landed).toBe(0);
    // Once an edit is queued, undo has something to wait for.
    const deleting = editing.edit({ kind: 'deleteClip', clipId: 1 });
    expect(editing.undoes).toBe(true);
    await deleting;
  });

  it('undoes an edit still queued, once it lands', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    const deleting = editing.edit({ kind: 'deleteClip', clipId: 2 });
    const undoing = editing.undo();
    await Promise.all([deleting, undoing]);
    expect(server.timeline.tracks[0].clips.map((c) => c.start)).toEqual([0, 20]);
  });

  it('reselects Clips deleted together as they come back, and lets redo take them again', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, selection } = await editingFor(server);
    await editing.edit({ kind: 'deleteClips', clipIds: [1, 2] });
    expect(selection.size).toBe(0);
    await editing.undo();
    const back = clipIdsOn(server, 1);
    expect(back).toHaveLength(2);
    expect([...selection.ids]).toEqual(back);
    await editing.redo();
    expect(clipIdsOn(server, 1)).toEqual([]);
  });
});

describe('Timeline editing, what follows an edit', () => {
  it('selects the Clips a paste made', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, selection } = await editingFor(server);
    const clip = { beatId: 1, start: 40, offset: 0, length: 5 };
    await editing.edit({
      kind: 'pasteClips',
      clips: [
        { trackId: 1, clip },
        { trackId: 2, clip },
      ],
      newTracks: [],
    });
    const [, , onFirst] = clipIdsOn(server, 1);
    const [onSecond] = clipIdsOn(server, 2);
    expect([...selection.ids]).toEqual([onFirst, onSecond]);
  });

  it('selects the copies a Selection Duplicate made, as a paste', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, selection } = await editingFor(server);
    selection.apply({ kind: 'click', clipId: 2 });
    await editing.edit({
      kind: 'pasteClips',
      clips: [{ trackId: 1, clip: { beatId: 1, start: 30, offset: 0, length: 10 } }],
      newTracks: [],
    });
    const [, , copy] = clipIdsOn(server, 1);
    expect([...selection.ids]).toEqual([copy]);
  });

  it('selects the right halves a Split made, the whole Clip once undone, and the right half again once redone', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, selection } = await editingFor(server);
    await editing.edit({ kind: 'splitClips', clipIds: [1], at: 4 });
    const [left, right] = server.timeline.tracks[0].clips;
    expect(left).toMatchObject({ id: 1, start: 0, length: 4 });
    expect(right).toMatchObject({ start: 4, offset: 4, length: 6 });
    expect([...selection.ids]).toEqual([right.id]);
    await editing.undo();
    const [whole] = server.timeline.tracks[0].clips;
    expect(whole).toMatchObject({ start: 0, length: 10 });
    expect([...selection.ids]).toEqual([whole.id]);
    await editing.redo();
    const [, again] = server.timeline.tracks[0].clips;
    expect(again).toMatchObject({ start: 4, length: 6 });
    expect([...selection.ids]).toEqual([again.id]);
  });

  it('leaves the Selection as it is after an edit adding nothing', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, selection } = await editingFor(server);
    selection.apply({ kind: 'click', clipId: 2 });
    await editing.edit({ kind: 'moveClip', clipId: 2, trackId: 1, start: 40 });
    expect([...selection.ids]).toEqual([2]);
  });

  it('chooses a Track added, once it is on the Timeline', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, state } = await editingFor(server);
    const adding = editing.edit({ kind: 'addTrack', track: { name: 'Track 3' } });
    expect(state.chosen).toEqual([]);
    await adding;
    expect(state.chosen).toEqual([3]);
    await editing.edit({ kind: 'deleteClip', clipId: 1 });
    expect(state.chosen).toEqual([3]);
  });

  it('says to return the playhead to where a new Take undone started', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await recordTake(server, saves, 12);
    expect(clipIdsOn(server, 2)).toHaveLength(1);
    expect(await editing.undo()).toBe(12);
    expect(clipIdsOn(server, 2)).toEqual([]);
  });

  it('says to leave the playhead be, undoing a new Take, when a recording started since', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing, state } = await editingFor(server);
    await recordTake(server, saves, 12);
    // Pressed before the recording started, and landing after.
    const release = server.holdNextAnswer();
    const undoing = editing.undo();
    await vi.advanceTimersByTimeAsync(0);
    state.recording = true;
    release();
    expect(await undoing).toBeNull();
    expect(clipIdsOn(server, 2)).toEqual([]);
  });
});

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

/** A Song of one Section whose Lines 10, 11 and 12 are cued at 2 s and 5 s, in Clip 1, and 25 s, in Clip 2. */
const cuedSong = () =>
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
              [10, 2],
              [11, 5],
              [12, 25],
            ].map(([id, cue]) => ({ id, text: `Line ${id}`, lyrics: `Line ${id}`, chords: [], chordLine: false, cue })),
          },
        ],
      },
    ],
  });

/** The Cues of Lines 10, 11 and 12, in order. */
const cuesOf = (song: Song) => song.sections[0].alternates[0].lines.map((l) => l.cue);

/** Clip 1 dragged 40 s later, as a Clip drag saves it. */
const clipOneMoved = (server: FakeSongServer): DragSave => ({
  edit: { kind: 'moveClip', clipId: 1, trackId: 1, start: 40 },
  moved: { clips: [server.timeline.tracks[0].clips[0]], by: 40 },
});

/** Clip 2 dragged 40 s later, as a Clip drag saves it. */
const clipTwoMoved = (server: FakeSongServer): DragSave => ({
  edit: { kind: 'moveClip', clipId: 2, trackId: 1, start: 60 },
  moved: { clips: server.timeline.tracks[0].clips.filter((c) => c.id === 2), by: 40 },
});

/** Clips 1 and 2 dragged 40 s later together, as a Clip drag saves them. */
const bothMoved = (server: FakeSongServer): DragSave => ({
  edit: {
    kind: 'moveClips',
    moves: [
      { clipId: 1, trackId: 1, start: 40 },
      { clipId: 2, trackId: 1, start: 60 },
    ],
  },
  moved: { clips: server.timeline.tracks[0].clips, by: 40 },
});

describe('Timeline editing, the Cue-move offer', () => {
  it('offers to move the Cues a Clip moved spanned, naming how many, and moves them by its span', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    expect(await editing.saveDrag(clipOneMoved(server))).toBe(true);
    expect(editing.cueOffer).toEqual({ by: 40, count: 2, clips: 1 });
    editing.moveCues();
    expect(editing.cueOffer).toBeNull();
    // On screen at once, saved after.
    expect(cuesOf(saves.song)).toEqual([42, 45, 25]);
    await vi.advanceTimersByTimeAsync(0);
    expect(cuesOf(server.song)).toEqual([42, 45, 25]);
  });

  it("offers to move several Clips' Cues, moving each once", async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.saveDrag(bothMoved(server));
    expect(editing.cueOffer).toEqual({ by: 40, count: 3, clips: 2 });
    editing.moveCues();
    await vi.advanceTimersByTimeAsync(0);
    expect(cuesOf(server.song)).toEqual([42, 45, 65]);
  });

  it('offers nothing for a move spanning no Cue, or a drag that is not a move', async () => {
    const server = new FakeSongServer(cuedSong(), [track(1, [beatClip(1, 30, 40)])]);
    const { editing } = await editingFor(server);
    await editing.saveDrag({
      edit: { kind: 'moveClip', clipId: 1, trackId: 1, start: 50 },
      moved: { clips: server.timeline.tracks[0].clips, by: 20 },
    });
    expect(editing.cueOffer).toBeNull();
    expect(await editing.saveDrag({ edit: { kind: 'setClipGain', clipId: 1, gain: -3 }, moved: null })).toBe(true);
    expect(editing.cueOffer).toBeNull();
  });

  it('lapses after 8 seconds, and can be left', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    await vi.advanceTimersByTimeAsync(offerFor - 1);
    expect(editing.cueOffer).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(editing.cueOffer).toBeNull();
    await editing.saveDrag(clipTwoMoved(server));
    expect(editing.cueOffer).not.toBeNull();
    editing.leaveCues();
    expect(editing.cueOffer).toBeNull();
    expect(cuesOf(server.song)).toEqual([2, 5, 25]);
  });

  it('is withdrawn when the next edit lands, not before', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    const release = server.holdNextAnswer();
    const renaming = editing.edit({ kind: 'updateTrack', trackId: 2, changes: { name: 'Vocals' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(editing.cueOffer).not.toBeNull();
    release();
    await renaming;
    expect(editing.cueOffer).toBeNull();
  });

  it('is withdrawn by an undo', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    await editing.undo();
    expect(editing.cueOffer).toBeNull();
    expect(server.timeline.tracks[0].clips[0].start).toBe(0);
  });

  it('is withdrawn by a Take saved', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    await recordTake(server, saves, 80);
    expect(editing.cueOffer).toBeNull();
  });

  it('is withdrawn by a Cue change, e.g. from the Lyric Sheet, as soon as it shows', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    void saves.cue({ kind: 'setLineCue', lineId: 12, cue: 26 }, 'the Cue');
    expect(editing.cueOffer).toBeNull();
  });

  it('stays through a change that leaves the Timeline and the Cues as they were', async () => {
    const server = new FakeSongServer(cuedSong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await editing.saveDrag(clipOneMoved(server));
    await saves.setTags(['Demo']);
    expect(editing.cueOffer).toEqual({ by: 40, count: 2, clips: 1 });
  });
});
