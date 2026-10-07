import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, Song, Timeline, Track } from './api';
import type { DragSave } from './clipDrag.svelte';
import { Saves } from './saves.svelte';
import { Selection } from './selection.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import type { MergeTarget } from './merge';
import { offerFor, TimelineEditing, type PreparedSound, type TimelineAudio } from './timelineEditing.svelte';

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
 * The browser's audio, faked: a file lasts 2 s and is named after its name
 * without its extension, unless the test refuses it, and a Merge renders
 * to a fixed WAV, unless the test fails it. Either can be held until
 * released. It counts the Merges it rendered.
 */
class FakeAudio implements TimelineAudio {
  rendered = 0;
  /** Why each file of these names is refused. */
  refusing = new Map<string, string>();
  /** Why the next render fails, if it does. */
  renderFailure: Error | null = null;
  #holding: Promise<void> | null = null;

  /** Holds the next file prepared or Merge rendered until the function returned is called. */
  holdNext(): () => void {
    let release!: () => void;
    this.#holding = new Promise((done) => (release = done));
    return release;
  }

  prepare = async (file: File): Promise<PreparedSound> => {
    await this.#held();
    const refused = this.refusing.get(file.name);
    if (refused) throw new Error(refused);
    return { name: file.name.replace(/\.[^.]*$/, ''), duration: 2, peaks: new Array(200).fill(0.5) };
  };

  renderMerge = async (timeline: Timeline, target: MergeTarget) => {
    await this.#held();
    if (this.renderFailure) throw this.renderFailure;
    this.rendered++;
    return { wav: new Blob(['merged']), peaks: new Array((target.end - target.start) * 100).fill(0.5) };
  };

  async #held() {
    const holding = this.#holding;
    this.#holding = null;
    await holding;
  }
}

/**
 * Timeline editing on top of Saves for the Song the server holds, as the
 * Timeline makes it, with the audio faked, whether a recording is on, set
 * by the test, and the Tracks it chose.
 */
async function editingFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const state = { recording: false, chosen: [] as number[] };
  const audio = new FakeAudio();
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
      audio,
    });
  });
  disposers.push(() => {
    editing.close();
    dispose();
  });
  return { saves, editing, selection, state, audio };
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

  it('refuses an edit while a Merge is under way, from its press, but a Track’s levels, until it’s saved', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, audio } = await editingFor(server);
    selection.selectEdited([1, 3]);
    const release = audio.holdNext();
    const merging = editing.merge();
    expect(editing.freeze).toBe('merging');
    expect(editing.mergeable).toBe(false);
    expect(await editing.edit({ kind: 'deleteClip', clipId: 2 })).toBeNull();
    // Queued after the Merge.
    const soloing = editing.edit({ kind: 'updateTrack', trackId: 2, changes: { soloed: true } });
    release();
    expect(await merging).toBe(true);
    expect(await soloing).not.toBeNull();
    expect(editing.freeze).toBeNull();
    expect(await editing.edit({ kind: 'deleteClip', clipId: 2 })).not.toBeNull();
  });

  it('stays frozen through a Merge until its Sound is saved, and thaws once one fails', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection } = await editingFor(server);
    selection.selectEdited([1, 3]);
    const release = server.holdNextAnswer();
    const merging = editing.merge();
    await vi.advanceTimersByTimeAsync(0);
    // Rendered and sent, not saved yet.
    expect(server.landed).toBe(1);
    expect(editing.frozen).toBe(true);
    release();
    await merging;
    expect(editing.frozen).toBe(false);
    selection.selectEdited(clipIdsOn(server, 1));
    server.failNext(1);
    const failing = editing.merge();
    expect(editing.frozen).toBe(true);
    expect(await failing).toBe(false);
    expect(editing.frozen).toBe(false);
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

/**
 * Clips to merge: on Track 1, a Beat in Clips 1 (0–10 s) and 2 (20–30 s),
 * and on Track 2, a Beat in Clip 3 (12–15 s).
 */
