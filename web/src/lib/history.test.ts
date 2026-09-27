import { describe, expect, it } from 'vitest';
import type { Clip, Occurrence, Song, Timeline, TimelineLoop, Track } from './api';
import { History } from './history';

const clip = (id: number, start: number, more: Partial<Clip> = {}): Clip => ({
  id,
  beatId: 100,
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

const occurrence = (id: number, cue: number | null, lineCues: Record<number, number> = {}): Occurrence => ({
  id,
  sectionId: 1,
  shared: false,
  cue,
  lineCues,
});

const song = (arrangement: Occurrence[]): Song => ({
  id: 1,
  version: version++,
  title: 'Midnight Drive',
  status: 'drafting',
  key: '',
  bpm: null,
  capo: null,
  tuning: '',
  notes: '',
  showChords: true,
  showCues: true,
  createdAt: '',
  updatedAt: '',
  arrangement,
  sections: [],
  scrapbook: [],
  masters: [],
});

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

  it('undoes a Cue edit by restoring what it changed, and redoes it by setting it again', () => {
    const h = new History();
    const s0 = song([occurrence(1, 2, { 10: 2, 11: 6 }), occurrence(2, null)]);
    const s1 = song([occurrence(1, 3, { 10: 3, 11: 6 }), occurrence(2, null)]);

    h.record({ kind: 'setLineCue', occurrenceId: 1, lineId: 10, cue: 3 }, s0, s1);

    expect(h.nextUndo()).toEqual({
      kind: 'restoreCues',
      cues: [
        { occurrenceId: 1, cue: 2 },
        { occurrenceId: 1, lineId: 10, cue: 2 },
      ],
    });
    h.undone(s1, s0);
    expect(h.nextUndo()).toBeNull();
    expect(h.nextRedo()).toEqual({
      kind: 'restoreCues',
      cues: [
        { occurrenceId: 1, cue: 3 },
        { occurrenceId: 1, lineId: 10, cue: 3 },
      ],
    });
  });

  it('undoes clearing a Cue by setting it back, and redoes it by clearing it', () => {
    const h = new History();
    const s0 = song([occurrence(1, 2, { 10: 2, 11: 6 })]);
    const s1 = song([occurrence(1, 2, { 10: 2 })]);

    h.record({ kind: 'setLineCue', occurrenceId: 1, lineId: 11, cue: null }, s0, s1);
    h.undone(s1, s0);

    expect(h.nextRedo()).toEqual({ kind: 'restoreCues', cues: [{ occurrenceId: 1, lineId: 11, cue: null }] });
  });

  it("undoes clearing an Occurrence's Cues, dormant ones included, leaving the others alone", () => {
    const h = new History();
    const s0 = song([occurrence(1, 2, { 10: 2, 11: 6, 20: 7 }), occurrence(2, 40, { 10: 41 })]);
    const s1 = song([occurrence(1, null), occurrence(2, 40, { 10: 41 })]);

    h.record({ kind: 'clearOccurrenceCues', occurrenceId: 1 }, s0, s1);

    expect(h.nextUndo()).toEqual({
      kind: 'restoreCues',
      cues: [
        { occurrenceId: 1, cue: 2 },
        { occurrenceId: 1, lineId: 10, cue: 2 },
        { occurrenceId: 1, lineId: 11, cue: 6 },
        { occurrenceId: 1, lineId: 20, cue: 7 },
      ],
    });
  });

  it('undoes clearing all Cues, and redoes it', () => {
    const h = new History();
    const s0 = song([occurrence(1, 2, { 10: 2 }), occurrence(2, null), occurrence(3, 90, { 11: 95 })]);
    const s1 = song([occurrence(1, null), occurrence(2, null), occurrence(3, null)]);

    h.record({ kind: 'clearCues' }, s0, s1);

    expect(h.nextUndo()).toEqual({
      kind: 'restoreCues',
      cues: [
        { occurrenceId: 1, cue: 2 },
        { occurrenceId: 1, lineId: 10, cue: 2 },
        { occurrenceId: 3, cue: 90 },
        { occurrenceId: 3, lineId: 11, cue: 95 },
      ],
    });
    h.undone(s1, s0);
    expect(h.nextRedo()).toEqual({
      kind: 'restoreCues',
      cues: [
        { occurrenceId: 1, cue: null },
        { occurrenceId: 1, lineId: 10, cue: null },
        { occurrenceId: 3, cue: null },
        { occurrenceId: 3, lineId: 11, cue: null },
      ],
    });
  });

  it("doesn't keep a Cue edit that changed nothing", () => {
    const h = new History();
    const s0 = song([occurrence(1, null)]);

    h.record({ kind: 'clearCues' }, s0, song([occurrence(1, null)]));

    expect(h.nextUndo()).toBeNull();
  });

  it('undoes and redoes Cue and Timeline edits mixed, in order', () => {
    const h = new History();
    const t0 = timeline([track(1, [clip(5, 0)])]);
    const t1 = timeline([track(1, [clip(5, 12)])]);
    const t2 = timeline([track(1)]);
    const s0 = song([occurrence(1, null)]);
    const s1 = song([occurrence(1, 4, { 10: 4 })]);
    const s2 = song([occurrence(1, null)]);
    h.record({ kind: 'moveClip', clipId: 5, trackId: 1, start: 12 }, t0, t1);
    h.record({ kind: 'setLineCue', occurrenceId: 1, lineId: 10, cue: 4 }, s0, s1);
    h.record({ kind: 'deleteClip', clipId: 5 }, t1, t2);
    h.record({ kind: 'clearCues' }, s1, s2);

    expect(h.nextUndo()).toMatchObject({ kind: 'restoreCues', cues: [{ occurrenceId: 1, cue: 4 }, { cue: 4 }] });
    h.undone(s2, s1);
    expect(h.nextUndo()).toMatchObject({ kind: 'placeClip', clip: { start: 12 } });
    h.undone(t2, timeline([track(1, [clip(9, 12)])]));
    expect(h.nextUndo()).toMatchObject({ kind: 'restoreCues', cues: [{ cue: null }, { cue: null }] });
    h.undone(s1, s0);
    expect(h.nextUndo()).toEqual({ kind: 'moveClip', clipId: 9, trackId: 1, start: 0 });
    h.undone(t1, t0);
    expect(h.nextUndo()).toBeNull();

    expect(h.nextRedo()).toEqual({ kind: 'moveClip', clipId: 9, trackId: 1, start: 12 });
    h.redone(t0, t1);
    expect(h.nextRedo()).toMatchObject({ kind: 'restoreCues', cues: [{ cue: 4 }, { cue: 4 }] });
    h.redone(s0, s1);
    expect(h.nextRedo()).toEqual({ kind: 'deleteClip', clipId: 9 });
    h.redone(t1, t2);
    expect(h.nextRedo()).toMatchObject({ kind: 'restoreCues', cues: [{ cue: null }, { cue: null }] });
    h.redone(s1, s2);
    expect(h.nextRedo()).toBeNull();
  });
});
