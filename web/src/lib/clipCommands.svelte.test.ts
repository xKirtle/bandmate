import { afterEach, describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { ClipCommands, type ClipCommandKind, type ClipTarget } from './clipCommands.svelte';
import { Saves } from './saves.svelte';
import { Selection } from './selection.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import { TimelineEditing } from './timelineEditing.svelte';

/** A Clip of Beat 1, from start to end seconds. */
const beatClip = (id: number, start: number, end: number, over: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 1,
  soundId: null,
  name: null,
  gain: 0,
  tempo: 1,
  pitch: 0,
  fadeIn: 0,
  fadeOut: 0,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: end - start,
  ...over,
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

/**
 * Two Tracks: Track 1 with Clips 1 (0–10 s) and 2 (20–30 s), Track 2 with
 * Clip 3 (5–15 s).
 */
const twoTracks = () => [track(1, [beatClip(1, 0, 10), beatClip(2, 20, 30)]), track(2, [beatClip(3, 5, 15)])];

const selected: ClipTarget = { kind: 'selection' };
const clip = (clipId: number): ClipTarget => ({ kind: 'clip', clipId });

/**
 * Clip commands on top of Timeline editing and Saves for the Song the
 * server holds, as the Timeline makes them, with the playhead, the Chosen
 * Track and whether a recording is on set by the test.
 */
async function commandsFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const state = { recording: false, playhead: 0, chosen: server.timeline.tracks[0]?.id ?? null };
  let editing!: TimelineEditing;
  let selection!: Selection;
  let commands!: ClipCommands;
  const dispose = $effect.root(() => {
    selection = new Selection(
      () => editing.timeline.tracks,
      () => editing.freeze,
    );
    editing = new TimelineEditing({
      saves,
      selection,
      recording: () => state.recording,
      choose: (trackId) => (state.chosen = trackId),
      audio: {
        prepare: () => Promise.reject(new Error('not used')),
        renderMerge: (_, target) =>
          Promise.resolve({ wav: new Blob(['merged']), peaks: new Array((target.end - target.start) * 100).fill(0) }),
      },
    });
    commands = new ClipCommands({
      editing,
      selection,
      playhead: () => state.playhead,
      chosen: () => state.chosen,
    });
  });
  disposers.push(dispose);
  return { saves, editing, selection, commands, state };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/** The ids of the Clips on each Track, top to bottom. */
const clipIds = (server: FakeSongServer) => server.timeline.tracks.map((t) => t.clips.map((c) => c.id));

/** Where the Clips on each Track start, top to bottom: undo brings Clips back with new ids. */
const clipStarts = (server: FakeSongServer) => server.timeline.tracks.map((t) => t.clips.map((c) => c.start));

describe('Clip commands, Delete', () => {
  it('deletes a box Selection, as one step', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, saves } = await commandsFor(server);
    selection.startBox(false).draw({ start: 8, end: 12, tracks: [0, 1] });
    expect([...selection.ids]).toEqual([1, 3]);
    expect(await commands.run({ kind: 'delete', target: selected })).toEqual({ focus: null });
    expect(clipIds(server)).toEqual([[2], []]);
    await saves.undo();
    expect(clipStarts(server)).toEqual([[0, 20], [5]]);
  });

  it('deletes a Mod+A Selection', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    await commands.run({ kind: 'delete', target: selected });
    expect(clipIds(server)).toEqual([[], []]);
    expect(server.landed).toBe(1);
  });

  it('deletes one Clip alone, whatever is selected', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    await commands.run({ kind: 'delete', target: clip(2) });
    expect(clipIds(server)).toEqual([[1], [3]]);
  });

  it('is unavailable, and does nothing, with nothing selected', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands } = await commandsFor(server);
    expect(commands.can('delete', selected)).toBe('noClips');
    expect(await commands.run({ kind: 'delete', target: selected })).toBeNull();
    expect(server.sent).toBe(0);
  });
});

