import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip, Song, Timeline, Track } from './api';
import { ClipDrag, type DragAt, type DragSave } from './clipDrag.svelte';
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

/** A Track on the Timeline as shown. */
const shownTrack = (editing: TimelineEditing, trackId: number) =>
  editing.timeline.tracks.find((t) => t.id === trackId)!;

describe('Timeline editing, the Timeline as shown', () => {
  it('shows a Track’s levels sent until they’re saved, then as saved', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const editing1 = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6, muted: true } });
    expect(shownTrack(editing, 1)).toMatchObject({ volume: -6, muted: true, soloed: false });
    expect(saves.timeline.tracks[0]).toMatchObject({ volume: 0, muted: false });
    release();
    await editing1;
    expect(shownTrack(editing, 1)).toMatchObject({ volume: -6, muted: true });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('shows a Track’s new name until it’s saved', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const renaming = editing.edit({ kind: 'updateTrack', trackId: 2, changes: { name: ' Vocals ' } });
    expect(shownTrack(editing, 2).name).toBe('Vocals');
    expect(saves.timeline.tracks[1].name).toBe('Track 2');
    release();
    await renaming;
    expect(shownTrack(editing, 2).name).toBe('Vocals');
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('shows a Clip’s new name, or its name cleared, until it’s saved', async () => {
    const named = { ...beatClip(1, 0, 10), name: 'Intro' };
    const server = new FakeSongServer(emptySong(), [track(1, [named, beatClip(2, 20, 30)])]);
    const { saves, editing } = await editingFor(server);
    const clipName = (id: number) => shownTrack(editing, 1).clips.find((c) => c.id === id)!.name;
    const release = server.holdNextAnswer();
    const clearing = editing.edit({ kind: 'renameClip', clipId: 1, name: '' });
    const renaming = editing.edit({ kind: 'renameClip', clipId: 2, name: 'Outro' });
    expect(clipName(1)).toBeNull();
    expect(clipName(2)).toBe('Outro');
    release();
    await clearing;
    expect(clipName(1)).toBeNull();
    expect(clipName(2)).toBe('Outro');
    await renaming;
    expect(server.timeline.tracks[0].clips.map((c) => c.name)).toEqual([null, 'Outro']);
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('keeps showing a second rename sent before the first is saved, once the first is', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const first = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { name: 'Guitar' } });
    const second = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { name: 'Bass' } });
    expect(shownTrack(editing, 1).name).toBe('Bass');
    release();
    await first;
    expect(saves.timeline.tracks[0].name).toBe('Guitar');
    expect(shownTrack(editing, 1).name).toBe('Bass');
    await second;
    expect(shownTrack(editing, 1).name).toBe('Bass');
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('stops showing a value whose save fails, going back to the Timeline as saved', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    server.failNext(1);
    const renaming = editing.edit({ kind: 'renameClip', clipId: 1, name: 'Intro' });
    expect(shownTrack(editing, 1).clips[0].name).toBe('Intro');
    expect(await renaming).toBeNull();
    expect(shownTrack(editing, 1).clips[0].name).toBeNull();
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('leaves a newer value for the same field showing when an earlier save fails', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    server.failNext(1);
    const first = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    const release = server.holdNextAnswer();
    const second = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -12 } });
    expect(await first).toBeNull();
    expect(shownTrack(editing, 1).volume).toBe(-12);
    release();
    await second;
    expect(shownTrack(editing, 1).volume).toBe(-12);
    expect(server.timeline.tracks[0].volume).toBe(-12);
  });

  it('shows a value being adjusted without sending it, until its field is next adjusted or edited', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    expect(editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -3 } })).toBe(true);
    expect(editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -4 } })).toBe(true);
    expect(shownTrack(editing, 1).volume).toBe(-4);
    expect(server.landed).toBe(0);
    await editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -5 } });
    expect(shownTrack(editing, 1).volume).toBe(-5);
    expect(server.timeline.tracks[0].volume).toBe(-5);
  });

  it('keeps showing a fader adjusted during an earlier save of its level, once that save is', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const saving = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -9 } });
    release();
    await saving;
    expect(saves.timeline.tracks[0].volume).toBe(-6);
    expect(shownTrack(editing, 1).volume).toBe(-9);
  });

  it('refuses to adjust a value while frozen, as it would the same edit, but a Track’s levels', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, state } = await editingFor(server);
    state.recording = true;
    expect(editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { name: 'Vocals' } })).toBe(false);
    expect(editing.adjust({ kind: 'renameClip', clipId: 1, name: 'Intro' })).toBe(false);
    expect(editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -6, soloed: true } })).toBe(true);
    expect(shownTrack(editing, 1)).toMatchObject({ name: 'Track 1', volume: -6, soloed: true });
    expect(shownTrack(editing, 1).clips[0].name).toBeNull();
  });

  it('drops everything shown when a refresh replaces the Song', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.adjust({ kind: 'renameClip', clipId: 1, name: 'Intro' });
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.song.title).toBe('From another tab');
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('leaves what’s shown alone through an undo and a redo', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.adjust({ kind: 'updateTrack', trackId: 1, changes: { volume: -9 } });
    await editing.undo();
    expect(server.timeline.tracks[0].volume).toBe(0);
    expect(shownTrack(editing, 1).volume).toBe(-9);
    await editing.redo();
    expect(server.timeline.tracks[0].volume).toBe(-6);
    expect(shownTrack(editing, 1).volume).toBe(-9);
  });
});

