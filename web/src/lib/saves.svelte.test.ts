import { describe, expect, it } from 'vitest';
import type { Song, Timeline, Track } from './api';
import type { Edit } from './history';
import { Saves, type SavesOptions } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';

/** A Saves for the Song the server holds, as the Song page makes one once it's loaded. */
async function savesFor(server: FakeSongServer, options: Partial<SavesOptions> = {}) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  return new Saves({ server, song, timeline, wait: () => Promise.resolve(), ...options });
}

/** A change to the Song's Details, as the Song page's panels bring them. */
const update = (server: FakeSongServer, changes: Partial<Song>) => (at: Song) => server.update(at, changes);

/** Lets everything waiting on the fake server's answers run. */
const settled = () => new Promise((done) => setTimeout(done));

/** A Song of one Section of two Lines, neither cued. */
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
            lines: [10, 11].map((id) => ({ id, text: '', lyrics: '', chords: [], chordLine: false, cue: null })),
          },
        ],
      },
    ],
  });
const cueOf = (song: Song, lineId: number) => song.sections[0].alternates[0].lines.find((l) => l.id === lineId)!.cue;
const setCue = (lineId: number, cue: number) => ({ kind: 'setLineCue', lineId, cue }) as const;

describe('Saves', () => {
  it('lands saves in the order asked for, each against the Song as saved when its turn comes', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const first = saves.change(update(server, { title: 'One' }));
    const second = saves.change(update(server, { key: 'Am' }));
    expect(saves.pending).toBe(2);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(server.song).toMatchObject({ title: 'One', key: 'Am', version: 3 });
    expect(saves.song).toMatchObject({ title: 'One', key: 'Am', version: 3 });
    expect(saves.pending).toBe(0);
    expect(saves.stale).toBe(false);
    expect(saves.saveError).toBeNull();
  });

  it('marks the Song stale when a save is refused because it changed elsewhere, keeping no save error', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    server.changeElsewhere({ title: 'From another tab' });
    expect(await saves.submit(update(server, { key: 'Am' }))).toBe('stale');
    expect(saves.stale).toBe(true);
    expect(saves.saveError).toBeNull();
    expect(server.song.key).toBe('');
    expect(saves.song.title).toBe('Untitled');
  });

  it('shows a failed save as the save error, until a later save lands', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    server.failNext(1);
    expect(await saves.submit(update(server, { key: 'Am' }))).toBe('failed');
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(saves.stale).toBe(false);
    expect(await saves.change(update(server, { key: 'Am' }))).toBe(true);
    expect(saves.saveError).toBeNull();
  });

  it('shows an error reported by a caller until a later save lands', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    saves.report('BPM must be a whole number');
    expect(saves.saveError).toBe('BPM must be a whole number');
    await saves.change(update(server, { bpm: 90 }));
    expect(saves.saveError).toBeNull();
  });

  it("runs a caller's code after awaiting a save before the next save's turn starts", async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const seen: string[] = [];
    const caller = (async () => {
      await saves.change(update(server, { title: 'One' }));
      seen.push(`caller saw version ${saves.saved.version}`);
    })();
    const next = saves.change((at) => {
      seen.push(`next turn built against version ${at.version}`);
      return server.update(at, { key: 'Am' });
    });
    await Promise.all([caller, next]);
    expect(seen).toEqual(['caller saw version 2', 'next turn built against version 2']);
  });

  it('sets the Tags, leaving the version as it was', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    expect(await saves.setTags(['Live', 'Live', 'Demo'])).toEqual(['Live', 'Demo']);
    expect(saves.saved).toMatchObject({ tags: ['Live', 'Demo'], version: 1 });
    server.failNext(1);
    expect(await saves.setTags(['Live'])).toBeNull();
    expect(saves.saved.tags).toEqual(['Live', 'Demo']);
  });
});