describe('Clip commands, Split at playhead', () => {
  it('splits the selected Clips the playhead crosses, as one step, and selects their right halves', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    state.playhead = 8;
    expect(commands.can('split', selected)).toBeNull();
    await commands.run({ kind: 'split', target: selected });
    expect(server.landed).toBe(1);
    // Clip 2 isn't under the playhead; 1 and 3 are, their right halves 4 and 5.
    expect(clipIds(server)).toEqual([
      [1, 4, 2],
      [3, 5],
    ]);
    expect([...selection.ids]).toEqual([4, 5]);
  });

  it('splits the Chosen Track’s Clip under the playhead with nothing selected', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, state } = await commandsFor(server);
    state.playhead = 8;
    state.chosen = 2;
    await commands.run({ kind: 'split', target: selected });
    expect(clipIds(server)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('splits only the Clip it targets', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    state.playhead = 8;
    await commands.run({ kind: 'split', target: clip(3) });
    expect(clipIds(server)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('gives the focused Clip’s right half to take focus', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    state.playhead = 8;
    expect(await commands.run({ kind: 'split', target: selected, focused: 3 })).toEqual({ focus: 5 });
  });

  it('gives nothing to take focus when the focused Clip wasn’t split', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    state.playhead = 8;
    expect(await commands.run({ kind: 'split', target: selected, focused: 2 })).toEqual({ focus: null });
  });

  it('is unavailable, saying why, with nothing under the playhead to split', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, state } = await commandsFor(server);
    state.playhead = 17;
    expect(commands.can('split', selected)).toBe('nothingToSplit');
    expect(commands.can('split', clip(2))).toBe('nothingToSplit');
    expect(await commands.run({ kind: 'split', target: selected })).toBeNull();
    expect(server.sent).toBe(0);
  });
});

describe('Clip commands, the Clipboard', () => {
  it('cuts the Selection as one step, undone without changing the Clipboard', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, saves, state } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 1 });
    selection.apply({ kind: 'toggle', clipId: 3 });
    await commands.run({ kind: 'cut', target: selected });
    expect(server.landed).toBe(1);
    expect(clipIds(server)).toEqual([[2], []]);
    await saves.undo();
    expect(saves.canUndo).toBe(false);
    expect(clipStarts(server)).toEqual([[0, 20], [5]]);
    // The Clipboard still holds what was cut.
    state.playhead = 40;
    await commands.run({ kind: 'paste', target: selected });
    expect(server.timeline.tracks[0].clips.map((c) => c.start)).toEqual([0, 20, 40]);
  });

  it('cuts one Clip alone', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands } = await commandsFor(server);
    await commands.run({ kind: 'cut', target: clip(2) });
    expect(clipIds(server)).toEqual([[1], [3]]);
  });

  it('pastes at the playhead on the Chosen Track, adding Tracks at the bottom for rows that run past the last', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 2 });
    selection.apply({ kind: 'toggle', clipId: 3 });
    await commands.run({ kind: 'copy', target: selected });
    expect(server.sent).toBe(0);
    state.chosen = 2;
    state.playhead = 40;
    expect(await commands.run({ kind: 'paste', target: clip(1) })).toEqual({ focus: null });
    expect(server.landed).toBe(1);
    const [, second, added] = server.timeline.tracks;
    expect(second.clips.map((c) => [c.start, c.length])).toEqual([
      [5, 10],
      [55, 10],
    ]);
    expect(added.name).toBe('Track 2');
    expect(added.clips.map((c) => [c.start, c.length])).toEqual([[40, 10]]);
    // The Clips pasted are selected.
    expect([...selection.ids]).toEqual([second.clips[1].id, added.clips[0].id]);
  });

  it('undoes a paste that added Tracks as one step, taking the Tracks too', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, saves, state } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 2 });
    selection.apply({ kind: 'toggle', clipId: 3 });
    await commands.run({ kind: 'copy', target: selected });
    state.chosen = 2;
    state.playhead = 40;
    await commands.run({ kind: 'paste', target: selected });
    expect(server.timeline.tracks).toHaveLength(3);
    await saves.undo();
    expect(clipIds(server)).toEqual([[1, 2], [3]]);
  });

  it('has nothing to paste before anything is copied', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands } = await commandsFor(server);
    expect(commands.can('paste', selected)).toBe('nothingToPaste');
    expect(await commands.run({ kind: 'paste', target: selected })).toBeNull();
  });
});

