import { describe, expect, it } from 'vitest';
import type { Clip, Take, Timeline, TimelineLoop, Track } from './api';
import type { CuedSong } from './cues';
import { History, recorded, restorable } from './history';

const clip = (id: number, start: number, more: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 100,
  takes: [],
  activeTakeId: null,
  start,
  offset: 0,
  length: 10,
  ...more,
});

const track = (id: number, clips: Clip[] = [], more: Partial<Track> = {}): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0,
  muted: false,
  soloed: false,
  clips,
  ...more,
});

let version = 1;
const timeline = (tracks: Track[], loop: TimelineLoop | null = null): Timeline => ({
  songId: 1,
  version: version++,
  updatedAt: '',
  tracks,
  beats: [],
  loop,
});

// Two Sections: one whose active Alternate has Lines 10 and 11 and inactive
// one Line 12, whose Cue lies dormant, and one with Line 20. The Lines have
// the Cues given, by Line id.
const song = (cues: Record<number, number> = {}): CuedSong => {
  const line = (id: number, text: string) => ({ id, text, cue: cues[id] ?? null });
  return {
    arrangement: [1, 2],
    sections: [
      {
        id: 1,
        alternates: [
          { active: true, lines: [line(10, 'Drive, drive'), line(11, 'all night')] },
          { active: false, lines: [line(12, 'Ride, ride')] },
        ],
      },
      { id: 2, alternates: [{ active: true, lines: [line(20, 'City lights')] }] },
    ],
  };
};

const take = (id: number): Take => ({
  id,
  number: 1,
  size: 1000,
  duration: 12,
  sampleRate: 48000,
  latencyOffset: 0.01,
  position: 0,
  recordedAt: '',
});

/** A Clip of Takes, playing the first of them. */
const takeClip = (id: number, start: number, takes: Take[]): Clip =>
  clip(id, start, { beatId: null, takes, activeTakeId: takes[0].id, offset: 2 });