describe('Timeline editing, a Track’s fader', () => {
  it('shows a fader’s volume as it moves, sending it once let go elsewhere', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    expect(editing.moveFader(1, -3)).toBe(true);
    editing.moveFader(1, -4);
    expect(shownTrack(editing, 1).volume).toBe(-4);
    expect(server.landed).toBe(0);
    await editing.letGoFader(1, -4);
    expect(server.timeline.tracks[0].volume).toBe(-4);
    expect(shownTrack(editing, 1).volume).toBe(-4);
  });

  it('shows the Track’s volume as saved for a fader let go where it started, sending nothing', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    editing.moveFader(1, -3);
    editing.moveFader(1, 0);
    expect(await editing.letGoFader(1, 0)).toBeNull();
    expect(server.landed).toBe(0);
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('shows an undo of a Track’s volume at once after its fader was let go where it started', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    await editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.moveFader(1, -9);
    editing.moveFader(1, -6);
    await editing.letGoFader(1, -6);
    await editing.undo();
    expect(server.timeline.tracks[0].volume).toBe(0);
    expect(shownTrack(editing, 1).volume).toBe(0);
  });

  it('keeps showing a volume on its way for a fader let go where it started, until its save resolves', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const saving = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.moveFader(1, -9);
    editing.moveFader(1, -6);
    await editing.letGoFader(1, -6);
    expect(shownTrack(editing, 1).volume).toBe(-6);
    release();
    await saving;
    expect(server.landed).toBe(1);
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('shows the Track’s volume as saved for a fader let go where it started, once the save it started from resolved', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const saving = editing.edit({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } });
    editing.moveFader(1, -9);
    release();
    await saving;
    editing.moveFader(1, -6);
    await editing.letGoFader(1, -6);
    expect(editing.timeline).toBe(saves.timeline);
    expect(shownTrack(editing, 1).volume).toBe(-6);
  });

  it('sends a fader’s volume once, however many times it’s let go', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    editing.moveFader(1, -3);
    await editing.letGoFader(1, -3);
    expect(await editing.letGoFader(1, -3)).toBeNull();
    expect(server.landed).toBe(1);
  });

  it('leaves a fader let go without moving alone', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    editing.moveFader(2, -3);
    expect(await editing.letGoFader(1, 0)).toBeNull();
    expect(server.landed).toBe(0);
    expect(shownTrack(editing, 2).volume).toBe(-3);
  });

  it('starts a fader where it was let go last, for its next move', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    editing.moveFader(1, -3);
    await editing.letGoFader(1, -3);
    editing.moveFader(1, 0);
    await editing.letGoFader(1, 0);
    expect(server.landed).toBe(2);
    expect(server.timeline.tracks[0].volume).toBe(0);
  });

  it('moves a fader while frozen, as a Track’s levels can be', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, state } = await editingFor(server);
    state.recording = true;
    expect(editing.moveFader(1, -3)).toBe(true);
    await editing.letGoFader(1, -3);
    expect(server.timeline.tracks[0].volume).toBe(-3);
  });
});