describe('Clip commands, Duplicate', () => {
  it('duplicates one Clip right after itself', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands } = await commandsFor(server);
    await commands.run({ kind: 'duplicate', target: clip(3) });
    expect(server.timeline.tracks[1].clips.map((c) => [c.start, c.length])).toEqual([
      [5, 10],
      [15, 10],
    ]);
  });

  it('duplicates one Clip after its Track’s last when something is in the way', async () => {
    const server = new FakeSongServer(emptySong(), [track(1, [beatClip(1, 0, 10), beatClip(2, 15, 25)])]);
    const { commands } = await commandsFor(server);
    await commands.run({ kind: 'duplicate', target: clip(1) });
    expect(clipStarts(server)).toEqual([[0, 15, 25]]);
  });

  it('duplicates the Selection after it ends, or later where all fit, selecting the copies', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 1 });
    selection.apply({ kind: 'toggle', clipId: 3 });
    await commands.run({ kind: 'duplicate', target: selected });
    // After 0:15, Clip 1's copy would land on Clip 2, so both go to where it ends.
    expect(clipStarts(server)).toEqual([
      [0, 20, 30],
      [5, 35],
    ]);
    expect(selection.size).toBe(2);
    expect(selection.has(1)).toBe(false);
  });
});

describe('Clip commands, Tempo, Pitch and Gain', () => {
  const mixed = () => [
    track(1, [beatClip(1, 0, 10, { tempo: 1.25, pitch: 2 }), beatClip(2, 20, 30)]),
    track(2, [beatClip(3, 5, 15)]),
  ];

  it('sets the Tempo of only the Clips it changes, as one step', async () => {
    const server = new FakeSongServer(emptySong(), mixed());
    const { commands, selection, saves } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    const sent: unknown[] = [];
    const apply = server.apply.bind(server);
    server.apply = ((at: never, e: never) => (sent.push(e), apply(at, e))) as typeof server.apply;
    await commands.run({ kind: 'tempo', target: selected, percent: 125 });
    expect(sent).toEqual([
      {
        kind: 'setClipTempos',
        tempos: [
          { clipId: 2, tempo: 1.25 },
          { clipId: 3, tempo: 1.25 },
        ],
      },
    ]);
    await saves.undo();
    expect(server.timeline.tracks.flatMap((t) => t.clips.map((c) => c.tempo))).toEqual([1.25, 1, 1]);
  });

  it('sets the Pitch of only the Clips it changes, as one step', async () => {
    const server = new FakeSongServer(emptySong(), mixed());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    await commands.run({ kind: 'pitch', target: selected, semitones: 2 });
    expect(server.landed).toBe(1);
    expect(server.timeline.tracks.flatMap((t) => t.clips.map((c) => c.pitch))).toEqual([2, 2, 2]);
  });

  it('sends nothing when no Clip would change', async () => {
    const server = new FakeSongServer(emptySong(), mixed());
    const { commands } = await commandsFor(server);
    expect(await commands.run({ kind: 'tempo', target: clip(1), percent: 125 })).toBeNull();
    expect(await commands.run({ kind: 'pitch', target: clip(1), semitones: 2 })).toBeNull();
    expect(server.sent).toBe(0);
  });

  it('sets one Clip’s Gain, to the tenth, within its bounds', async () => {
    const server = new FakeSongServer(emptySong(), mixed());
    const { commands } = await commandsFor(server);
    await commands.run({ kind: 'gain', target: clip(2), gain: 99 });
    await commands.run({ kind: 'gain', target: clip(3), gain: -3.14 });
    expect(server.timeline.tracks.flatMap((t) => t.clips.map((c) => c.gain))).toEqual([0, 36, -3.1]);
  });

  it('hands over the Clips a target covers', async () => {
    const server = new FakeSongServer(emptySong(), mixed());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 3 });
    selection.apply({ kind: 'toggle', clipId: 1 });
    expect(commands.clipsOf(selected).map((c) => c.id)).toEqual([1, 3]);
    expect(commands.clipsOf(clip(2)).map((c) => c.id)).toEqual([2]);
    expect(commands.clipsOf(clip(9))).toEqual([]);
  });
});

