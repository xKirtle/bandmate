import { afterEach, describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { BoxDrag, type BoxAt } from './boxDrag.svelte';
import type { Freeze } from './freeze';
import { Selection } from './selection.svelte';

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

// Three Tracks, each lane 100 px tall: Clips 1 at 0:10-0:20 and 2 at
// 0:30-0:40 on the first, 3 at 0:20-0:30 on the second, and 4 at
// 0:40-0:50 on the third.
const song = () => [
  track(1, [clip(1, 10, 20), clip(2, 30, 40)]),
  track(2, [clip(3, 20, 30)]),
  track(3, [clip(4, 40, 50)]),
];

// Drawn at 10 px a second: the slop, 4 px, is 0.4 s.
const scale = 10;
const laneHeight = 100;

/**
 * The pointer at a time across the lanes and a height down them, in
 * pixels, as the Timeline measures it, with the lanes' window at the
 * page's top left.
 */
const at = (time: number, y: number): BoxAt => ({
  point: { clientX: time * scale, clientY: y },
  time,
  track: Math.min(2, Math.floor(y / laneHeight)),
  y,
});

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/** A box drawn over a Timeline, as the Timeline makes it, with a Selection over its Tracks, frozen as a recording or a Merge would. */
function timelineBox() {
  const state = $state<{ freeze: Freeze }>({ freeze: null });
  let selection!: Selection;
  cleanups.push(
    $effect.root(() => {
      selection = new Selection(song, () => state.freeze);
    }),
  );
  const drag = new BoxDrag({ selection, frozen: () => state.freeze !== null });
  return {
    drag,
    selection,
    /** The selected Clips' ids, in order. */
    selected: () => [...selection.ids].sort((a, b) => a - b),
    freeze(freeze: Freeze) {
      state.freeze = freeze;
    },
  };
}

describe('BoxDrag', () => {
  describe('with a mouse', () => {
    it('draws a box from where it was pressed, selecting the Clips it touches as it goes', () => {
      const { drag, selected } = timelineBox();
      drag.press(at(15, 50), false, false);

      expect(drag.move(at(25, 150))).toBe(true);

      expect(drag.box).toEqual({ start: 15, end: 25, top: 50, bottom: 150 });
      expect(selected()).toEqual([1, 3]);
    });

    it('replaces the Selection with what it touches', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), false, false);

      drag.move(at(25, 50));

      expect(selected()).toEqual([1]);
    });

    it('with Mod held as pressed, adds what it touches to the Selection', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), false, true);

      drag.move(at(25, 50));

      expect(selected()).toEqual([1, 4]);
    });

    it('follows the pointer, the Selection growing and shrinking with the box', () => {
      const { drag, selected } = timelineBox();
      drag.press(at(5, 50), false, false);

      drag.move(at(35, 250));
      expect(selected()).toEqual([1, 2, 3]);
      drag.move(at(45, 250));
      expect(selected()).toEqual([1, 2, 3, 4]);
      drag.move(at(15, 120));

      expect(selected()).toEqual([1]);
      expect(drag.box).toEqual({ start: 5, end: 15, top: 50, bottom: 120 });
    });

    it('draws back and up from where it was pressed, too', () => {
      const { drag, selected } = timelineBox();
      drag.press(at(45, 250), false, false);

      drag.move(at(25, 150));

      expect(selected()).toEqual([3, 4]);
      expect(drag.box).toEqual({ start: 45, end: 25, top: 250, bottom: 150 });
    });

    it("doesn't touch a Clip it only meets edge to edge", () => {
      const { drag, selected } = timelineBox();
      drag.press(at(20, 50), false, false);

      drag.move(at(30, 150));

      expect(selected()).toEqual([3]);
    });

    it('keeps its Selection once let go, asking for no click', () => {
      const { drag, selected } = timelineBox();
      drag.press(at(15, 50), false, false);
      drag.move(at(25, 150));

      expect(drag.release()).toBeNull();

      expect(selected()).toEqual([1, 3]);
      expect(drag.box).toBeNull();
      expect(drag.pressed).toBe(false);
    });

    it("draws no box while it wobbles within the slop, and doesn't scroll", () => {
      const { drag, selected } = timelineBox();
      drag.press(at(15, 50), false, false);

      expect(drag.move(at(15.4, 54))).toBe(false);

      expect(drag.box).toBeNull();
      expect(selected()).toEqual([]);
    });

    it('given up, puts the Selection back as it was at the press', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), false, false);
      drag.move(at(25, 150));

      drag.cancel();

      expect(selected()).toEqual([4]);
      expect(drag.box).toBeNull();
      expect(drag.pressed).toBe(false);
    });
  });

  describe('a click, let go within the slop', () => {
    it('clears the Selection and asks for the playhead where it was pressed, unsnapped, and that Track', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15.3, 150), false, false);
      drag.move(at(15.5, 152));

      expect(drag.release()).toEqual({ time: 15.3, track: 1 });

      expect(selected()).toEqual([]);
      expect(drag.pressed).toBe(false);
    });

    it('with Mod held, leaves the Selection, and asks for no playhead or Track', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 150), false, true);

      expect(drag.release()).toBeNull();

      expect(selected()).toEqual([4]);
    });

    it('given up, does nothing', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 150), false, false);

      drag.cancel();

      expect(selected()).toEqual([4]);
      expect(drag.release()).toBeNull();
    });
  });

  describe('with a finger', () => {
    it('is pressed by touch, unlike a mouse', () => {
      const { drag } = timelineBox();
      drag.press(at(15, 50), true, false);
      expect(drag.touch).toBe(true);

      drag.release();
      expect(drag.touch).toBe(false);
      drag.press(at(15, 50), false, false);
      expect(drag.touch).toBe(false);
    });

    it('dragged before the hold, pans instead, giving the press up', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), true, false);

      expect(drag.move(at(25, 150))).toBe(false);

      expect(drag.pressed).toBe(false);
      expect(drag.box).toBeNull();
      expect(selected()).toEqual([4]);
      expect(drag.hold()).toBe(false);
      expect(drag.release()).toBeNull();
    });

    it('tapped, does what a click does', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 150), true, false);
      drag.move(at(15.2, 151));

      expect(drag.release()).toEqual({ time: 15, track: 1 });

      expect(selected()).toEqual([]);
    });

    it('held still, draws a box from under it, emptying the Selection at once', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(25, 50), true, false);

      expect(drag.hold()).toBe(true);

      expect(drag.box).toEqual({ start: 25, end: 25, top: 50, bottom: 50 });
      expect(selected()).toEqual([]);
    });

    it('held, then dragged, draws a box that replaces the Selection, even with Mod held', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), true, true);
      drag.hold();

      expect(drag.move(at(25, 150))).toBe(true);
      expect(drag.release()).toBeNull();

      expect(selected()).toEqual([1, 3]);
    });

    it('held, then let go without dragging, only clears the Selection', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 150), true, false);
      drag.hold();
      drag.move(at(15.2, 151));

      expect(drag.release()).toBeNull();

      expect(selected()).toEqual([]);
      expect(drag.box).toBeNull();
    });

    it('held and dragged, then given up for a second finger, puts the Selection back', () => {
      const { drag, selection, selected } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), true, false);
      drag.hold();
      drag.move(at(25, 150));

      drag.cancel();

      expect(selected()).toEqual([4]);
      expect(drag.box).toBeNull();
      expect(drag.pressed).toBe(false);
    });

    it('held after a mouse, draws nothing: only a finger is held', () => {
      const { drag } = timelineBox();
      drag.press(at(15, 50), false, false);

      expect(drag.hold()).toBe(false);

      expect(drag.box).toBeNull();
      expect(drag.pressed).toBe(true);
    });
  });

  describe('while the Timeline is frozen', () => {
    it('leaves the Selection as it is while a box is drawn', () => {
      const { drag, selection, selected, freeze } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      freeze('recording');
      drag.press(at(15, 50), false, false);

      drag.move(at(25, 150));
      drag.release();

      expect(selected()).toEqual([4]);
    });

    it('asks for no playhead or Track on a click, and leaves the Selection', () => {
      const { drag, selection, selected, freeze } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      freeze('merging');
      drag.press(at(15, 150), false, false);

      expect(drag.release()).toBeNull();

      expect(selected()).toEqual([4]);
    });

    it("draws no box for a finger's long press, giving the press up", () => {
      const { drag, selection, selected, freeze } = timelineBox();
      selection.apply({ kind: 'click', clipId: 4 });
      drag.press(at(15, 50), true, false);
      freeze('recording');

      expect(drag.hold()).toBe(false);

      expect(drag.box).toBeNull();
      expect(drag.pressed).toBe(false);
      expect(selected()).toEqual([4]);
    });
  });
});