describe('History', () => {
  it('has nothing to undo or redo at first', () => {
    const h = new History();
    expect(h.nextUndo()).toBeNull();
    expect(h.nextRedo()).toBeNull();
  });

  it('undoes a move by moving the Clip back', () => {
    const h = new History();
    const before = timeline([track(1, [clip(5, 0)]), track(2)]);
    const after = timeline([track(1), track(2, [clip(5, 12)])]);

    h.record({ kind: 'moveClip', clipId: 5, trackId: 2, start: 12 }, before, after);

    expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 5, trackId: 1, start: 0 });
  });

  it('redoes what was undone, and undoes earlier edits in turn', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 12)])]);
    const t2 = timeline([track(1, [clip(5, 20)])]);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 20 }, t1, t2);

    h.undone(t2, timeline([track(1, [clip(5, 12)])]));

    expect(h.nextRedo()).toEqual({ kind: 'moveClip', clipId: 5, trackId: 1, start: 20 });
    expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 5, trackId: 1, start: 0 });

    h.redone(t1, t2);

    expect(h.nextRedo()).toBeNull();
    expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 });
  });

  it('forgets what was undone once there is a new edit', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 12)])]);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
    h.undone(t1, t0);

    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 30 }, t0, timeline([track(1, [clip(5, 30)])]));

    expect(h.nextRedo()).toBeNull();
  });

  it('undoes deleting a Clip by placing it back, and follows it to its new id', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0), clip(6, 10)])]);
    const t1 = timeline([track(1, [clip(5, 0, { offset: 2, length: 8 }), clip(6, 10)])]);
    const t2 = timeline([track(1, [clip(6, 10)])]);
    h.record({ kind: 'trimClip', clipId: 5, offset: 2, length: 8 }, t0, t1);
    h.record({ kind: 'deleteClip', clipId: 5 }, t1, t2);

    expect(h.nextUndo()).toEqual({
      kind: 'placeClip',
      trackId: 1,
      clip: { beatId: 100, start: 0, offset: 2, length: 8 },
    });
    h.undone(t2, timeline([track(1, [clip(9, 0, { offset: 2, length: 8 }), clip(6, 10)])]));

    expect(h.nextRedo()).toEqual({ kind: 'deleteClip', clipId: 9 });
    expect(h.nextUndo()).toEqual({ kind: 'trimClip', clipId: 9, offset: 0, length: 10 });
  });

  it('undoes adding a Beat by deleting its Clip, or the Track it made for it', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 0), clip(6, 10)])]);
    h.record({ kind: 'addBeat', beatId: 100 }, t0, t1);
    expect(h.nextUndo()).toEqual({ kind: 'deleteClip', clipId: 6 });

    const empty = timeline([]);
    h.record({ kind: 'addBeat', beatId: 100 }, empty, timeline([track(3, [clip(7, 0)])]));
    expect(h.nextUndo()).toEqual({ kind: 'deleteTrack', trackId: 3 });
  });

  it('redoes adding a Beat, and follows what it added to its new ids', () => {
    const h = new History();
    const t0 = timeline([]);
    const t1 = timeline([track(3, [clip(7, 0)])]);
    const t2 = timeline([track(3, [clip(7, 20)])]);
    h.record({ kind: 'addBeat', beatId: 100 }, t0, t1);
    h.record({ kind: 'moveClip', clipId: 7, trackId: 3, start: 20 }, t1, t2);
    h.undone(t2, t1);
    h.undone(t1, t0);

    expect(h.nextRedo()).toEqual({ kind: 'addBeat', beatId: 100 });
    h.redone(t0, timeline([track(4, [clip(8, 0)])]));

    expect(h.nextRedo()).toEqual({ kind: 'moveClip', clipId: 8, trackId: 4, start: 20 });
    expect(h.nextUndo()).toEqual({ kind: 'deleteTrack', trackId: 4 });
  });

  it('undoes adding, duplicating and placing by deleting what was added', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 0)]), track(2)]);
    h.record({ kind: 'addTrack', track: { name: 'Track 2' } }, t0, t1);
    expect(h.nextUndo()).toEqual({ kind: 'deleteTrack', trackId: 2 });

    const t2 = timeline([track(1, [clip(5, 0), clip(6, 10)]), track(2)]);
    h.record({ kind: 'duplicateClip', clipId: 5 }, t1, t2);
    expect(h.nextUndo()).toEqual({ kind: 'deleteClip', clipId: 6 });

    const t3 = timeline([track(1, [clip(5, 0), clip(6, 10)]), track(2, [clip(7, 3)])]);
    h.record({ kind: 'placeClip', trackId: 2, clip: { beatId: 100, start: 3, offset: 0, length: 10 } }, t2, t3);
    expect(h.nextUndo()).toEqual({ kind: 'deleteClip', clipId: 7 });
  });

  it('undoes deleting a Track by adding it back as it was, and follows it and its Clips', () => {
    const h = new History();
    const beat = track(1, [clip(5, 0), clip(6, 30, { offset: 2, length: 15 })], {
      name: 'Beat',
      volume: -4.5,
      muted: true,
    });
    const t0 = timeline([track(2), beat, track(3)]);
    const t1 = timeline([track(2), { ...beat, clips: [clip(5, 0), clip(6, 40, { offset: 2, length: 15 })] }, track(3)]);
    const t2 = timeline([track(2), track(3)]);
    h.record({ kind: 'moveClip', clipId: 6, trackId: 1, start: 40 }, t0, t1);
    h.record({ kind: 'deleteTrack', trackId: 1 }, t1, t2);

    expect(h.nextUndo()).toEqual({
      kind: 'addTrack',
      track: {
        name: 'Beat',
        position: 1,
        volume: -4.5,
        muted: true,
        soloed: false,
        clips: [
          { beatId: 100, start: 0, offset: 0, length: 10 },
          { beatId: 100, start: 40, offset: 2, length: 15 },
        ],
      },
    });
    h.undone(t2, timeline([track(2), { ...beat, id: 4, clips: [clip(8, 0), clip(9, 40)] }, track(3)]));

    expect(h.nextRedo()).toEqual({ kind: 'deleteTrack', trackId: 4 });
    expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 9, trackId: 4, start: 30 });
  });

  it('undoes renaming a Track or setting its levels by setting back only what changed', () => {
    const h = new History();
    const t0 = timeline([track(1, [], { name: 'Beat', volume: -3 })]);
    const t1 = timeline([track(1, [], { name: 'Beat', volume: 2, muted: true })]);
    h.record({ kind: 'updateTrack', trackId: 1, changes: { volume: 2, muted: true } }, t0, t1);
    expect(h.nextUndo()).toEqual({ kind: 'updateTrack', trackId: 1, changes: { volume: -3, muted: false } });

    const t2 = timeline([track(1, [], { name: 'Instrumental', volume: 2, muted: true })]);
    h.record({ kind: 'updateTrack', trackId: 1, changes: { name: 'Instrumental' } }, t1, t2);
    expect(h.nextUndo()).toEqual({ kind: 'updateTrack', trackId: 1, changes: { name: 'Beat' } });
  });

  it('undoes reordering Tracks by putting them back, following Tracks brought back', () => {
    const h = new History();
    const t0 = timeline([track(1), track(2), track(3)]);
    const t1 = timeline([track(3), track(1), track(2)]);
    const t2 = timeline([track(1), track(2)]);
    h.record({ kind: 'reorderTracks', order: [3, 1, 2] }, t0, t1);
    h.record({ kind: 'deleteTrack', trackId: 3 }, t1, t2);
    expect(h.nextUndo()).toMatchObject({ kind: 'addTrack', track: { position: 0 } });

    h.undone(t2, timeline([track(7), track(1), track(2)]));

    expect(h.nextUndo()).toEqual({ kind: 'reorderTracks', order: [1, 2, 7] });
  });

  it('undoes setting, switching and clearing the Loop', () => {
    const h = new History();
    const t0 = timeline([]);
    const t1 = timeline([], { start: 4, end: 8, on: true });
    h.record({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } }, t0, t1);
    expect(h.nextUndo()).toEqual({ kind: 'clearLoop' });

    const t2 = timeline([], { start: 2, end: 8, on: true });
    h.record({ kind: 'setLoop', loop: { start: 2, end: 8, on: true } }, t1, t2);
    expect(h.nextUndo()).toEqual({ kind: 'setLoop', loop: { start: 4, end: 8, on: true } });

    const t3 = timeline([], { start: 2, end: 8, on: false });
    h.record({ kind: 'switchLoop', on: false }, t2, t3);
    expect(h.nextUndo()).toEqual({ kind: 'switchLoop', on: true });

    h.record({ kind: 'clearLoop' }, t3, timeline([]));
    expect(h.nextUndo()).toEqual({ kind: 'setLoop', loop: { start: 2, end: 8, on: false } });
  });

  it("doesn't keep an edit that changed nothing", () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 12)])]);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
    h.undone(t1, t0);

    h.record({ kind: 'updateTrack', trackId: 1, changes: { volume: 0 } }, t0, timeline([track(1, [clip(5, 0)])]));

    expect(h.nextUndo()).toBeNull();
    expect(h.nextRedo()).toEqual({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 });
  });

  it('forgets everything when cleared', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 12)])]);
    const t2 = timeline([track(1, [clip(5, 20)])]);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 20 }, t1, t2);
    h.undone(t2, t1);

    h.clear();

    expect(h.nextUndo()).toBeNull();
    expect(h.nextRedo()).toBeNull();
  });

  describe('with Cue edits', () => {
    // A Cue edit leaves the Timeline as it was.
    const tl = timeline([]);

    it('undoes a Cue edit by restoring the Cues it changed, and redoes it the same way', () => {
      const h = new History();
      const before = song({ 20: 30 });
      const after = song({ 10: 4, 20: 30 });

      h.recordCues(before, after);

      expect(h.nextUndo()).toEqual({
        kind: 'restoreCues',
        cues: [
          { lineId: 10, cue: null },
        ],
      });
      h.undone(tl, tl);
      expect(h.nextUndo()).toBeNull();
      expect(h.nextRedo()).toEqual({
        kind: 'restoreCues',
        cues: [
          { lineId: 10, cue: 4 },
        ],
      });
      h.redone(tl, tl);
      expect(h.nextRedo()).toBeNull();
      expect(h.nextUndo()).toMatchObject({ kind: 'restoreCues' });
    });

    it("undoes clearing a Section's Cues by putting back each of them, dormant ones included", () => {
      const h = new History();
      const before = song({ 10: 4, 11: 6, 12: 5, 20: 32 });
      const after = song({ 20: 32 });

      h.recordCues(before, after);

      expect(h.nextUndo()).toEqual({
        kind: 'restoreCues',
        cues: [
          { lineId: 10, cue: 4 },
          { lineId: 11, cue: 6 },
          { lineId: 12, cue: 5 },
        ],
      });
    });

    it('undoes clearing all Cues by putting back every one, and redoes it by clearing them again', () => {
      const h = new History();
      const before = song({ 11: 6, 12: 32 });
      const after = song();

      h.recordCues(before, after);
      expect(h.nextUndo()).toEqual({
        kind: 'restoreCues',
        cues: [
          { lineId: 11, cue: 6 },
          { lineId: 12, cue: 32 },
        ],
      });
      h.undone(tl, tl);

      expect(h.nextRedo()).toEqual({
        kind: 'restoreCues',
        cues: [
          { lineId: 11, cue: null },
          { lineId: 12, cue: null },
        ],
      });
    });

    it("doesn't keep a Cue edit that changed nothing", () => {
      const h = new History();
      const cued = song({ 10: 4 });

      h.recordCues(cued, song({ 10: 4 }));

      expect(h.nextUndo()).toBeNull();
    });

    it('undoes and redoes Cue and Timeline edits mixed, in order, following Clips brought back', () => {
      const h = new History();
      const t0 = timeline([track(1, [clip(5, 0)])]);
      const t1 = timeline([track(1, [clip(5, 12)])]);
      const t2 = timeline([track(1)]);
      const s0 = song();
      const s1 = song({ 10: 2 });
      h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
      h.recordCues(s0, s1);
      h.record({ kind: 'deleteClip', clipId: 5 }, t1, t2);

      expect(h.nextUndo()).toMatchObject({ kind: 'placeClip', trackId: 1 });
      const t3 = timeline([track(1, [clip(9, 12)])]);
      h.undone(t2, t3);
      expect(h.nextUndo()).toMatchObject({ kind: 'restoreCues', cues: [{ lineId: 10, cue: null }] });
      h.undone(t3, t3);
      expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 9, trackId: 1, start: 0 });
      h.undone(t3, timeline([track(1, [clip(9, 0)])]));
      expect(h.nextUndo()).toBeNull();

      expect(h.nextRedo()).toEqual({ kind: 'moveClip', clipId: 9, trackId: 1, start: 12 });
      h.redone(t3, t3);
      expect(h.nextRedo()).toMatchObject({ kind: 'restoreCues', cues: [{ lineId: 10, cue: 2 }] });
      h.redone(t3, t3);
      expect(h.nextRedo()).toEqual({ kind: 'deleteClip', clipId: 9 });
    });

    it('forgets what was undone once there is a new Cue edit', () => {
      const h = new History();
      const t0 = timeline([track(1, [clip(5, 0)])]);
      const t1 = timeline([track(1, [clip(5, 12)])]);
      h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
      h.undone(t1, t0);

      h.recordCues(song(), song({ 10: 3 }));

      expect(h.nextRedo()).toBeNull();
      expect(h.nextUndo()).toMatchObject({ kind: 'restoreCues' });
    });
  });
});