describe('Saves, refreshing', () => {
  it('waits for saves on their way, then shows the Song as changed elsewhere', async () => {
    const server = new FakeSongServer();
    const replaced: Song[] = [];
    const saves = await savesFor(server, { onReplace: (s) => replaced.push(s) });
    const release = server.holdNextAnswer();
    const saving = saves.change(update(server, { key: 'Am' }));
    const refreshing = saves.refresh();
    await settled();
    expect(server.landed).toBe(1);
    server.changeElsewhere({ title: 'From another tab' });
    release();
    await Promise.all([saving, refreshing]);
    expect(saves.song).toMatchObject({ title: 'From another tab', key: 'Am', version: 3 });
    expect(saves.timeline.version).toBe(3);
    expect(replaced.map((s) => s.title)).toEqual(['From another tab']);
    expect(saves.stale).toBe(false);
  });

  it('marks the Song stale rather than replace edits not saved yet', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const leave = saves.typing({ unsaved: true, typed: 1 });
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(saves.song.title).toBe('Untitled');
    leave();
    await saves.refresh();
    expect(saves.stale).toBe(false);
    expect(saves.song.title).toBe('From another tab');
  });

  it('waits while held, e.g. recording, and refreshes once released', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const release = saves.hold();
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    await settled();
    expect(saves.song.title).toBe('Untitled');
    release();
    await settled();
    expect(saves.song.title).toBe('From another tab');
  });
});

describe('Saves, Cue changes', () => {
  it('shows a Cue change at once, before it lands', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    const release = server.holdNextAnswer();
    const saving = saves.cue(setCue(10, 1.5), 'the Cue of Line 1');
    expect(cueOf(saves.song, 10)).toBe(1.5);
    expect(cueOf(saves.saved, 10)).toBeNull();
    expect(saves.unsaved).toBe(true);
    release();
    expect(await saving).toBe(true);
    expect(cueOf(saves.saved, 10)).toBe(1.5);
    expect(saves.unsaved).toBe(false);
  });

  it('keeps a Cue change whose answer was lost though it landed, without making it twice', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    server.loseNextAnswer();
    expect(await saves.cue(setCue(10, 1.5), 'the Cue of Line 1')).toBe(true);
    expect(server.landed).toBe(1);
    expect(cueOf(saves.song, 10)).toBe(1.5);
    expect(saves.saved.version).toBe(2);
    expect(saves.saveError).toBeNull();
    expect(saves.stale).toBe(false);
  });

  it('tries a failing Cue change again, then takes it back as a whole, naming it in the save error', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    server.failNext(4);
    const taken = saves.cue(setCue(10, 1.5), 'the Cue of Line 1');
    const queuedBehind = saves.cue(setCue(11, 3), 'the Cue of Line 2');
    expect(await taken).toBe(false);
    expect(await queuedBehind).toBe(true);
    expect(cueOf(saves.song, 10)).toBeNull();
    expect(cueOf(saves.song, 11)).toBe(3);
    expect(saves.saveError).toMatch(/^Couldn't save the Cue of Line 1, so it was taken back\./);
    expect(await saves.change(update(server, { key: 'Am' }))).toBe(true);
    expect(saves.saveError).toBeNull();
  });

  it('keeps a Cue change refused as the Song changed elsewhere shown, unsaved', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    server.changeElsewhere();
    expect(await saves.cue(setCue(10, 1.5), 'the Cue of Line 1')).toBe(false);
    expect(saves.stale).toBe(true);
    expect(cueOf(saves.song, 10)).toBe(1.5);
    expect(saves.unsaved).toBe(true);
  });
});