/** Lets everything waiting on the fake server's answers run, under fake timers. */
const answered = () => vi.runAllTimersAsync();

describe('Timeline editing, Track and Clip names typed', () => {
  it('saves a Track’s name typed, leaving the list of edits being typed as soon as it’s sent', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const name = editing.trackName(2);
    expect(name.shown).toBe('Track 2');
    name.shown = ' Vocals ';
    expect(saves.unsaved).toBe(true);
    const release = server.holdNextAnswer();
    expect(name.commit()).toBe(true);
    expect(name.unsaved).toBe(false);
    expect(shownTrack(editing, 2).name).toBe('Vocals');
    release();
    await answered();
    expect(server.timeline.tracks[1].name).toBe('Vocals');
    expect(name.shown).toBe('Vocals');
    expect(saves.unsaved).toBe(false);
  });

  it('takes a blank Track name back to the one saved', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const name = editing.trackName(1);
    name.shown = '   ';
    expect(name.commit()).toBe(true);
    expect(name.shown).toBe('Track 1');
    expect(saves.pending).toBe(0);
  });

  it('saves a Track’s name typed as its field goes, e.g. leaving the page', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const name = editing.trackName(1);
    name.shown = 'Guitar';
    name.destroy();
    await answered();
    expect(server.timeline.tracks[0].name).toBe('Guitar');
    expect(saves.unsaved).toBe(false);
  });

  it('shows the Track’s name saved again when its save fails', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing } = await editingFor(server);
    const name = editing.trackName(1);
    server.failNext(1);
    name.shown = 'Guitar';
    name.commit();
    await answered();
    expect(name.shown).toBe('Track 1');
    expect(shownTrack(editing, 1).name).toBe('Track 1');
  });

  it('clears a Clip’s own name when it’s typed blank, and saves a new one', async () => {
    const named = { ...beatClip(1, 0, 10), name: 'Intro' };
    const server = new FakeSongServer(emptySong(), [track(1, [named, beatClip(2, 20, 30)])]);
    const { saves, editing } = await editingFor(server);
    const intro = editing.clipName(1);
    const second = editing.clipName(2);
    expect(intro.shown).toBe('Intro');
    expect(second.shown).toBe('');
    intro.shown = ' ';
    intro.commit();
    second.shown = 'Outro';
    second.destroy();
    await answered();
    expect(server.timeline.tracks[0].clips.map((c) => c.name)).toEqual([null, 'Outro']);
    expect(intro.shown).toBe('');
    expect(saves.unsaved).toBe(false);
  });

  it('drops a Track’s name typed when its Track goes away, e.g. its adding undone, with no save error', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await editing.edit({ kind: 'addTrack', track: { name: 'Track 3' } });
    const name = editing.trackName(3);
    name.shown = 'Bass';
    await editing.undo();
    const sent = server.sent;
    name.destroy();
    await answered();
    expect(server.sent).toBe(sent);
    expect(server.timeline.tracks.map((t) => t.id)).toEqual([1, 2]);
    expect(saves.saveError).toBeNull();
    expect(saves.unsaved).toBe(false);
  });

  it('drops a Clip’s name typed when its Clip goes away, with no save error', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const name = editing.clipName(2);
    name.shown = 'Outro';
    await editing.edit({ kind: 'deleteClip', clipId: 2 });
    const sent = server.sent;
    expect(name.commit()).toBe(true);
    name.shown = 'Coda';
    name.destroy();
    await answered();
    expect(server.sent).toBe(sent);
    expect(saves.saveError).toBeNull();
    expect(saves.unsaved).toBe(false);
  });

  it('keeps a refresh from replacing the Song while a name is typed', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    const name = editing.trackName(1);
    name.shown = 'Guitar';
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(saves.song.title).toBe('Untitled');
    expect(name.shown).toBe('Guitar');
  });
});

