// Checks the fake song server against the real one. Each case in the file
// read below was recorded from the Go server (internal/app's
// song_server_contract_test.go): a Song set up there, one change made to it,
// and the Song or Timeline before and after. Here the fake is made from the
// recorded before, makes the same change, and must leave what the server
// left, as far as the fake claims to: see the projections below.
//
// Each case also checks the song server still sends its change as the
// request the Go test sent, so the two sides make the same change.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song, SongAt, Timeline } from './api';
import type { CueChange } from './cueChanges';
import type { Edit } from './history';
import type { LyricSheetChange } from './lyricSheetChanges';
import { songServer } from './songServer';
import { emptySong, FakeSongServer, notModelledKinds, type ChangeKind } from './songServerFake';

type Change = CueChange | LyricSheetChange | Edit;

/** A change recorded from the real server, with the Song or Timeline it found and left. */
type RecordedCase = { name: string; change: Change; request: { method: string; path: string; body?: unknown } } & (
  { of: 'song'; before: Song; after: Song } | { of: 'timeline'; before: Timeline; after: Timeline }
);

const cases: RecordedCase[] = JSON.parse(
  readFileSync(new URL('../../../internal/app/testdata/song_server_contract.json', import.meta.url), 'utf8'),
);

/** Every kind of change the song server makes, to check each has a case or is declared not modelled. */
const changeKinds = Object.keys({
  setLineCue: true,
  clearSectionCues: true,
  clearCues: true,
  shiftCues: true,
  restoreCues: true,
  addSection: true,
  duplicateSection: true,
  reorderArrangement: true,
  removeFromArrangement: true,
  addToSection: true,
  deleteSection: true,
  setSectionLabel: true,
  addAlternate: true,
  renameAlternate: true,
  activateAlternate: true,
  deleteAlternate: true,
  moveAlternateToScrapbook: true,
  moveAlternateToArrangement: true,
  addToScrapbook: true,
  addToArrangement: true,
  replaceAlternateText: true,
  restoreSnapshot: true,
  putSheetBack: true,
  addBeat: true,
  addTrack: true,
  updateTrack: true,
  reorderTracks: true,
  deleteTrack: true,
  placeClip: true,
  placeClips: true,
  duplicateClip: true,
  pasteClips: true,
  moveClip: true,
  moveClips: true,
  trimClip: true,
  renameClip: true,
  setClipGain: true,
  setClipFades: true,
  setClipTempos: true,
  setClipPitches: true,
  deleteClip: true,
  deleteClips: true,
  replaceClips: true,
  splitClips: true,
  setTakes: true,
  chooseTake: true,
  nudgeTake: true,
  deleteTake: true,
  clearInactiveTakes: true,
  setLoop: true,
  switchLoop: true,
  clearLoop: true,
} satisfies Record<ChangeKind, true>) as ChangeKind[];

/**
 * Numbers ids anew, each kind of id from 1, in the order they're first
 * seen, so ids the server and the fake each make up compare equal. Seen
 * first in the Song or Timeline before the change, ids already there keep
 * theirs, so which Clip, say, keeps an id still counts.
 */
type Renumber = (kind: string, id: number) => number;

function renumbering(): Renumber {
  const kinds = new Map<string, Map<number, number>>();
  return (kind, id) => {
    const ids = kinds.get(kind) ?? new Map<number, number>();
    kinds.set(kind, ids);
    if (!ids.has(id)) ids.set(id, ids.size + 1);
    return ids.get(id)!;
  };
}

/** A number as compared: to a billionth, past which float sums differ. */
const num = (x: number) => Math.round(x * 1e9) / 1e9;

const orNull = <T, U>(x: T | null, f: (x: T) => U): U | null => (x === null ? null : f(x));

/**
 * What the fake promises of a Song: its Lyric Sheet and Scrapbook, every
 * Section in their order, with its Label, Alternates, and their Lines' text
 * and Cues. A Line's lyrics and Chords, which the server reads from its
 * text, aren't, nor is anything a change to the sheet leaves as it was.
 */