const mergeTracks = () => [track(1, [beatClip(1, 0, 10), beatClip(2, 20, 30)]), track(2, [beatClip(3, 12, 15)])];

/** The ids of the Clips on each Track, top to bottom. */
const clipIds = (server: FakeSongServer) => server.timeline.tracks.map((t) => t.clips.map((c) => c.id));

describe('Timeline editing, a Merge', () => {
  it('is refused while frozen, or for Clips that can’t be merged', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, state, audio } = await editingFor(server);
    selection.selectEdited([1]);
    expect(editing.mergeable).toBe(false);
    expect(await editing.merge()).toBe(false);
    selection.selectEdited([1, 3]);
    expect(editing.mergeable).toBe(true);
    state.recording = true;
    expect(editing.mergeable).toBe(false);
    expect(await editing.merge()).toBe(false);
    expect(audio.rendered).toBe(0);
    expect(server.landed).toBe(0);
  });

  it('selects the merged Clip once saved, and chooses its Track', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, state, audio } = await editingFor(server);
    selection.selectEdited([1, 3]);
    expect(await editing.merge()).toBe(true);
    expect(audio.rendered).toBe(1);
    // On the topmost of their Tracks with room over 0–15 s.
    const [merged, kept] = server.timeline.tracks[0].clips;
    expect(merged).toMatchObject({ start: 0, length: 15, beatId: null });
    expect(kept.id).toBe(2);
    expect(server.timeline.tracks[1].clips).toEqual([]);
    expect(server.timeline.sounds.find((s) => s.id === merged.soundId)?.name).toBe('Merged Clip');
    expect([...selection.ids]).toEqual([merged.id]);
    expect(state.chosen).toEqual([1]);
    expect(editing.mergeNote).toBeNull();
  });

  it('names the Tracks that came out silent in the Merge note, until it’s dismissed', async () => {
    const tracks = mergeTracks();
    tracks[1].muted = true;
    const server = new FakeSongServer(emptySong(), tracks);
    const { editing, selection } = await editingFor(server);
    selection.selectEdited([1, 3]);
    const merging = editing.merge();
    expect(editing.mergeNote).toBeNull();
    await merging;
    expect(editing.mergeNote).toBe('Track 2 is muted, so it merged as silence.');
    editing.dismissMergeNote();
    expect(editing.mergeNote).toBeNull();
  });

  it('takes the Merge note away at the next Merge’s press, or an undo', async () => {
    const tracks = mergeTracks();
    tracks[1].muted = true;
    const server = new FakeSongServer(emptySong(), tracks);
    const { editing, selection } = await editingFor(server);
    const note = 'Track 2 is muted, so it merged as silence.';
    selection.selectEdited([1, 3]);
    await editing.merge();
    expect(editing.mergeNote).toBe(note);
    // The merged Clip and Clip 2, both on Track 1, which isn't muted.
    selection.selectEdited(clipIdsOn(server, 1));
    const merging = editing.merge();
    expect(editing.mergeNote).toBeNull();
    await merging;
    expect(editing.mergeNote).toBeNull();

    // Back to before both, then merged again, and undone. The Clips come
    // back with new ids each time.
    const firstAndThird = () => [clipIdsOn(server, 1)[0], ...clipIdsOn(server, 2)];
    await editing.undo();
    await editing.undo();
    selection.selectEdited(firstAndThird());
    await editing.merge();
    expect(editing.mergeNote).toBe(note);
    await editing.undo();
    expect(editing.mergeNote).toBeNull();

    // Merged again, a redo with nothing to redo leaves it.
    selection.selectEdited(firstAndThird());
    await editing.merge();
    await editing.redo();
    expect(editing.mergeNote).toBe(note);
  });

  it('changes nothing when it fails to render, and says why', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { saves, editing, selection, state, audio } = await editingFor(server);
    selection.selectEdited([1, 3]);
    audio.renderFailure = new Error('the Beat could not be loaded');
    expect(await editing.merge()).toBe(false);
    expect(saves.saveError).toBe("Couldn't merge the Clips (the Beat could not be loaded).");
    expect(server.landed).toBe(0);
    expect(clipIds(server)).toEqual([[1, 2], [3]]);
    expect([...selection.ids]).toEqual([1, 3]);
    expect(state.chosen).toEqual([]);
    expect(saves.canUndo).toBe(false);
  });

  it('changes nothing when it fails to save, and says why', async () => {
    const tracks = mergeTracks();
    tracks[1].muted = true;
    const server = new FakeSongServer(emptySong(), tracks);
    const { saves, editing, selection, state } = await editingFor(server);
    selection.selectEdited([1, 3]);
    server.failNext(1);
    expect(await editing.merge()).toBe(false);
    expect(saves.saveError).toBe("Can't reach Bandmate. Check your connection.");
    expect(clipIds(server)).toEqual([[1, 2], [3]]);
    expect([...selection.ids]).toEqual([1, 3]);
    expect(state.chosen).toEqual([]);
    expect(editing.mergeNote).toBeNull();
    expect(saves.canUndo).toBe(false);
  });

  it('is refused in its turn once its Clips are gone, saying why', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { saves, editing, selection, audio } = await editingFor(server);
    selection.selectEdited([1, 3]);
    // Queued before the Merge, it deletes one of its Clips.
    const deleting = editing.edit({ kind: 'deleteClip', clipId: 3 });
    const merging = editing.merge();
    await deleting;
    expect(await merging).toBe(false);
    expect(saves.saveError).toBe("The Clips to merge aren't all on the Timeline any more.");
    expect(audio.rendered).toBe(0);
    expect(clipIds(server)).toEqual([[1, 2], []]);
  });

  it('is redone without rendering it again, selecting its Clip', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, audio } = await editingFor(server);
    selection.selectEdited([1, 3]);
    await editing.merge();
    const [merged] = server.timeline.tracks[0].clips;
    await editing.undo();
    expect(server.timeline.tracks.map((t) => t.clips.map((c) => c.start))).toEqual([[0, 20], [12]]);
    selection.selectEdited([]);
    await editing.redo();
    const [again] = server.timeline.tracks[0].clips;
    expect(again).toMatchObject({ soundId: merged.soundId, start: 0, length: 15 });
    expect(server.timeline.tracks[1].clips).toEqual([]);
    expect([...selection.ids]).toEqual([again.id]);
    expect(audio.rendered).toBe(1);
    expect(server.timeline.sounds).toHaveLength(1);
  });
});