describe('Timeline editing, the Loop as shown', () => {
  /** Editing a Timeline with a Loop from 0 to 10 s, switched on. */
  const looped = async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    await editing.edit({ kind: 'setLoop', loop: { start: 0, end: 10, on: true } });
    return { server, saves, editing };
  };

  it('shows a Loop set, switched and cleared until each is saved', async () => {
    const { server, saves, editing } = await looped();
    const release = server.holdNextAnswer();
    const setting = editing.edit({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } });
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: true });
    expect(saves.timeline.loop).toEqual({ start: 0, end: 10, on: true });
    const switching = editing.edit({ kind: 'switchLoop', on: false });
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: false });
    release();
    await setting;
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: false });
    await switching;
    expect(server.timeline.loop).toEqual({ start: 4, end: 8, on: false });
    expect(editing.timeline).toBe(saves.timeline);

    const clearRelease = server.holdNextAnswer();
    const clearing = editing.edit({ kind: 'clearLoop' });
    expect(editing.timeline.loop).toBeNull();
    expect(saves.timeline.loop).not.toBeNull();
    clearRelease();
    await clearing;
    expect(server.timeline.loop).toBeNull();
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('goes back to the Loop as saved when its save fails', async () => {
    const { server, saves, editing } = await looped();
    server.failNext(1);
    const setting = editing.edit({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } });
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: true });
    expect(await setting).toBeNull();
    expect(editing.timeline.loop).toEqual({ start: 0, end: 10, on: true });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('keeps showing a second Loop set before the first is saved, once the first is', async () => {
    const { server, saves, editing } = await looped();
    const release = server.holdNextAnswer();
    const first = editing.edit({ kind: 'setLoop', loop: { start: 2, end: 6, on: true } });
    const second = editing.edit({ kind: 'setLoop', loop: { start: 12, end: 16, on: true } });
    expect(editing.timeline.loop).toEqual({ start: 12, end: 16, on: true });
    release();
    await first;
    expect(saves.timeline.loop).toEqual({ start: 2, end: 6, on: true });
    expect(editing.timeline.loop).toEqual({ start: 12, end: 16, on: true });
    await second;
    expect(server.timeline.loop).toEqual({ start: 12, end: 16, on: true });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('plays without the Loop at once as it’s switched off, and with it again if that fails', async () => {
    const { server, editing } = await looped();
    server.failNext(1);
    const switching = editing.edit({ kind: 'switchLoop', on: false });
    expect(editing.timeline.loop?.on).toBe(false);
    expect(await switching).toBeNull();
    expect(editing.timeline.loop?.on).toBe(true);
  });

  it('keeps a switch sent over a Loop set showing the set’s stretch until the switch resolves, if the set fails', async () => {
    const { server, saves, editing } = await looped();
    server.failNext(1);
    const setting = editing.edit({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } });
    const release = server.holdNextAnswer();
    const switching = editing.edit({ kind: 'switchLoop', on: false });
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: false });
    expect(await setting).toBeNull();
    expect(editing.timeline.loop).toEqual({ start: 4, end: 8, on: false });
    release();
    await switching;
    expect(server.timeline.loop).toEqual({ start: 0, end: 10, on: false });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('refuses setting, switching and clearing the Loop while frozen', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { editing, state } = await editingFor(server);
    state.recording = true;
    expect(await editing.edit({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } })).toBeNull();
    expect(await editing.edit({ kind: 'switchLoop', on: true })).toBeNull();
    expect(editing.adjust({ kind: 'clearLoop' })).toBe(false);
    expect(editing.timeline.loop).toBeNull();
    expect(server.landed).toBe(0);
  });
});

