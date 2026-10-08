import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Line, Song } from './api';
import { LyricSheetEditing } from './lyricSheetEditing.svelte';
import { Saves } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import type { Mode } from './songMode';
import { SyncMode, type SyncPort } from './syncMode.svelte';

/** A Line of words, with its Cue, if any. */
const line = (id: number, cue: number | null = null): Line => ({
  id,
  text: `Line ${id}`,
  lyrics: `Line ${id}`,
  chords: [],
  chordLine: false,
  cue,
});

/**
 * A Song of one Section, the Verse, whose Lines 10 to 13 are cued as given:
 * by default only the first two.
 */
const verseSong = (cues: (number | null)[] = [1, 2, null, null]) =>
  emptySong({
    arrangement: [1],
    sections: [
      {
        id: 1,
        label: 'Verse',
        alternates: [{ id: 1, name: '', active: true, lines: cues.map((cue, i) => line(10 + i, cue)) }],
      },
    ],
  });

/** The Cue of a Line in a Song. */
const cueOf = (song: Song, lineId: number) =>
  song.sections.flatMap((s) => s.alternates.flatMap((a) => a.lines)).find((l) => l.id === lineId)?.cue;

/** The Timeline as Sync mode sees it through its port, each value set by the test. */
class FakePort implements SyncPort {
  loopOn = $state(false);
  recording = $state(false);
  hasClips = $state(true);
  playhead = 0;
  stopLoop() {
    this.loopOn = false;
  }
  playheadAt() {
    return this.playhead;
  }
}

/** A Device's storage, kept in memory. */
class FakeStorage {
  #items = new Map<string, string>();
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
}

/**
 * Sync mode as the Song page makes it, inside an effect root, on Saves for
 * the Song the server holds, with the Timeline's port attached, on a
 * Device's storage, in Write mode on a wide screen unless the test changes
 * the page.
 */
async function syncModeFor(server: FakeSongServer, storage = new FakeStorage()) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const page = $state<{ mode: Mode; wide: boolean }>({ mode: 'write', wide: true });
  const port = new FakePort();
  let syncMode!: SyncMode;
  disposers.push(
    $effect.root(() => {
      syncMode = new SyncMode({
        mode: () => page.mode,
        wide: () => page.wide,
        song: () => saves.song,
        cue: saves.cue,
        storage: storage as unknown as Storage,
      });
    }),
  );
  const detach = syncMode.attach(port);
  flushSync();
  return { saves, syncMode, port, page, storage, detach };
}

type Harness = Awaited<ReturnType<typeof syncModeFor>>;
/** A change to what Sync mode reads, made by a test. */
type Change = (t: Harness) => unknown;

const disposers: (() => void)[] = [];

/** Lets everything waiting on the fake server's answers run, and the effects they set off. */
async function settled() {
  await vi.advanceTimersByTimeAsync(0);
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.useRealTimers();
});

/** Switches Sync mode on, as clicking Sync lyrics does. */
function switchOn(syncMode: SyncMode) {
  syncMode.switch();
  flushSync();
}

describe('Sync mode, switching on and off', () => {
  it('comes on in Write mode, on a wide screen, with Clips, while not recording, and goes off', async () => {
    const { syncMode } = await syncModeFor(new FakeSongServer(verseSong()));
    expect(syncMode.canBeOn).toBe(true);
    expect(syncMode.on).toBe(false);
    switchOn(syncMode);
    expect(syncMode.on).toBe(true);
    syncMode.switch();
    flushSync();
    expect(syncMode.on).toBe(false);
  });

  it.each<[string, Change]>([
    ['in Read mode', (t) => (t.page.mode = 'read')],
    ['on a narrow screen', (t) => (t.page.wide = false)],
    ['without Clips', (t) => (t.port.hasClips = false)],
    ['while recording', (t) => (t.port.recording = true)],
    ['without the Timeline attached', (t) => t.detach()],
  ])("can't come on %s", async (_, change) => {
    const t = await syncModeFor(new FakeSongServer(verseSong()));
    change(t);
    flushSync();
    expect(t.syncMode.canBeOn).toBe(false);
    switchOn(t.syncMode);
    expect(t.syncMode.on).toBe(false);
    expect(t.syncMode.next).toBeNull();
  });

  it('switches the Loop off as it comes on', async () => {
    const { syncMode, port } = await syncModeFor(new FakeSongServer(verseSong()));
    port.loopOn = true;
    flushSync();
    expect(syncMode.canBeOn).toBe(true);
    switchOn(syncMode);
    expect(port.loopOn).toBe(false);
    expect(syncMode.on).toBe(true);
  });
});

