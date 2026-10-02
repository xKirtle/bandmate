import { describe, expect, it } from 'vitest';
import type { Clip, Take, Track } from './api';
import { copy, emptyClipboard, paste } from './clipboard';

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

/** Where each pasted Clip goes, as "Track id:start", or "new Track index:start" on a Track the paste adds. */
const landing = (pasted: ReturnType<typeof paste>) =>
  pasted?.clips.map((p) => `${'trackId' in p ? p.trackId : `new ${p.newTrack}`}:${p.clip.start}`);

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

    expect(copy(tracks, new Set([6, 5]))?.clips).toEqual([
      { row: 0, clip: { beatId: 100, start: 0, offset: 2, length: 10 } },
      {
        row: 1,
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
    expect(copy([track(1, [clip(5, 4, 8, { beatId: null, soundId: 9 })])], new Set([5]))?.clips).toEqual([
      { row: 0, clip: { soundId: 9, start: 4, offset: 0, length: 8 } },
    ]);
  });

  it('holds each Clip’s row below the topmost copied, and the names of the Tracks they came from, those between included', () => {
    const tracks = [track(1), track(2, [clip(5, 0)]), track(3), track(4, [clip(6, 30)])];

    expect(copy(tracks, new Set([5, 6]))).toEqual({
      tracks: ['Track 2', 'Track 3', 'Track 4'],
      clips: [
        { row: 0, clip: { beatId: 100, start: 0, offset: 0, length: 10 } },
        { row: 2, clip: { beatId: 100, start: 30, offset: 0, length: 10 } },
      ],
    });
  });
});

describe('paste', () => {
  it('pastes nothing from an empty Clipboard', () => {
    expect(paste(emptyClipboard, [track(1)], 0, 1)).toBeNull();
  });

  it('starts the earliest Clip at the playhead on the Chosen Track, the rest keeping their times relative to it', () => {
    const clipboard = copy([track(1, [clip(5, 10, 5), clip(6, 20, 5)])], new Set([5, 6]))!;

    const pasted = paste(clipboard, [track(1, [clip(5, 10, 5), clip(6, 20, 5)]), track(2)], 42, 2);

    expect(landing(pasted)).toEqual(['2:42', '2:52']);
    expect(pasted!.newTracks).toEqual([]);
    expect(pasted!.clips[0].clip).toEqual({ beatId: 100, start: 42, offset: 0, length: 5 });
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
      starts.push(pasted.clips.map((p) => p.clip.start));
      const placed = pasted.clips.map((p, j) => clip(100 + i * 10 + j, p.clip.start, p.clip.length));
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

    expect(pasted).toEqual({
      newTracks: [],
      clips: [{ trackId: 1, clip: { beatId: 100, name: 'Intro', start: 0, offset: 1, length: 5 } }],
    });
  });

  it('pastes nothing onto a Track that isn’t there', () => {
    const clipboard = copy([track(1, [clip(5, 0)])], new Set([5]))!;

    expect(paste(clipboard, [track(1)], 0, 99)).toBeNull();
  });

  describe('across Tracks', () => {
    // Copied: a Clip at 0:10 on Track 2, and one at 0:04 on Track 4.
    const copied = [track(1), track(2, [clip(5, 10, 5)]), track(3), track(4, [clip(6, 4, 5)])];
    const clipboard = copy(copied, new Set([5, 6]))!;

    it('puts the topmost Clip on the Chosen Track, the rest keeping their Tracks and times relative to it', () => {
      const tracks = [track(1), track(2), track(3), track(4), track(5)];

      // The earliest, on Track 4, starts at the playhead; Track 2's Clip
      // goes on the Chosen Track, Track 1, and Track 4's two below it.
      expect(landing(paste(clipboard, tracks, 20, 1))).toEqual(['1:26', '3:20']);
      expect(paste(clipboard, tracks, 20, 1)!.newTracks).toEqual([]);
    });

    it('puts rows past the last Track on new Tracks at the bottom, named after the Tracks they came from', () => {
      const tracks = [track(1), track(2)];

      // From Track 2, the Clipboard's three rows run two past the last.
      const pasted = paste(clipboard, tracks, 0, 2)!;

      expect(landing(pasted)).toEqual(['2:6', 'new 1:0']);
      expect(pasted.newTracks).toEqual([{ name: 'Track 3' }, { name: 'Track 4' }]);
    });

    it('goes later as a whole to the first place every Clip fits, on every Track it touches', () => {
      // From Track 1, Track 3 gets the earliest Clip and Track 1 the other,
      // 6s later. At 0:00, Track 3's lands on its Clip, which ends at 0:30;
      // from there, Track 1's lands on its Clip at 0:40, which ends at 0:45;
      // from there, both fit. Track 2's Clip is in neither's way.
      const tracks = [track(1, [clip(7, 40, 5)]), track(2, [clip(8, 0, 100)]), track(3, [clip(9, 2, 28)])];

      expect(landing(paste(clipboard, tracks, 0, 1))).toEqual(['1:45', '3:39']);
    });
  });
});