describe('Timeline editing, a Clip’s Gain and Fades as shown', () => {
  /** A Clip on the Timeline as shown. */
  const shownClip = (editing: TimelineEditing, clipId: number) =>
    editing.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;

  /** A Clip drag over the Timeline as shown, as the Timeline makes it, drawn at 10 px a second. */
  const dragOver = (editing: TimelineEditing, selection: Selection) =>
    new ClipDrag(selection, {
      tracks: () => editing.timeline.tracks,
      playhead: () => 0,
      loop: () => null,
      reach: () => 0.8,
      sourceLength: () => 60,
    });

  /** The pointer at a time over Track 1's lane, `dy` px below its middle. */
  const at = (time: number, dy = 0): DragAt => ({ point: { clientX: time * 10, clientY: 150 + dy }, time, trackId: 1 });
  const keys = { free: false, toggles: false, nudges: false };

  it('shows a Gain and Fades dragged and released until each is saved, the drag letting go of the Clip at once', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing, selection } = await editingFor(server);
    const drag = dragOver(editing, selection);
    const release = server.holdNextAnswer();

    // Its gain line, on a waveform 72 px tall, dragged 10 px up: +10 dB.
    drag.press(shownClip(editing, 1), 'gain', at(5), keys, { waveHeight: 72 });
    drag.move(at(5, -10));
    const gaining = editing.saveDrag(drag.release()!);
    expect(drag.clip).toBeNull();
    expect(drag.shown).toEqual([]);
    expect(shownClip(editing, 1)).toMatchObject({ gain: 10, fadeIn: 0 });
    expect(saves.timeline.tracks[0].clips[0].gain).toBe(0);

    // Its fade in's dot, dragged from where it rests to 0:04: a 4 s fade in.
    drag.press(shownClip(editing, 1), 'fadeIn', at(0.5), keys, {
      dots: { fadeIn: 0.5, fadeOut: 9.5, width: 0.6, rests: 0.5 },
    });
    drag.move(at(4));
    const fading = editing.saveDrag(drag.release()!);
    expect(drag.clip).toBeNull();
    expect(shownClip(editing, 1)).toMatchObject({ gain: 10, fadeIn: 4, fadeOut: 0 });

    release();
    expect(await gaining).toBe(true);
    expect(shownClip(editing, 1)).toMatchObject({ gain: 10, fadeIn: 4 });
    expect(await fading).toBe(true);
    expect(server.timeline.tracks[0].clips[0]).toMatchObject({ gain: 10, fadeIn: 4, fadeOut: 0 });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('goes back to a Clip’s Gain as saved when its save fails, leaving its Fades showing', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    server.failNext(1);
    const gaining = editing.saveDrag({ edit: { kind: 'setClipGain', clipId: 1, gain: 10 }, moved: null });
    const release = server.holdNextAnswer();
    const fading = editing.saveDrag({ edit: { kind: 'setClipFades', clipId: 1, fadeIn: 2, fadeOut: 3 }, moved: null });
    expect(shownClip(editing, 1)).toMatchObject({ gain: 10, fadeIn: 2, fadeOut: 3 });
    expect(await gaining).toBe(false);
    expect(shownClip(editing, 1)).toMatchObject({ gain: 0, fadeIn: 2, fadeOut: 3 });
    release();
    await fading;
    expect(server.timeline.tracks[0].clips[0]).toMatchObject({ gain: 0, fadeIn: 2, fadeOut: 3 });
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('goes back to a Clip’s Fades as saved when their save fails', async () => {
    const server = new FakeSongServer(emptySong(), twoTracks());
    const { saves, editing } = await editingFor(server);
    server.failNext(1);
    const fading = editing.saveDrag({ edit: { kind: 'setClipFades', clipId: 1, fadeIn: 2, fadeOut: 0 }, moved: null });
    expect(shownClip(editing, 1).fadeIn).toBe(2);
    expect(await fading).toBe(false);
    expect(shownClip(editing, 1).fadeIn).toBe(0);
    expect(editing.timeline).toBe(saves.timeline);
  });

  it('shows a Clip’s Gain reset at once', async () => {
    const server = new FakeSongServer(emptySong(), [track(1, [{ ...beatClip(1, 0, 10), gain: 6 }])]);
    const { saves, editing } = await editingFor(server);
    const release = server.holdNextAnswer();
    const resetting = editing.edit({ kind: 'setClipGain', clipId: 1, gain: 0 });
    expect(shownClip(editing, 1).gain).toBe(0);
    expect(saves.timeline.tracks[0].clips[0].gain).toBe(6);
    release();
    await resetting;
    expect(server.timeline.tracks[0].clips[0].gain).toBe(0);
    expect(editing.timeline).toBe(saves.timeline);
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
const clipIdsByTrack = (server: FakeSongServer) => server.timeline.tracks.map((t) => t.clips.map((c) => c.id));

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
    expect(clipIdsByTrack(server)).toEqual([[1, 2], [3]]);
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
    expect(clipIdsByTrack(server)).toEqual([[1, 2], [3]]);
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
    expect(clipIdsByTrack(server)).toEqual([[1, 2], []]);
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
