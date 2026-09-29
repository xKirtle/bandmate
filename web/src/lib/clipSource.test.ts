import { describe, expect, it } from 'vitest';
import type { Clip, ClipBeat, Timeline } from './api';
import { clipSources, placementOf } from './clipSource';

const beat = (id: number, more: Partial<ClipBeat> = {}): ClipBeat => ({
  id,
  title: `Beat ${id}`,
  bpm: null,
  fileName: `beat-${id}.mp3`,
  size: 1000,
  duration: 90,
  ...more,
});

const clip = (id: number, beatId: number): Clip => ({ id, beatId, start: 5, offset: 2, length: 10 });

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

describe('placementOf', () => {
  it('is what re-places a Clip as it was: its source and trim, without its id', () => {
    expect(placementOf(clip(1, 7))).toEqual({ beatId: 7, start: 5, offset: 2, length: 10 });
  });
});