describe('restorable', () => {
  it('keeps the Cues whose Line is still there', () => {
    const cues = [
      { lineId: 10, cue: null },
      { lineId: 12, cue: 7 },
    ];

    expect(restorable(cues, song())).toEqual(cues);
  });

  it("leaves out Cues whose Line is gone, or can't take one any more", () => {
    // Line 10 is now blank.
    const now: CuedSong = {
      arrangement: [1],
      sections: [{ id: 1, alternates: [{ active: true, lines: [{ id: 10, text: '  ', cue: null }] }] }],
    };

    expect(
      restorable(
        [
          { lineId: 10, cue: 4 },
          { lineId: 10, cue: null },
          { lineId: 11, cue: 6 },
        ],
        now,
      ),
    ).toEqual([{ lineId: 10, cue: null }]);
  });

  it('keeps the Cues of Lines in the Scrapbook', () => {
    const now: CuedSong = {
      arrangement: [1],
      sections: [
        { id: 1, alternates: [{ active: true, lines: [{ id: 10, text: 'Drive', cue: null }] }] },
        { id: 3, alternates: [{ active: true, lines: [{ id: 30, text: 'Set aside', cue: null }] }] },
      ],
    };
    const cues = [
      { lineId: 30, cue: 5 },
      { lineId: 10, cue: 2 },
    ];

    expect(restorable(cues, now)).toEqual(cues);
  });
});

