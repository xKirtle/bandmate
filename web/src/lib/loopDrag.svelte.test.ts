import { describe, expect, it } from 'vitest';
import type { Clip, TimelineLoop, Track } from './api';
import { LoopDrag, type LoopAt } from './loopDrag.svelte';
import type { LoopGrip } from './snapping';

/** A Clip of a Beat placed from start to end. */
function clip(id: number, start: number, end: number): Clip {
  return {
    id,
    beatId: 1,
    soundId: null,
    name: null,
    gain: 0,
    fadeIn: 0,
    fadeOut: 0,
    takes: [],
    activeTakeId: null,
    start,
    offset: 0,
    length: end - start,
  };
}

function track(id: number, clips: Clip[]): Track {
  return { id, name: `Track ${id}`, volume: 0, muted: false, soloed: false, clips };
}

// Two Tracks: a Beat in a Clip at 0:10-0:20, and another Clip below, at
// 0:30-0:50. The Timeline shown runs to 1:00.
const song = () => [track(1, [clip(1, 10, 20)]), track(2, [clip(2, 30, 50)])];

// Drawn at 10 px a second: the slop, 4 px, is 0.4 s, and an edge snaps
// within 8 px, 0.8 s.
const scale = 10;

/** The pointer at a time along the top of the ruler, `dy` px below where it went down. */
const at = (time: number, dy = 0): LoopAt => ({ point: { clientX: time * scale, clientY: dy }, time });

/** A Loop drag over a Timeline, as the Timeline makes it, with a playhead and a Loop that change as they would. */
function timelineDrag(loop: TimelineLoop | null = null) {
  const state = $state<{ tracks: Track[]; playhead: number; loop: TimelineLoop | null }>({
    tracks: song(),
    playhead: 0,
    loop,
  });
  const drag = new LoopDrag({
    tracks: () => state.tracks,
    playhead: () => state.playhead,
    loop: () => state.loop,
    reach: () => 8 / scale,
    span: () => 60,
  });
  return {
    drag,
    state,
    /** Presses along the top of the ruler, or the Loop's start or end, at a time, with Shift held or not. */
    press(grip: LoopGrip, time: number, free = false) {
      drag.press(grip, at(time), free);
    },
  };
}