describe('Saves, closing', () => {
  it('deletes the Song once the saves queued land, then sends nothing more', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const queued = saves.change(update(server, { title: 'Last words' }));
    const closing = saves.close((at) => server.remove(at));
    expect(await saves.change(update(server, { key: 'Am' }))).toBe(false);
    expect(await saves.submit(update(server, { key: 'Am' }))).toBe('closed');
    expect(await saves.cue({ kind: 'clearCues' }, 'every Cue')).toBe(false);
    expect(await queued).toBe(true);
    expect(await closing).toBe(true);
    expect(server.deleted).toBe(true);
    expect(server.landed).toBe(2);
  });

  it('opens again when the delete fails', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    server.failNext(1);
    expect(await saves.close((at) => server.remove(at))).toBe(false);
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(await saves.change(update(server, { key: 'Am' }))).toBe(true);
  });
});

describe('Saves, undo', () => {
  const loop = (start: number, end: number) => ({ kind: 'setLoop', loop: { start, end, on: true } }) as const;

  it('waits for the edits queued before it, then undoes the latest', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const release = server.holdNextAnswer();
    const editing = saves.edit(loop(2, 8));
    expect(saves.canUndo).toBe(false);
    const undoing = saves.undo();
    await settled();
    expect(server.timeline.loop).toMatchObject({ start: 2, end: 8 });
    release();
    expect(await editing).not.toBeNull();
    expect(await undoing).not.toBeNull();
    expect(server.timeline.loop).toBeNull();
    expect(saves.timeline.loop).toBeNull();
    expect(saves.canUndo).toBe(false);
    expect(saves.canRedo).toBe(true);
    await saves.redo();
    expect(saves.timeline.loop).toMatchObject({ start: 2, end: 8 });
    expect(saves.canRedo).toBe(false);
  });

  it('keeps Cue edits and Timeline edits in one history, undoing them in the order they were made', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    await saves.edit(loop(0, 4));
    await saves.cue(setCue(10, 1.5), 'the Cue of Line 1');
    await saves.edit(loop(2, 8));
    await saves.undo();
    expect(saves.timeline.loop).toMatchObject({ start: 0, end: 4 });
    expect(cueOf(saves.song, 10)).toBe(1.5);
    await saves.undo();
    expect(cueOf(saves.song, 10)).toBeNull();
    expect(cueOf(server.song, 10)).toBeNull();
    expect(saves.timeline.loop).toMatchObject({ start: 0, end: 4 });
    await saves.undo();
    expect(saves.timeline.loop).toBeNull();
    expect(saves.canUndo).toBe(false);
  });

  it('undoes nothing when pressed for a Cue edit that then failed and was taken back', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    await saves.cue(setCue(10, 1.5), 'the Cue of Line 1');
    server.failNext(4);
    const failing = saves.cue(setCue(11, 3), 'the Cue of Line 2');
    const undoing = saves.undo();
    expect(await failing).toBe(false);
    expect(await undoing).toBeNull();
    expect(cueOf(saves.song, 10)).toBe(1.5);
    expect(cueOf(saves.song, 11)).toBeNull();
    expect(saves.canUndo).toBe(true);
  });

  it('forgets every edit when a save is refused because the Song changed elsewhere', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    await saves.edit(loop(0, 4));
    server.changeElsewhere();
    expect(await saves.edit(loop(2, 8))).toBeNull();
    expect(saves.stale).toBe(true);
    expect(saves.canUndo).toBe(false);
    expect(await saves.undo()).toBeNull();
  });

  it('forgets every edit when a refresh brings in a change made elsewhere', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    await saves.edit(loop(0, 4));
    await saves.refresh();
    expect(saves.canUndo).toBe(true);
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.canUndo).toBe(false);
    expect(await saves.undo()).toBeNull();
    expect(server.timeline.loop).toMatchObject({ start: 0, end: 4 });
  });

  it('passes over restoring Cues whose Lines are gone since, to undo the edit before', async () => {
    const server = new FakeSongServer(cuedSong());
    const saves = await savesFor(server);
    await saves.edit(loop(0, 4));
    await saves.cue(setCue(10, 1.5), 'the Cue of Line 1');
    const withoutLines = {
      ...saves.saved.sections[0],
      alternates: [{ ...saves.saved.sections[0].alternates[0], lines: [] }],
    };
    await saves.change(update(server, { sections: [withoutLines] }));
    const landed = server.landed;
    expect(await saves.undo()).not.toBeNull();
    expect(server.landed).toBe(landed);
    await saves.undo();
    expect(saves.timeline.loop).toBeNull();
    expect(saves.stale).toBe(false);
    expect(saves.saveError).toBeNull();
  });
});