describe('Clip commands, a Merge', () => {
  it('merges the selected Clips, but can’t merge one Clip', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'toggle', clipId: 1 });
    expect(commands.can('merge', selected)).toBe('cantMerge');
    selection.apply({ kind: 'toggle', clipId: 2 });
    expect(commands.can('merge', clip(1))).toBe('cantMerge');
    expect(commands.can('merge', selected)).toBeNull();
    expect(await commands.run({ kind: 'merge', target: selected })).toEqual({ focus: null });
    expect(server.timeline.tracks[0].clips).toHaveLength(1);
  });
});

describe('Clip commands, Takes', () => {
  const take = (id: number, nudge = 0) => ({
    id,
    number: id,
    size: 0,
    duration: 10,
    sampleRate: 48000,
    latencyOffset: 0,
    position: 0,
    nudge,
    recordedAt: '',
  });

  it('sends each Take edit for the Clip it targets', async () => {
    const takes = beatClip(1, 0, 10, { beatId: null, takes: [take(1), take(2)], activeTakeId: 2 });
    const server = new FakeSongServer(emptySong(), [track(1, [takes])]);
    const { commands } = await commandsFor(server);
    const sent: unknown[] = [];
    server.apply = ((_: never, e: never) => (
      sent.push(e),
      Promise.reject(new Error('refused'))
    )) as typeof server.apply;
    await commands.run({ kind: 'chooseTake', target: clip(1), takeId: 1 });
    await commands.run({ kind: 'deleteTake', target: clip(1), takeId: 2 });
    await commands.run({ kind: 'nudgeTake', target: clip(1), takeId: 2, ms: 15 });
    await commands.run({ kind: 'clearInactiveTakes', target: clip(1) });
    expect(sent).toEqual([
      { kind: 'chooseTake', clipId: 1, takeId: 1 },
      { kind: 'deleteTake', clipId: 1, takeId: 2 },
      { kind: 'nudgeTake', clipId: 1, takeId: 2, nudge: 0.015 },
      { kind: 'clearInactiveTakes', clipId: 1 },
    ]);
  });
});

describe('Clip commands, the freeze', () => {
  const every: ClipCommandKind[] = [
    'copy',
    'cut',
    'paste',
    'duplicate',
    'split',
    'delete',
    'merge',
    'tempo',
    'pitch',
    'gain',
    'chooseTake',
    'deleteTake',
    'nudgeTake',
    'clearInactiveTakes',
  ];

  it('blocks every command while recording, saying it’s frozen', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection, state } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    await commands.run({ kind: 'copy', target: selected });
    state.playhead = 8;
    state.recording = true;
    for (const kind of every) {
      expect(commands.can(kind, selected), kind).toBe('frozen');
      expect(commands.can(kind, clip(1)), kind).toBe('frozen');
    }
    const runs = [
      { kind: 'cut', target: selected },
      { kind: 'paste', target: selected },
      { kind: 'duplicate', target: clip(1) },
      { kind: 'split', target: selected, focused: 1 },
      { kind: 'delete', target: selected },
      { kind: 'merge', target: selected },
      { kind: 'tempo', target: selected, percent: 150 },
      { kind: 'pitch', target: selected, semitones: 3 },
      { kind: 'gain', target: clip(1), gain: 3 },
      { kind: 'clearInactiveTakes', target: clip(1) },
    ] as const;
    for (const command of runs) expect(await commands.run(command), command.kind).toBeNull();
    expect(server.sent).toBe(0);
  });

  it('leaves the Clipboard as it was when a copy is blocked', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, state } = await commandsFor(server);
    await commands.run({ kind: 'copy', target: clip(1) });
    state.recording = true;
    expect(await commands.run({ kind: 'copy', target: clip(2) })).toBeNull();
    state.recording = false;
    state.playhead = 40;
    await commands.run({ kind: 'paste', target: selected });
    expect(server.timeline.tracks[0].clips.map((c) => c.length)).toEqual([10, 10, 10]);
    expect(server.timeline.tracks[0].clips.at(-1)!.start).toBe(40);
  });

  it('blocks every command while a Merge is under way', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { commands, selection } = await commandsFor(server);
    selection.apply({ kind: 'all' });
    const release = server.holdNextAnswer();
    const merging = commands.run({ kind: 'merge', target: selected });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    expect(commands.can('delete', clip(1))).toBe('frozen');
    release();
    await merging;
    expect(commands.can('delete', selected)).toBeNull();
  });
});