describe('LoopDrag', () => {
  describe('a press let go without moving past the slop', () => {
    it('is a click, and sets nothing', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      expect(drag.move(at(4.4))).toBe(false);

      expect(drag.loop).toBeNull();
      expect(drag.release()).toBeNull();
      expect(drag.pressed).toBe(false);
    });

    it('is a click however it wobbles, up to the slop either way, as everywhere else', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      expect(drag.move(at(4.4, 4))).toBe(false);
      expect(drag.move(at(3.6, -4))).toBe(false);

      expect(drag.release()).toBeNull();
    });

    it('is a drag past the slop up or down, too', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      expect(drag.move(at(4, 5))).toBe(true);
    });
  });

  describe('marking a new Loop', () => {
    it('shows it switched on where it is dragged, and saves it on release', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      drag.move(at(7));

      expect(drag.loop).toEqual({ start: 4, end: 7, on: true });
      expect(drag.release()).toEqual({ kind: 'setLoop', loop: { start: 4, end: 7, on: true } });
      expect(drag.loop).toBeNull();
      expect(drag.pressed).toBe(false);
    });

    it('runs either side of where it was pressed', () => {
      const { drag, press } = timelineDrag();
      press('new', 7);

      drag.move(at(4));

      expect(drag.loop).toEqual({ start: 4, end: 7, on: true });
    });

    it('sets nothing when dragged shorter than the shortest Loop', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      drag.move(at(6));
      drag.move(at(4.2));

      expect(drag.loop).toEqual({ start: 4, end: 4.2, on: true });
      expect(drag.release()).toBeNull();
    });

    it('stays within the Timeline shown', () => {
      const { drag, press } = timelineDrag();
      press('new', 55);
      drag.move(at(70));
      expect(drag.loop).toEqual({ start: 55, end: 60, on: true });

      drag.move(at(-5));
      expect(drag.loop).toEqual({ start: 0, end: 55, on: true });
    });

    it("snaps where it was pressed to a Clip's edge, so both its ends can land on something", () => {
      const { drag, press } = timelineDrag();
      press('new', 10.5);

      drag.move(at(15));

      expect(drag.loop).toEqual({ start: 10, end: 15, on: true });
    });

    it('switches on a Loop drawn over one switched off, just where it was', () => {
      const { drag, press } = timelineDrag({ start: 4, end: 7, on: false });
      press('new', 4);

      drag.move(at(7));

      expect(drag.release()).toEqual({ kind: 'setLoop', loop: { start: 4, end: 7, on: true } });
    });
  });

  describe("dragging the Loop's start or end", () => {
    it('moves only the end, keeping the start, and whether it is on', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: false });
      press('end', 6);

      drag.move(at(8));

      expect(drag.loop).toEqual({ start: 2, end: 8, on: false });
      expect(drag.release()).toEqual({ kind: 'setLoop', loop: { start: 2, end: 8, on: false } });
    });

    it('moves only the start, keeping the end', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('start', 2);

      drag.move(at(1));

      expect(drag.release()).toEqual({ kind: 'setLoop', loop: { start: 1, end: 6, on: true } });
    });

    it('stops the shortest Loop short of the other edge', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('start', 2);

      drag.move(at(9));

      expect(drag.loop).toEqual({ start: 5.75, end: 6, on: true });
    });

    it('saves nothing when let go where it was', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);

      drag.move(at(9));
      drag.move(at(6));

      expect(drag.release()).toBeNull();
    });

    it('marks a new Loop when there is no Loop shown to drag', () => {
      const { drag, press } = timelineDrag();
      press('end', 4);

      drag.move(at(7));

      expect(drag.loop).toEqual({ start: 4, end: 7, on: true });
    });
  });

  describe('snapping', () => {
    it("snaps an edge to a Clip's edge, on any Track", () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);

      drag.move(at(29.5));

      expect(drag.loop).toEqual({ start: 2, end: 30, on: true });
      expect(drag.snap).toMatchObject({ at: 30, aligned: [1] });
    });

    it('snaps to the playhead', () => {
      const { drag, state, press } = timelineDrag();
      state.playhead = 4;
      press('new', 1);

      drag.move(at(4.5));

      expect(drag.loop).toEqual({ start: 1, end: 4, on: true });
      expect(drag.snap).toMatchObject({ at: 4, aligned: ['playhead'] });
    });

    it('skips snapping with Shift held as it was pressed, where it was pressed too', () => {
      const { drag, press } = timelineDrag();
      press('new', 10.5, true);

      drag.move(at(19.5));

      expect(drag.loop).toEqual({ start: 10.5, end: 19.5, on: true });
      expect(drag.snap).toBeNull();
    });

    it('frees or snaps the Loop as Shift is pressed or let go mid-drag, without the pointer moving', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);
      drag.move(at(19.5), false);
      expect(drag.loop?.end).toBe(20);

      drag.modifier(true, at(19.5));
      expect(drag.loop?.end).toBe(19.5);
      expect(drag.snap).toBeNull();

      drag.modifier(false, at(19.5));
      expect(drag.loop?.end).toBe(20);
      expect(drag.snap).toMatchObject({ at: 20 });
    });

    it('goes by Shift as the pointer moves, where it is known', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);

      drag.move(at(19.5), true);
      expect(drag.loop?.end).toBe(19.5);

      // Replayed as the lanes scroll along, with no keys to go by.
      drag.move(at(19.6));
      expect(drag.loop?.end).toBe(19.6);
    });

    it('leaves a press not yet a drag be as Shift changes', () => {
      const { drag, press } = timelineDrag();
      press('new', 4);

      drag.modifier(true, at(4));

      expect(drag.loop).toBeNull();
      expect(drag.snap).toBeNull();
    });

    it('lets go of the guide on release', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);
      drag.move(at(19.5));

      drag.release();

      expect(drag.snap).toBeNull();
    });
  });

  describe('given up before release, e.g. for a second finger pinching', () => {
    it('drops it, showing nothing and saving nothing', () => {
      const { drag, press } = timelineDrag({ start: 2, end: 6, on: true });
      press('end', 6);
      drag.move(at(19.5));

      drag.cancel();

      expect(drag.pressed).toBe(false);
      expect(drag.loop).toBeNull();
      expect(drag.snap).toBeNull();
      expect(drag.release()).toBeNull();
    });
  });
});
