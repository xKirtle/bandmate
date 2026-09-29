import { describe, expect, it, vi } from 'vitest';
import { api, type Clip, type ClipBeat, type Take, type Timeline } from './api';
import { clipSources, heard, placementOf, playing } from './clipSource';

const beat = (id: number, more: Partial<ClipBeat> = {}): ClipBeat => ({
  id,
  title: `Beat ${id}`,
  bpm: null,
  fileName: `beat-${id}.mp3`,
  size: 1000,
  duration: 90,
  ...more,
});

const clip = (id: number, beatId: number): Clip => ({
  id,
  beatId,
  takes: [],
  activeTakeId: null,
  lastTakeNumber: 0,
  start: 5,
  offset: 2,
  length: 10,
});

const take = (id: number, more: Partial<Take> = {}): Take => ({
  id,
  number: 1,
  size: 1000,
  duration: 8,
  sampleRate: 48000,
  latencyOffset: 0.01,
  position: 0,
  recordedAt: '',
  ...more,
});

/** A Clip of Takes at 0:30, playing 10s of its span from 2s in. */
const takeClip = (id: number, takes: Take[], active = takes[0].id): Clip => ({
  id,
  beatId: null,
  takes,
  activeTakeId: active,
  lastTakeNumber: takes.length,
  start: 30,
  offset: 2,
  length: 10,
});

const timeline = (clips: Clip[], beats: ClipBeat[]): Timeline => ({
  songId: 1,
  version: 1,
  updatedAt: '',
  tracks: [{ id: 1, name: 'Beat', volume: 0, muted: false, soloed: false, clips }],
  beats,
  loop: null,
});

describe('clipSources', () => {
  it("gives a Beat Clip its Beat's title, audio and length", () => {
    const sources = clipSources(timeline([clip(1, 7)], [beat(7, { title: 'Night drive', duration: 95.5 })]));
    const source = sources.of(clip(1, 7));
    expect(source.title).toBe('Night drive');
    expect(source.duration).toBe(95.5);
    expect(source.audio).toBe('/api/beats/7/audio?v=beat-7.mp3-1000-95.5');
  });

  it('tells the Beats Clips play apart, and Clips of the same Beat play one source', () => {
    const sources = clipSources(timeline([clip(1, 7), clip(2, 8), clip(3, 7)], [beat(7), beat(8)]));
    expect(sources.of(clip(1, 7)).key).toBe(sources.of(clip(3, 7)).key);
    expect(sources.of(clip(1, 7)).key).not.toBe(sources.of(clip(2, 8)).key);
    expect(sources.all().map((s) => s.title)).toEqual(['Beat 7', 'Beat 8']);
  });
});

describe('clipSources of Takes', () => {
  it("plays a Take Clip's active Take, named by its number, over the span up to its end", () => {
    const c = takeClip(1, [take(3, { number: 1 }), take(4, { number: 2, position: 1.5, duration: 20 })], 4);
    const source = clipSources(timeline([c], [])).of(c);
    expect(source.title).toBe('Take 2');
    expect(source.audio).toBe('/api/songs/1/takes/4/audio');
    expect(source.duration).toBe(21.5);
  });

  it("spans all of a Take Clip's Takes, whichever is active", () => {
    const c = takeClip(1, [take(3, { duration: 30 }), take(4, { position: 1.5, duration: 20 })], 4);
    expect(clipSources(timeline([c], [])).of(c).duration).toBe(30);
  });

  it('tells Takes apart from each other and from Beats', () => {
    const a = takeClip(1, [take(3)]);
    const b = takeClip(2, [take(4)]);
    const sources = clipSources(timeline([a, b, clip(3, 3)], [beat(3)]));
    expect(new Set([a, b, clip(3, 3)].map((c) => sources.of(c).key)).size).toBe(3);
    expect(sources.all()).toHaveLength(3);
  });

  it("lays a Take's peaks out in its span, silent before its position", async () => {
    vi.spyOn(api, 'getTake').mockResolvedValue(take(3, { position: 0.02, peaks: [0.5, 1] }));
    const c = takeClip(1, [take(3, { position: 0.02 })]);
    expect(await clipSources(timeline([c], [])).of(c).loadPeaks()).toEqual([0, 0, 0.5, 1]);
    expect(api.getTake).toHaveBeenCalledWith(1, 3);
  });
});

describe('heard', () => {
  it("is a Beat Clip's placement as it is", () => {
    expect(heard(clip(1, 7))).toEqual({ start: 5, offset: 2, length: 10 });
  });

  it('plays a Take from as far into its file as the Clip is trimmed', () => {
    // The Take fills the span from 0 for 12s: the Clip plays 2s to 12s of it.
    expect(heard(takeClip(1, [take(3, { duration: 12 })]))).toEqual({ start: 30, offset: 2, length: 10 });
  });

  it('starts a Take that starts later in the span where it comes in', () => {
    // It comes in 5s into the span, 3s into the Clip, and plays to the Clip's end.
    expect(heard(takeClip(1, [take(3, { position: 5, duration: 20 })]))).toEqual({ start: 33, offset: 0, length: 7 });
  });

  it("stops a Take that ends before the Clip does, and plays its active Take's only", () => {
    const c = takeClip(1, [take(3, { duration: 20 }), take(4, { position: 1, duration: 6 })], 4);
    expect(heard(c)).toEqual({ start: 30, offset: 1, length: 5 });
  });

  it('plays nothing of a Take trimmed out of the Clip', () => {
    expect(heard(takeClip(1, [take(3, { duration: 1.5 })]))).toBeNull();
  });
});

describe('playing', () => {
  const beatClip = clip(1, 7);
  const vocal = takeClip(2, [take(3, { duration: 12 })]);
  const tl = timeline([beatClip, vocal], [beat(7)]);
  const played = (silent?: number) => playing(tl, clipSources(tl), silent).map((c) => [c.source, c.start]);

  it('plays what every Clip holds, from its audio, on its Track', () => {
    expect(playing(tl, clipSources(tl))).toEqual([
      { start: 5, offset: 2, length: 10, source: '/api/beats/7/audio?v=beat-7.mp3-1000-90', trackId: 1 },
      { start: 30, offset: 2, length: 10, source: '/api/songs/1/takes/3/audio', trackId: 1 },
    ]);
  });

  it('keeps the Clip being retaken silent, and plays the rest', () => {
    expect(played(2)).toEqual([['/api/beats/7/audio?v=beat-7.mp3-1000-90', 5]]);
    expect(played(1)).toEqual([['/api/songs/1/takes/3/audio', 30]]);
  });

  it('leaves out a Clip with nothing of its Take in it', () => {
    const empty = takeClip(3, [take(4, { duration: 1 })]);
    const t = timeline([empty], []);
    expect(playing(t, clipSources(t))).toEqual([]);
  });
});

describe('placementOf', () => {
  it('is what re-places a Clip as it was: its source and trim, without its id', () => {
    expect(placementOf(clip(1, 7))).toEqual({ beatId: 7, start: 5, offset: 2, length: 10 });
  });

  it('places a Clip of Takes back with its Takes, the same one active, numbering on', () => {
    expect(placementOf(takeClip(1, [take(3), take(4)], 4))).toEqual({
      takeIds: [3, 4],
      activeTakeId: 4,
      lastTakeNumber: 2,
      start: 30,
      offset: 2,
      length: 10,
    });
  });
});