describe('Sync mode, ending', () => {
  it.each<[string, Change, Change]>([
    ['the Loop comes on', (t) => (t.port.loopOn = true), (t) => (t.port.loopOn = false)],
    ['recording starts', (t) => (t.port.recording = true), (t) => (t.port.recording = false)],
    ['the last Clip goes', (t) => (t.port.hasClips = false), (t) => (t.port.hasClips = true)],
    ['Read mode comes on', (t) => (t.page.mode = 'read'), (t) => (t.page.mode = 'write')],
    ['the screen narrows', (t) => (t.page.wide = false), (t) => (t.page.wide = true)],
  ])('ends as %s, and stays off when it changes back', async (_, end, back) => {
    const t = await syncModeFor(new FakeSongServer(verseSong()));
    switchOn(t.syncMode);
    end(t);
    flushSync();
    expect(t.syncMode.on).toBe(false);
    back(t);
    flushSync();
    expect(t.syncMode.canBeOn).toBe(true);
    expect(t.syncMode.on).toBe(false);
    switchOn(t.syncMode);
    expect(t.syncMode.on).toBe(true);
  });

  it('ends as the Timeline detaches, and stays off when another attaches', async () => {
    const t = await syncModeFor(new FakeSongServer(verseSong()));
    switchOn(t.syncMode);
    t.detach();
    flushSync();
    expect(t.syncMode.on).toBe(false);
    t.syncMode.attach(new FakePort());
    flushSync();
    expect(t.syncMode.canBeOn).toBe(true);
    expect(t.syncMode.on).toBe(false);
  });

  it('ends as Lyric Sheet editing changes the lyrics, but not for a Cue change', async () => {
    const server = new FakeSongServer(verseSong());
    const t = await syncModeFor(server);
    const editing = new LyricSheetEditing(t.saves, () => t.syncMode.end());
    switchOn(t.syncMode);
    t.port.playhead = 5;
    t.syncMode.cue();
    await settled();
    expect(t.syncMode.on).toBe(true);
    const added = editing.change({ kind: 'addSection' });
    flushSync();
    expect(t.syncMode.on).toBe(false);
    expect(await added).toBe(true);
    await settled();
    expect(t.syncMode.on).toBe(false);
  });
});

describe('Sync mode, the Line up next', () => {
  it('starts at the first Line without a Cue', async () => {
    const { syncMode } = await syncModeFor(new FakeSongServer(verseSong([1, null, 3, null])));
    switchOn(syncMode);
    expect(syncMode.next).toEqual({ section: 1, line: 11 });
  });

  it('starts at the first Line once every Line is cued', async () => {
    const { syncMode } = await syncModeFor(new FakeSongServer(verseSong([1, 2, 3, 4])));
    switchOn(syncMode);
    expect(syncMode.next).toEqual({ section: 1, line: 10 });
  });

  it('cues the Line up next at the playhead, and the Line after it comes up next, cued or not', async () => {
    const server = new FakeSongServer(verseSong([1, 2, 3, null]));
    const { syncMode, saves, port } = await syncModeFor(server);
    switchOn(syncMode);
    syncMode.pick({ section: 1, line: 10 });
    port.playhead = 1.25;
    syncMode.cue();
    flushSync();
    expect(cueOf(saves.song, 10)).toBe(1.25);
    expect(syncMode.next).toEqual({ section: 1, line: 11 });
    await settled();
    expect(cueOf(server.song, 10)).toBe(1.25);
    expect(syncMode.next).toEqual({ section: 1, line: 11 });
  });

  it('moves on before the Cue is saved', async () => {
    const server = new FakeSongServer(verseSong());
    const { syncMode, saves, port } = await syncModeFor(server);
    switchOn(syncMode);
    const release = server.holdNextAnswer();
    port.playhead = 3;
    syncMode.cue();
    flushSync();
    expect(syncMode.next).toEqual({ section: 1, line: 13 });
    port.playhead = 4;
    syncMode.cue();
    flushSync();
    expect(cueOf(saves.song, 12)).toBe(3);
    expect(cueOf(saves.song, 13)).toBe(4);
    release();
    await settled();
    expect(cueOf(server.song, 12)).toBe(3);
    expect(cueOf(server.song, 13)).toBe(4);
  });

  it('stays where it is as a Cue is taken back, its save failing, naming the Line', async () => {
    const server = new FakeSongServer(verseSong());
    const { syncMode, saves, port } = await syncModeFor(server);
    switchOn(syncMode);
    server.failNext(4);
    port.playhead = 3;
    syncMode.cue();
    await settled();
    expect(cueOf(saves.song, 12)).toBeNull();
    expect(cueOf(server.song, 12)).toBeNull();
    expect(saves.saveError).toMatch(/^Couldn't save the Cue of Line 3 of Verse, so it was taken back\./);
    expect(syncMode.next).toEqual({ section: 1, line: 13 });
  });

  it('is the Line clicked', async () => {
    const { syncMode } = await syncModeFor(new FakeSongServer(verseSong()));
    switchOn(syncMode);
    syncMode.pick({ section: 1, line: 11 });
    expect(syncMode.next).toEqual({ section: 1, line: 11 });
  });

  it('never depends on where playback is', async () => {
    const { syncMode, port } = await syncModeFor(new FakeSongServer(verseSong()));
    switchOn(syncMode);
    for (const at of [0, 1.5, 2.5, 30]) {
      port.playhead = at;
      flushSync();
      expect(syncMode.next).toEqual({ section: 1, line: 12 });
    }
  });

  it('starts again from the first Line without a Cue each time Sync mode comes on', async () => {
    const { syncMode } = await syncModeFor(new FakeSongServer(verseSong()));
    switchOn(syncMode);
    syncMode.pick({ section: 1, line: 10 });
    syncMode.end();
    flushSync();
    switchOn(syncMode);
    expect(syncMode.next).toEqual({ section: 1, line: 12 });
  });
});

describe('Sync mode, the first-time hint', () => {
  it('shows the first time Sync mode comes on on a Device, and never again there', async () => {
    const storage = new FakeStorage();
    const server = new FakeSongServer(verseSong());
    const { syncMode } = await syncModeFor(server, storage);
    switchOn(syncMode);
    expect(syncMode.hint).toBe(true);
    syncMode.switch();
    flushSync();
    expect(syncMode.hint).toBe(false);
    switchOn(syncMode);
    expect(syncMode.hint).toBe(false);

    const onAnotherVisit = await syncModeFor(server, storage);
    switchOn(onAnotherVisit.syncMode);
    expect(onAnotherVisit.syncMode.hint).toBe(false);

    const onAnotherDevice = await syncModeFor(server);
    switchOn(onAnotherDevice.syncMode);
    expect(onAnotherDevice.syncMode.hint).toBe(true);
  });
});