describe('Saves, undo on Clips', () => {
  /** A Track of a Beat's Clips, each 2 seconds long, starting where given. */
  const track = (...starts: number[]): Track => ({
    id: 1,
    name: 'Beat',
    volume: 0,
    muted: false,
    soloed: false,
    clips: starts.map((start, i) => ({
      id: i + 1,
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
      length: 2,
    })),
  });
  const startsOf = (tl: Timeline) => tl.tracks[0].clips.map((c) => c.start);

  it('brings back Clips deleted together, to select again, under new ids', async () => {
    const server = new FakeSongServer(emptySong(), [track(0, 4, 8)]);
    const saves = await savesFor(server);
    await saves.edit({ kind: 'deleteClips', clipIds: [1, 3] });
    expect(startsOf(saves.timeline)).toEqual([4]);
    const undone = await saves.undo();
    expect(startsOf(saves.timeline)).toEqual([0, 4, 8]);
    const back = saves.timeline.tracks[0].clips.filter((c) => c.start !== 4).map((c) => c.id);
    expect(back).not.toContain(1);
    expect(undone).toMatchObject({ reselect: back, playhead: null });
    // Redoing deletes them by their new ids.
    await saves.redo();
    expect(startsOf(saves.timeline)).toEqual([4]);
  });

  it('takes a new Take away on undo, returning the playhead to where it started', async () => {
    const server = new FakeSongServer(emptySong(), [track(0)]);
    const saves = await savesFor(server);
    const take = { kind: 'placeClip', trackId: 1, clip: { beatId: 1, start: 6, offset: 0, length: 3 } } as const;
    // As the Timeline records one, uploading it in its turn.
    await saves.make(async (at) => ({ timeline: await server.apply(at, take), kept: 'take' }));
    expect(startsOf(saves.timeline)).toEqual([0, 6]);
    expect(await saves.undo()).toMatchObject({ playhead: 6, reselect: null });
    expect(startsOf(saves.timeline)).toEqual([0]);
  });

  it('makes a Merge in its turn, against the Timeline as saved once the edits before it are', async () => {
    const server = new FakeSongServer(emptySong(), [track(0, 4)]);
    const saves = await savesFor(server);
    void saves.edit({ kind: 'moveClip', clipId: 2, trackId: 1, start: 2 });
    let rendered: number[] = [];
    // As the Timeline merges Clips, rendering them from the Timeline it's given.
    const merged = await saves.make(async (at, timeline) => {
      rendered = startsOf(timeline);
      const merge: Edit = {
        kind: 'replaceClips',
        clipIds: [1, 2],
        clips: [{ trackId: 1, clip: { soundId: 1, start: 0, offset: 0, length: 4 } }],
      };
      return { timeline: await server.apply(at, merge), kept: merge };
    });
    expect(rendered).toEqual([0, 2]);
    expect(merged && startsOf(merged.before)).toEqual([0, 2]);
    expect(merged && startsOf(merged.after)).toEqual([0]);
    expect(saves.canUndo).toBe(true);
  });

  it('shows a make whose work fails as the save error, keeping nothing to undo', async () => {
    const server = new FakeSongServer(emptySong(), [track(0)]);
    const saves = await savesFor(server);
    const made = await saves.make(() =>
      Promise.reject(new Error("The Clips to merge aren't all on the Timeline any more.")),
    );
    expect(made).toBeNull();
    expect(saves.saveError).toBe("The Clips to merge aren't all on the Timeline any more.");
    expect(saves.canUndo).toBe(false);
  });
});