function sheetOf(song: Song, id: Renumber) {
  const arrangement = song.arrangement.map((s) => id('section', s));
  const scrapbook = song.scrapbook.map((s) => id('section', s));
  // Sections in the order shown, any in neither last, in the order given.
  const shown = [...song.arrangement, ...song.scrapbook];
  const rank = (sectionId: number) => (shown.includes(sectionId) ? shown.indexOf(sectionId) : shown.length);
  const sections = [...song.sections].sort((a, b) => rank(a.id) - rank(b.id));
  return {
    arrangement,
    scrapbook,
    sections: sections.map((s) => ({
      id: id('section', s.id),
      label: s.label,
      alternates: s.alternates.map((a) => ({
        id: id('alternate', a.id),
        name: a.name,
        active: a.active,
        lines: a.lines.map((l) => ({ id: id('line', l.id), text: l.text, cue: orNull(l.cue, num) })),
      })),
    })),
  };
}

/**
 * What the fake promises of a Timeline: its Tracks, top to bottom, with
 * their levels and Clips in the order they start, and its Loop. Which
 * Beats and Sounds the Clips play is worked out on the server, so isn't.
 */
function timelineOf(tl: Timeline, id: Renumber) {
  return {
    tracks: tl.tracks.map((t) => ({
      id: id('track', t.id),
      name: t.name,
      volume: num(t.volume),
      muted: t.muted,
      soloed: t.soloed,
      clips: t.clips.map((c) => ({
        id: id('clip', c.id),
        beatId: c.beatId,
        soundId: c.soundId,
        name: c.name,
        gain: num(c.gain),
        tempo: num(c.tempo),
        pitch: c.pitch,
        fadeIn: num(c.fadeIn),
        fadeOut: num(c.fadeOut),
        start: num(c.start),
        offset: num(c.offset),
        length: num(c.length),
        activeTakeId: orNull(c.activeTakeId, (k) => id('take', k)),
        takes: c.takes.map((k) => ({ id: id('take', k.id), position: num(k.position), nudge: num(k.nudge) })),
      })),
    })),
    loop: tl.loop && { start: num(tl.loop.start), end: num(tl.loop.end), on: tl.loop.on },
  };
}

/** A case's after, as compared, its ids numbered from its before's. */
function projected(c: RecordedCase, after: Song | Timeline) {
  const id = renumbering();
  if (c.of === 'song') {
    sheetOf(c.before, id);
    return sheetOf(after as Song, id);
  }
  timelineOf(c.before, id);
  return timelineOf(after as Timeline, id);
}

/** The fake, holding a case's before. */
function fakeOf(c: RecordedCase): FakeSongServer {
  if (c.of === 'song') return new FakeSongServer(c.before);
  const fake = new FakeSongServer(emptySong({ id: c.before.songId, version: c.before.version }), c.before.tracks);
  fake.timeline = structuredClone(c.before);
  return fake;
}

const songAt = (c: RecordedCase): SongAt =>
  c.of === 'song' ? { id: c.before.id, version: c.before.version } : { id: c.before.songId, version: c.before.version };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
  it('leaves what the server left', async () => {
    const fake = fakeOf(c);
    const after = await fake.apply(songAt(c), c.change as Edit);
    expect(projected(c, after)).toEqual(projected(c, c.after));
  });

  it('is sent as the request the server was sent', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body === undefined ? undefined : JSON.parse(init.body as string);
      sent.push({ method: init.method, path: url, body, ifMatch: headers['If-Match'] });
      return new Response(JSON.stringify(c.after), { headers: { 'Content-Type': 'application/json' } });
    });
    const at = songAt(c);
    await songServer(at.id).apply(at, c.change as Edit);
    const { method, path, body } = c.request;
    expect(sent).toEqual([{ method, path: `/api${path}`, body, ifMatch: `"${at.version}"` }]);
  });
});

describe('the cases', () => {
  const recorded = new Set(cases.map((c) => c.change.kind));

  it('cover every kind of change, but those the fake declares it doesn’t model', () => {
    expect(changeKinds.filter((kind) => !recorded.has(kind) && !notModelledKinds.has(kind))).toEqual([]);
  });

  it('leave out every kind the fake declares it doesn’t model', () => {
    expect([...notModelledKinds].filter((kind) => recorded.has(kind))).toEqual([]);
  });
});

describe('a kind the fake declares it doesn’t model', () => {
  it.each([...notModelledKinds])('%s is refused as not modelled', async (kind) => {
    const fake = new FakeSongServer();
    await expect(fake.apply({ id: 1, version: 1 }, { kind } as Edit)).rejects.toThrow(`${kind} is not modelled`);
  });
});
