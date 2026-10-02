import { describe, expect, it } from 'vitest';
import type { Clip, Take, Track } from './api';
import { copy, paste } from './clipboard';

const clip = (id: number, start: number, length = 10, more: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 100,
  soundId: null,
  name: null,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length,
  ...more,
});

const track = (id: number, clips: Clip[] = []): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0,
  muted: false,
  soloed: false,
  clips,
});

const take = (id: number, position: number, nudge: number): Take => ({
  id,
  number: id,
  size: 1000,
  duration: 4,
  sampleRate: 48000,
  latencyOffset: 0.01,
  position,
  nudge,
  recordedAt: '',
});

/** Where each pasted Clip goes, as "Track id:start". */
const landing = (pasted: ReturnType<typeof paste>) => pasted?.map((p) => `${p.trackId}:${p.clip.start}`);

describe('copy', () => {
  it('copies nothing with no Clip selected', () => {
    expect(copy([track(1, [clip(5, 0)])], new Set())).toBeNull();
  });

  it('holds the selected Clips as they are, with their trim, name and active Take, and Takes as they are in it', () => {
    const takes = clip(6, 20, 3, {
      beatId: null,
      name: 'Hook',
      takes: [take(60, 0, 0), take(61, 0.5, -0.25)],
      activeTakeId: 61,
      offset: 0.5,
    });
    const tracks = [track(1, [clip(5, 0, 10, { offset: 2 }), clip(7, 40)]), track(2, [takes])];

    expect(copy(tracks, new Set([6, 5]))).toEqual([
      { track: 0, clip: { beatId: 100, start: 0, offset: 2, length: 10 } },
      {
        track: 1,
        clip: {
          name: 'Hook',
          takes: [
            { id: 60, position: 0, nudge: 0 },
            { id: 61, position: 0.5, nudge: -0.25 },
          ],
          activeTakeId: 61,
          start: 20,
          offset: 0.5,
          length: 3,
        },
      },
    ]);
  });

  it('holds a Sound’s Clip by its Sound', () => {
    expect(copy([track(1, [clip(5, 4, 8, { beatId: null, soundId: 9 })])], new Set([5]))).toEqual([
      { track: 0, clip: { soundId: 9, start: 4, offset: 0, length: 8 } },
    ]);
  });
});

describe('paste', () => {
  it('pastes nothing from an empty Clipboard', () => {
    expect(paste([], [track(1)], 0, 1)).toBeNull();
  });

  it('starts the earliest Clip at the playhead on the Chosen Track, the rest keeping their times relative to it', () => {
    const clipboard = copy([track(1, [clip(5, 10, 5), clip(6, 20, 5)])], new Set([5, 6]))!;

    const pasted = paste(clipboard, [track(1, [clip(5, 10, 5), clip(6, 20, 5)]), track(2)], 42, 2);

    expect(landing(pasted)).toEqual(['2:42', '2:52']);
    expect(pasted![0].clip).toEqual({ beatId: 100, start: 42, offset: 0, length: 5 });
  });

  it('goes later as a whole to the first place every Clip fits, when any would land on a Clip', () => {
    // Copied: 0:00 to 0:05 and 0:10 to 0:15.
    const clipboard = copy([track(1, [clip(5, 0, 5), clip(6, 10, 5)])], new Set([5, 6]))!;
    // At 0:20, the second would land on the Clip at 0:32, and moved past
    // it, on the one at 0:44; past that, the first lands on one of them in
    // turn, until both fit from 0:48, the gap before 0:44 being too short.
    const there = track(2, [clip(7, 32, 8), clip(8, 44, 4), clip(9, 70, 5)]);

    expect(landing(paste(clipboard, [there], 20, 2))).toEqual(['2:48', '2:58']);
  });

  it('lays copies end to end when pasted again and again at one playhead', () => {
    const clipboard = copy([track(1, [clip(5, 0, 4), clip(6, 6, 4)])], new Set([5, 6]))!;
    let tracks = [track(1, [clip(5, 0, 4), clip(6, 6, 4)]), track(2)];
    const starts: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const pasted = paste(clipboard, tracks, 1, 2)!;
      starts.push(pasted.map((p) => p.clip.start));
      const placed = pasted.map((p, j) => clip(100 + i * 10 + j, p.clip.start, p.clip.length));
      tracks = [
        tracks[0],
        track(
          2,
          [...tracks[1].clips, ...placed].sort((a, b) => a.start - b.start),
        ),
      ];
    }

    expect(starts).toEqual([
      [1, 7],
      [11, 17],
      [21, 27],
    ]);
  });

  it('pastes Clips edge to edge with a Clip there, as touching isn’t overlapping', () => {
    const clipboard = copy([track(1, [clip(5, 0, 5)])], new Set([5]))!;

    expect(landing(paste(clipboard, [track(1, [clip(7, 0, 3), clip(8, 8, 2)])], 3, 1))).toEqual(['1:3']);
  });

  it('pastes the Clips as they were copied, whatever has become of them since', () => {
    const tracks = [track(1, [clip(5, 0, 5, { name: 'Intro', offset: 1 })])];
    const clipboard = copy(tracks, new Set([5]))!;

    const pasted = paste(clipboard, [track(1)], 0, 1);

    expect(pasted).toEqual([{ trackId: 1, clip: { beatId: 100, name: 'Intro', start: 0, offset: 1, length: 5 } }]);
  });

  it('pastes nothing onto a Track that isn’t there', () => {
    const clipboard = copy([track(1, [clip(5, 0)])], new Set([5]))!;

    expect(paste(clipboard, [track(1)], 0, 99)).toBeNull();
  });
});
