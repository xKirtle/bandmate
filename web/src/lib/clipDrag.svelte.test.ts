import { afterEach, describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { ClipDrag, type ClipGrip, type ClipMeasure, type DragAt } from './clipDrag.svelte';
import type { Freeze } from './freeze';
import { Selection } from './selection.svelte';

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** A Clip of a Beat 60 s long, or with a Take, of Takes, placed from start to end. */
function clip(id: number, start: number, end: number, take?: { nudge: number }): Clip {
  return {
    id,
    beatId: take ? null : 1,
    soundId: null,
    name: null,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    takes: take
      ? [
          {
            id: 100 + id,
            number: 1,
            size: 0,
            duration: 60,
            sampleRate: 48000,
            latencyOffset: 0,
            position: 0,
            nudge: take.nudge,
            recordedAt: '2026-01-01T00:00:00Z',
          },
        ]
      : [],
    activeTakeId: take ? 100 + id : null,
    start,
    offset: 0,
    length: end - start,
  };
}

function track(id: number, clips: Clip[]): Track {
  return { id, name: `Track ${id}`, volume: 0, muted: false, soloed: false, clips };
}

// Two Tracks: a Beat in two Clips, at 0:10-0:20 and 0:40-0:50, and a vocal
// Take's Clip below, at 0:25-0:35.
const song = () => [track(1, [clip(1, 10, 20), clip(2, 40, 50)]), track(2, [clip(3, 25, 35, { nudge: 0 })])];

// Drawn at 10 px a second, each Track's lane 100 px tall: the slop, 4 px,
// is 0.4 s, and an edge snaps within 8 px, 0.8 s.
const scale = 10;

/** The pointer at a time over a Track's lane, as the Timeline measures it. */
const at = (time: number, trackId = 1): DragAt => ({
  point: { clientX: time * scale, clientY: trackId * 100 + 50 },
  time,
  trackId,
});

/** The pointer at a time over a Track's lane, `dy` px below its middle, e.g. dragging a gain line. */
const below = (dy: number, time: number, trackId = 1): DragAt => {
  const point = at(time, trackId);
  return { ...point, point: { ...point.point, clientY: point.point.clientY + dy } };
};

// A Clip's waveform 72 px tall: its gain line goes 1 dB a pixel.
const waveHeight = 72;

/**
 * A Clip drag over a Timeline, as the Timeline makes it, with its
 * Selection, a playhead and a Loop that change as they would.
 */
function timelineDrag(tracks: Track[] = song()) {
  const state = $state<{
    tracks: Track[];
    freeze: Freeze;
    playhead: number;
    loop: { start: number; end: number } | null;
  }>({ tracks, freeze: null, playhead: 0, loop: null });
  let selection!: Selection;
  cleanups.push(
    $effect.root(() => {
      selection = new Selection(
        () => state.tracks,
        () => state.freeze,
      );
    }),
  );
  const drag = new ClipDrag(selection, {
    tracks: () => state.tracks,
    playhead: () => state.playhead,
    loop: () => state.loop,
    reach: () => 8 / scale,
    sourceLength: () => 60,
  });
  const clipOf = (id: number) => state.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
  return {
    drag,
    selection,
    state,
    /** Presses a Clip, by its body, an edge, its gain line or a fade dot, at a time, with the modifiers held. */
    press(
      clipId: number,
      grip: ClipGrip,
      time: number,
      keys: Partial<{ free: boolean; toggles: boolean; nudges: boolean }> = {},
      measured: ClipMeasure = { waveHeight },
    ) {
      const c = clipOf(clipId);
      const trackId = state.tracks.find((t) => t.clips.includes(c))!.id;
      drag.press(c, grip, at(time, trackId), { free: false, toggles: false, nudges: false, ...keys }, measured);
    },
  };
}

/** The selected Clips' ids, in order. */
const ids = (selection: Selection) => [...selection.ids].sort((a, b) => a - b);

describe('ClipDrag', () => {
  describe('a press let go without moving past the slop', () => {
    it('clicks the Clip, selecting it alone, and saves nothing', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'all' });
      press(1, 'move', 15);

      drag.move(at(15.3));

      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([1]);
      expect(drag.clip).toBeNull();
    });

    it('adds the Clip to the Selection with Mod held as it was pressed', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'click', clipId: 3 });
      press(1, 'move', 15, { toggles: true });

      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([1, 3]);
    });

    it('takes the Clip out of the Selection with Mod held as it was pressed', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'all' });
      press(1, 'move', 15, { toggles: true });

      drag.release();

      expect(ids(selection)).toEqual([2, 3]);
    });

    it('clicks the Clip pressed by an edge, too', () => {
      const { drag, selection, press } = timelineDrag();
      press(2, 'end', 50);

      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([2]);
    });

    it('shows nothing moved, so the Clip pressed stays where it is', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      expect(drag.move(at(15.4))).toBe(false);

      expect(drag.moved).toBe(false);
      expect(drag.shown).toEqual([]);
    });
  });

  describe('a press moved past the slop', () => {
    it('is a drag, selecting the Clip alone when it is outside the Selection', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'click', clipId: 3 });
      press(1, 'move', 15);

      expect(drag.move(at(15.5))).toBe(true);

      expect(drag.moved).toBe(true);
      expect(ids(selection)).toEqual([1]);
    });

    it('keeps the Selection when it is a trim', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'click', clipId: 3 });
      press(1, 'end', 20);

      drag.move(at(18));
      drag.release();

      expect(ids(selection)).toEqual([3]);
    });

    it('never clicks the Clip on release', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'all' });
      press(1, 'move', 15, { toggles: true });

      drag.move(at(14));
      drag.move(at(15));
      drag.release();

      expect(ids(selection)).toEqual([1, 2, 3]);
    });
  });

  describe('moving a Clip', () => {
    it('shows it where it is dragged, and saves the move, offering to move its Cues', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.move(at(28, 1));

      expect(drag.shown).toEqual([
        {
          clip: expect.objectContaining({ id: 1 }),
          trackId: 1,
          at: expect.objectContaining({ start: 23, length: 10 }),
        },
      ]);
      expect(drag.release()).toEqual({
        edit: { kind: 'moveClip', clipId: 1, trackId: 1, start: 23 },
        moved: { clips: [expect.objectContaining({ id: 1, start: 10 })], by: 13 },
      });
    });

    it('moves it onto the Track dragged over', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.move(at(5, 2));

      expect(drag.release()?.edit).toEqual({ kind: 'moveClip', clipId: 1, trackId: 2, start: 0 });
    });

    it('stops at a neighbour it is dragged into', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.move(at(38));

      expect(drag.release()?.edit).toMatchObject({ start: 30 });
    });

    it('saves nothing when let go where it started', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.move(at(25, 2));
      drag.move(at(15, 1));

      expect(drag.release()).toBeNull();
      expect(drag.clip).toBeNull();
    });

    it('nudges the active Take instead with Alt held, for a Clip of Takes', () => {
      const { drag, press } = timelineDrag();
      press(3, 'move', 30, { nudges: true });

      drag.move(at(30.5, 1));

      expect(drag.mode).toBe('nudge');
      const [shown] = drag.shown;
      expect(shown.at).toMatchObject({ start: 25, length: 10 });
      expect(shown.trackId).toBe(2);
      expect(shown.clip.takes[0]).toMatchObject({ nudge: 0.5, position: 0.5 });
      expect(drag.release()).toEqual({ edit: { kind: 'nudgeTake', clipId: 3, takeId: 103, nudge: 0.5 }, moved: null });
    });

    it('moves a Clip of a Beat with Alt held, as it has no Take to nudge', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15, { nudges: true });

      drag.move(at(16));

      expect(drag.mode).toBe('move');
      expect(drag.release()?.edit.kind).toBe('moveClip');
    });

    it('saves no Nudge when let go where the Take was', () => {
      const { drag, press } = timelineDrag();
      press(3, 'move', 30, { nudges: true });

      drag.move(at(31, 2));
      drag.move(at(30, 2));

      expect(drag.release()).toBeNull();
    });
  });

  describe('trimming a Clip', () => {
    it('saves its start trimmed, the audio staying where it is', () => {
      const { drag, press } = timelineDrag();
      press(1, 'start', 10);

      drag.move(at(12));

      expect(drag.shown[0].at).toEqual({ start: 12, offset: 2, length: 8 });
      expect(drag.release()).toEqual({ edit: { kind: 'trimClip', clipId: 1, offset: 2, length: 8 }, moved: null });
    });

    it('saves its end trimmed, stopping at the Clip after it', () => {
      const { drag, press } = timelineDrag();
      press(1, 'end', 20);

      drag.move(at(45));

      expect(drag.release()?.edit).toEqual({ kind: 'trimClip', clipId: 1, offset: 0, length: 30 });
    });

    it('saves nothing when let go where it was', () => {
      const { drag, press } = timelineDrag();
      press(1, 'end', 20);

      drag.move(at(18));
      drag.move(at(20));

      expect(drag.release()).toBeNull();
    });
  });

  describe('snapping', () => {
    it("snaps a moved Clip's edge to another Clip's, with a guide from its lane", () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      // Its start, at 24.5, goes onto the Take's start at 25, a Track below.
      drag.move(at(29.5, 1));

      expect(drag.shown[0].at.start).toBe(25);
      expect(drag.snap).toEqual({ at: 25, aligned: [1], trackId: 1 });
    });

    it('snaps to the playhead and to the Loop', () => {
      const { drag, press, state } = timelineDrag();
      state.playhead = 3;
      state.loop = { start: 55, end: 70 };
      press(1, 'move', 15);

      drag.move(at(8.4));
      expect(drag.shown[0].at.start).toBe(3);
      expect(drag.snap).toMatchObject({ at: 3, aligned: ['playhead'] });

      drag.move(at(60.6));
      expect(drag.shown[0].at.start).toBe(55);
      expect(drag.snap).toMatchObject({ at: 55, aligned: ['loop'] });
    });

    it("snaps a trimmed edge to another Clip's", () => {
      const { drag, press } = timelineDrag();
      press(1, 'end', 20);

      drag.move(at(25.5));

      expect(drag.shown[0].at.length).toBe(15);
      expect(drag.snap).toMatchObject({ at: 25 });
    });

    it('skips snapping with Shift held as it was pressed', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15, { free: true });

      drag.move(at(29.5, 1));

      expect(drag.shown[0].at.start).toBe(24.5);
      expect(drag.snap).toBeNull();
    });

    it('skips snapping, or snaps again, as Shift is pressed or let go mid-drag', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);
      drag.move(at(29.5, 1));

      drag.modifier(true, at(29.5, 1));
      expect(drag.shown[0].at.start).toBe(24.5);
      expect(drag.snap).toBeNull();

      drag.modifier(false, at(29.5, 1));
      expect(drag.shown[0].at.start).toBe(25);
      expect(drag.snap).not.toBeNull();
    });

    it('goes by Shift as the pointer moves, where it is known', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.move(at(29.5, 1), true);
      expect(drag.snap).toBeNull();

      // Replayed as the lanes scroll along, with no keys to go by.
      drag.move(at(29.5, 1));
      expect(drag.snap).toBeNull();

      drag.move(at(29.5, 1), false);
      expect(drag.snap).not.toBeNull();
    });

    it('leaves a press not yet a drag be as Shift changes', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);

      drag.modifier(true, at(29.5, 1));

      expect(drag.moved).toBe(false);
      expect(drag.shown).toEqual([]);
    });

    it('lets go of the guide on release', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);
      drag.move(at(29.5, 1));

      drag.release();

      expect(drag.snap).toBeNull();
    });
  });

  describe('moving the Selection', () => {
    it('moves every selected Clip together, keeping their Tracks, and saves them as one move', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'toggle', clipId: 1 });
      selection.apply({ kind: 'toggle', clipId: 3 });
      press(1, 'move', 15);

      drag.move(at(17, 2));

      expect(ids(selection)).toEqual([1, 3]);
      expect(drag.shown.map(({ clip, trackId, at }) => [clip.id, trackId, at.start])).toEqual([
        [1, 1, 12],
        [3, 2, 27],
      ]);
      expect(drag.release()).toEqual({
        edit: {
          kind: 'moveClips',
          moves: [
            { clipId: 1, trackId: 1, start: 12 },
            { clipId: 3, trackId: 2, start: 27 },
          ],
        },
        moved: { clips: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 3 })], by: 2 },
      });
    });

    it("snaps by any selected Clip's edge, with a guide from that Clip's lane", () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'toggle', clipId: 1 });
      selection.apply({ kind: 'toggle', clipId: 3 });
      press(1, 'move', 15);

      // The Take's end, moved to 39.5, goes onto the next Beat Clip's start at 40.
      drag.move(at(19.5, 1));

      expect(drag.shown.map(({ at }) => at.start)).toEqual([15, 30]);
      expect(drag.snap).toEqual({ at: 40, aligned: [0], trackId: 2 });
    });

    it('saves nothing when let go where they were', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'toggle', clipId: 1 });
      selection.apply({ kind: 'toggle', clipId: 3 });
      press(1, 'move', 15);

      drag.move(at(17));
      drag.move(at(15));

      expect(drag.release()).toBeNull();
    });

    it('moves the Clip alone when it is outside a frozen Selection, leaving the Selection be', () => {
      const { drag, selection, press, state } = timelineDrag();
      selection.apply({ kind: 'toggle', clipId: 1 });
      selection.apply({ kind: 'toggle', clipId: 3 });
      press(2, 'move', 45);
      state.freeze = 'recording';

      drag.move(at(60));

      expect(ids(selection)).toEqual([1, 3]);
      expect(drag.release()?.edit).toEqual({ kind: 'moveClip', clipId: 2, trackId: 1, start: 55 });
    });
  });

  describe("dragging a Clip's gain line", () => {
    it('shows and saves the Gain it is dragged to, the line following the pointer', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);

      drag.move(below(-10, 15));

      expect(drag.mode).toBe('gain');
      expect(drag.shown).toEqual([
        { clip: expect.objectContaining({ id: 1, gain: 10 }), trackId: 1, at: expect.objectContaining({ start: 10 }) },
      ]);
      expect(drag.release()).toEqual({ edit: { kind: 'setClipGain', clipId: 1, gain: 10 }, moved: null });
    });

    it('lets go of the Clip on release, handing its Gain over to be shown until saved', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);
      drag.move(below(-10, 15));

      expect(drag.release()).not.toBeNull();

      expect(drag.clip).toBeNull();
      expect(drag.saving).toBe(false);
      expect(drag.shown).toEqual([]);
    });

    it('drags it a tenth as far with Shift held as it was pressed', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15, { free: true });

      drag.move(below(-10, 15));

      expect(drag.shown[0].clip.gain).toBe(1);
    });

    it('drags it finely from where it is as Shift is pressed mid-drag, so the line never jumps, and back', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);
      drag.move(below(-10, 15));

      drag.modifier(true, below(-10, 15));
      expect(drag.shown[0].clip.gain).toBe(10);
      drag.move(below(-20, 15));
      expect(drag.shown[0].clip.gain).toBe(11);

      drag.modifier(false, below(-20, 15));
      drag.move(below(-30, 15));
      expect(drag.shown[0].clip.gain).toBe(21);
    });

    it('selects the Clip alone as it is grabbed, and lets go without clicking it', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'all' });

      press(1, 'gain', 15);
      expect(ids(selection)).toEqual([1]);

      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([1]);
      expect(drag.clip).toBeNull();
    });

    it('adds the Clip to the Selection as it is grabbed with Mod held', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'click', clipId: 3 });

      press(1, 'gain', 15, { toggles: true });
      expect(ids(selection)).toEqual([1, 3]);

      drag.release();
      expect(ids(selection)).toEqual([1, 3]);
    });

    it('saves nothing when let go at the Gain it had', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);

      drag.move(below(-10, 15));
      drag.move(below(0, 15));

      expect(drag.release()).toBeNull();
      expect(drag.clip).toBeNull();
    });

    it('goes by Shift as the pointer moves, rebased the same way', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);
      drag.move(below(-10, 15), false);

      drag.move(below(-12, 15), true);
      expect(drag.shown[0].clip.gain).toBe(10);
      drag.move(below(-22, 15), true);
      expect(drag.shown[0].clip.gain).toBe(11);
    });
  });

  describe("dragging a Clip's fade dot", () => {
    // Each dot 0.6 s wide, resting 0.5 s in from the Clip's edge without a Fade.
    const dots = (fadeIn: number, fadeOut: number) => ({ dots: { fadeIn, fadeOut, width: 0.6, rests: 0.5 } });

    it('shows and saves the fade in it is dragged to, from where the dot was grabbed', () => {
      const { drag, press } = timelineDrag();
      press(1, 'fadeIn', 10.6, {}, dots(10.5, 19.5));

      drag.move(at(14.1));

      expect(drag.mode).toBe('fadeIn');
      expect(drag.shown).toEqual([
        {
          clip: expect.objectContaining({ id: 1, fadeIn: 4, fadeOut: 0 }),
          trackId: 1,
          at: expect.objectContaining({ start: 10, length: 10 }),
        },
      ]);
      expect(drag.release()).toEqual({
        edit: { kind: 'setClipFades', clipId: 1, fadeIn: 4, fadeOut: 0 },
        moved: null,
      });
    });

    it('lets go of the Clip on release, handing its Fades over to be shown until saved', () => {
      const { drag, press } = timelineDrag();
      press(1, 'fadeOut', 19.5, {}, dots(10.5, 19.5));
      drag.move(at(17));

      expect(drag.release()).not.toBeNull();

      expect(drag.clip).toBeNull();
      expect(drag.saving).toBe(false);
      expect(drag.shown).toEqual([]);
    });

    it('shows and saves the fade out it is dragged to', () => {
      const { drag, press } = timelineDrag();
      press(1, 'fadeOut', 19.5, {}, dots(10.5, 19.5));

      drag.move(at(17));

      expect(drag.release()?.edit).toEqual({ kind: 'setClipFades', clipId: 1, fadeIn: 0, fadeOut: 3 });
    });

    it('takes a Fade off when its dot is dragged back to where it rests', () => {
      const tracks = [track(1, [{ ...clip(1, 10, 20), fadeIn: 4 }])];
      const { drag, press } = timelineDrag(tracks);
      press(1, 'fadeIn', 14, {}, dots(14, 19.5));

      drag.move(at(10.3));

      expect(drag.release()?.edit).toEqual({ kind: 'setClipFades', clipId: 1, fadeIn: 0, fadeOut: 0 });
    });

    it('grabs the dot on the side of their middle pressed, where the Fades meet', () => {
      const tracks = [track(1, [{ ...clip(1, 10, 20), fadeIn: 5, fadeOut: 5 }])];
      const { drag, press } = timelineDrag(tracks);

      // The fade out's dot is pressed, over the fade in's, left of their middle.
      press(1, 'fadeOut', 14.8, {}, dots(15, 15));
      expect(drag.mode).toBe('fadeIn');
      drag.move(at(12.8));
      expect(drag.release()?.edit).toEqual({ kind: 'setClipFades', clipId: 1, fadeIn: 3, fadeOut: 5 });

      // The fade in's dot is pressed, right of their middle.
      press(1, 'fadeIn', 15.2, {}, dots(15, 15));
      expect(drag.mode).toBe('fadeOut');
      drag.move(at(17.2));
      expect(drag.release()?.edit).toEqual({ kind: 'setClipFades', clipId: 1, fadeIn: 5, fadeOut: 3 });
    });

    it('selects the Clip as it is grabbed, and lets go without clicking it', () => {
      const { drag, selection, press } = timelineDrag();
      selection.apply({ kind: 'click', clipId: 3 });

      press(1, 'fadeIn', 10.5, { toggles: true }, dots(10.5, 19.5));
      expect(ids(selection)).toEqual([1, 3]);

      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([1, 3]);
    });

    it('saves nothing when let go at the Fades it had', () => {
      const { drag, press } = timelineDrag();
      press(1, 'fadeIn', 10.5, {}, dots(10.5, 19.5));

      drag.move(at(14));
      drag.move(at(10.5));

      expect(drag.release()).toBeNull();
      expect(drag.clip).toBeNull();
    });
  });

  describe('a move or a trim, until its save resolves', () => {
    it('holds the Clip where it was dropped, however the pointer goes', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);
      drag.move(at(28));

      expect(drag.release()).not.toBeNull();
      expect(drag.saving).toBe(true);

      expect(drag.move(at(60))).toBe(false);
      drag.modifier(true, at(60));
      drag.cancel();
      expect(drag.release()).toBeNull();

      expect(drag.clip?.id).toBe(1);
      expect(drag.shown[0].at.start).toBe(23);
    });

    it('holds a trimmed Clip where it was dropped too', () => {
      const { drag, press } = timelineDrag();
      press(1, 'end', 20);
      drag.move(at(17));

      expect(drag.release()).not.toBeNull();

      expect(drag.saving).toBe(true);
      expect(drag.shown[0].at).toMatchObject({ start: 10, length: 7 });
    });

    it('shows the Clips as the Timeline has them once resolved', () => {
      const { drag, press } = timelineDrag();
      press(1, 'move', 15);
      drag.move(at(28));
      const save = drag.release()!;

      drag.saved(save);

      expect(drag.clip).toBeNull();
      expect(drag.saving).toBe(false);
      expect(drag.shown).toEqual([]);
    });

    it('isn’t let go by an earlier drag’s save resolving, e.g. a Gain handed over', () => {
      const { drag, press } = timelineDrag();
      press(1, 'gain', 15);
      drag.move(below(-10, 15));
      const gained = drag.release()!;
      press(2, 'move', 45);
      drag.move(at(55));

      drag.saved(gained);
      expect(drag.clip?.id).toBe(2);
      const moved = drag.release()!;
      drag.saved(gained);
      expect(drag.saving).toBe(true);

      drag.saved(moved);
      expect(drag.clip).toBeNull();
    });
  });

  describe('given up before release, e.g. for a long press', () => {
    it('ends, showing nothing moved and saving nothing', () => {
      const { drag, selection, press } = timelineDrag();
      press(1, 'move', 15);
      drag.move(at(28));

      drag.cancel();

      expect(drag.clip).toBeNull();
      expect(drag.shown).toEqual([]);
      expect(drag.release()).toBeNull();
      expect(ids(selection)).toEqual([1]);
    });
  });
});