describe('History of Takes', () => {
  it('undoes a recording by deleting its Clip, and redoes it by placing its Take back', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)]), track(2)]);
    const t1 = timeline([track(1, [clip(5, 0)]), track(2, [takeClip(6, 10, [take(40)])])]);

    const edit = recorded(t0, t1);
    h.record(edit, t0, t1);

    expect(edit).toEqual({
      kind: 'placeClip',
      trackId: 2,
      clip: { takeIds: [40], activeTakeId: 40, start: 10, offset: 2, length: 10 },
    });
    expect(h.nextUndo()).toEqual({ kind: 'deleteClip', clipId: 6 });

    h.undone(t1, t0);
    expect(h.nextRedo()).toEqual(edit);

    // Placed back, the Take is in a new Clip.
    h.redone(t0, timeline([track(1, [clip(5, 0)]), track(2, [takeClip(9, 10, [take(40)])])]));
    expect(h.nextUndo()).toEqual({ kind: 'deleteClip', clipId: 9 });
  });

  it('undoes deleting a Clip of Takes by placing its Takes back, the same one active', () => {
    const h = new History();
    const c = clip(6, 10, { beatId: null, takes: [take(40), take(41)], activeTakeId: 41 });
    const t0 = timeline([track(2, [c])]);
    const t1 = timeline([track(2)]);

    h.record({ kind: 'deleteClip', clipId: 6 }, t0, t1);

    expect(h.nextUndo()).toEqual({
      kind: 'placeClip',
      trackId: 2,
      clip: { takeIds: [40, 41], activeTakeId: 41, start: 10, offset: 0, length: 10 },
    });
    h.undone(t1, timeline([track(2, [{ ...c, id: 8 }])]));
    expect(h.nextRedo()).toEqual({ kind: 'deleteClip', clipId: 8 });
  });

  it("undoes deleting a Track by adding it back with its Clips' Takes", () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)]), track(2, [takeClip(6, 10, [take(40)])], { name: 'Lead vox' })]);
    const t1 = timeline([track(1, [clip(5, 0)])]);

    h.record({ kind: 'deleteTrack', trackId: 2 }, t0, t1);

    expect(h.nextUndo()).toEqual({
      kind: 'addTrack',
      track: {
        name: 'Lead vox',
        position: 1,
        volume: 0,
        muted: false,
        soloed: false,
        clips: [{ takeIds: [40], activeTakeId: 40, start: 10, offset: 2, length: 10 }],
      },
    });
    h.undone(t1, timeline([track(1, [clip(5, 0)]), track(3, [takeClip(7, 10, [take(40)])], { name: 'Lead vox' })]));
    expect(h.nextRedo()).toEqual({ kind: 'deleteTrack', trackId: 3 });
  });
});