/** An audio file of that name. */
const audioFile = (name: string) => new File(['audio'], name, { type: 'audio/wav' });

/** The names of the Sounds the Clips on a Track play, in Timeline order, with where each starts. */
const soundsOn = (server: FakeSongServer, trackId: number) =>
  server.timeline.tracks
    .find((t) => t.id === trackId)!
    .clips.filter((c) => c.soundId !== null)
    .map((c) => [server.timeline.sounds.find((s) => s.id === c.soundId)!.name, c.start]);

describe('Timeline editing, a Sound import', () => {
  it('places each file after the Track’s last Clip, one at a time, in the order asked, saying what it’s doing', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, audio } = await editingFor(server);
    const release = audio.holdNext();
    const first = editing.importFiles([audioFile('night drive.wav'), audioFile('night ride.mp3')], 1);
    const second = editing.importFiles([audioFile('outro.wav')], 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(editing.importing).toBe('Reading “night drive.wav”…');
    const answer = server.holdNextAnswer();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(editing.importing).toBe('Importing “night drive”…');
    answer();
    await Promise.all([first, second]);
    expect(editing.importing).toBeNull();
    expect(soundsOn(server, 1)).toEqual([
      ['night drive', 30],
      ['night ride', 32],
    ]);
    expect(soundsOn(server, 2)).toEqual([['outro', 0]]);
    expect(server.timeline.sounds.map((s) => s.name)).toEqual(['night drive', 'night ride', 'outro']);
  });

  it('joins what each file refused says into its error, which the next import clears', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, audio } = await editingFor(server);
    audio.refusing.set('huge.wav', '“huge.wav” is 300 MB, over the upload limit of 200 MB.');
    audio.refusing.set('notes.txt', '“notes.txt” can’t be played in this browser.');
    await editing.importFiles([audioFile('huge.wav'), audioFile('intro.wav'), audioFile('notes.txt')], 1);
    expect(editing.error).toBe(
      '“huge.wav” is 300 MB, over the upload limit of 200 MB. “notes.txt” can’t be played in this browser.',
    );
    // The one between them was imported.
    expect(soundsOn(server, 1)).toEqual([['intro', 30]]);
    const next = editing.importFiles([audioFile('outro.wav')], 1);
    expect(editing.error).toBeNull();
    await next;
    expect(editing.error).toBeNull();
  });

  it('keeps what the files before it refused while an import still runs', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, audio } = await editingFor(server);
    audio.refusing.set('huge.wav', 'Too big.');
    const release = audio.holdNext();
    const first = editing.importFiles([audioFile('intro.wav'), audioFile('huge.wav')], 1);
    await vi.advanceTimersByTimeAsync(0);
    // Asked for while the first is under way, which then refuses a file.
    const second = editing.importFiles([audioFile('outro.wav')], 1);
    release();
    await Promise.all([first, second]);
    expect(editing.error).toBe('Too big.');
  });

  it('has its error cleared by a Merge’s press, or dismissed', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, audio } = await editingFor(server);
    audio.refusing.set('huge.wav', 'Too big.');
    await editing.importFiles([audioFile('huge.wav')], 1);
    expect(editing.error).toBe('Too big.');
    editing.dismissError();
    expect(editing.error).toBeNull();
    await editing.importFiles([audioFile('huge.wav')], 1);
    selection.selectEdited([1, 3]);
    const merging = editing.merge();
    expect(editing.error).toBeNull();
    await merging;
  });

  it('is refused while frozen', async () => {
    const server = new FakeSongServer(emptySong(), mergeTracks());
    const { editing, selection, state, audio } = await editingFor(server);
    audio.refusing.set('huge.wav', 'Too big.');
    await editing.importFiles([audioFile('huge.wav')], 1);
    state.recording = true;
    await editing.importFiles([audioFile('intro.wav')], 1);
    expect(editing.importing).toBeNull();
    // What the last import said stands.
    expect(editing.error).toBe('Too big.');
    state.recording = false;
    selection.selectEdited([1, 3]);
    const release = audio.holdNext();
    const merging = editing.merge();
    await editing.importFiles([audioFile('outro.wav')], 1);
    release();
    await merging;
    expect(server.timeline.sounds.map((s) => s.name)).toEqual(['Merged Clip']);
  });

  it('is redone without uploading the file again', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.importFiles([audioFile('night drive.wav')], 2);
    const [imported] = server.timeline.tracks[1].clips;
    await editing.undo();
    expect(server.timeline.tracks[1].clips).toEqual([]);
    await editing.redo();
    expect(server.timeline.tracks[1].clips).toMatchObject([{ soundId: imported.soundId, start: 0, length: 2 }]);
    expect(server.timeline.sounds).toHaveLength(1);
  });

  it('leaves a failure to save to the save error', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    server.failNext(1);
    await editing.importFiles([audioFile('night drive.wav')], 2);
    expect(saves.saveError).toBe("Can't reach Bandmate. Check your connection.");
    expect(editing.error).toBeNull();
    expect(server.timeline.tracks[1].clips).toEqual([]);
  });
});
