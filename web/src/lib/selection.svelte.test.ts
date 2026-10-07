import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Freeze } from './freeze';
import { afterGesture, noClips, Selection, type ClipIds, type SelectionGesture } from './selection.svelte';

/** A Timeline's Tracks, each holding Clips with these ids, wherever they are. */
const tracks = (...lanes: number[][]) =>
  lanes.map((ids) => ({ clips: ids.map((id) => ({ id, start: 10 * id, length: 5 })) }));

const selected = (...ids: number[]): ClipIds => new Set(ids);

const timeline = tracks([1, 2], [3], [4, 5]);

/** A Timeline's Tracks, each holding Clips placed at these spans, as [id, start, end]. */
const placed = (...lanes: [id: number, start: number, end: number][][]) =>
  lanes.map((clips) => ({ clips: clips.map(([id, start, end]) => ({ id, start, length: end - start })) }));

// Three Tracks: a Beat, a vocal Take in two Clips, and an adlib.
const song = placed(
  [[1, 0, 60]],
  [
    [2, 10, 20],
    [3, 30, 40],
  ],
  [[4, 25, 28]],
);

describe('afterGesture, the Selection after a gesture', () => {
  it('starts with no Clip selected', () => {
    expect([...noClips]).toEqual([]);
  });

  describe('a plain click', () => {
    it('selects the Clip clicked', () => {
      expect([...afterGesture(timeline, noClips, { kind: 'click', clipId: 3 })]).toEqual([3]);
    });

    it('selects it alone, whatever was selected', () => {
      expect([...afterGesture(timeline, selected(1, 4), { kind: 'click', clipId: 3 })]).toEqual([3]);
    });

    it('leaves it alone selected when it already was, with others', () => {
      expect([...afterGesture(timeline, selected(1, 3, 4), { kind: 'click', clipId: 3 })]).toEqual([3]);
    });
  });

  describe('a Mod+click', () => {
    it('adds a Clip that is not selected', () => {
      expect(afterGesture(timeline, selected(1), { kind: 'toggle', clipId: 4 })).toEqual(selected(1, 4));
    });

    it('takes out a Clip that is selected', () => {
      expect(afterGesture(timeline, selected(1, 4), { kind: 'toggle', clipId: 4 })).toEqual(selected(1));
    });

    it('can gather Clips from several Tracks', () => {
      let s = noClips;
      for (const clipId of [2, 3, 5]) s = afterGesture(timeline, s, { kind: 'toggle', clipId });
      expect(s).toEqual(selected(2, 3, 5));
    });

    it('can take out the last one selected', () => {
      expect(afterGesture(timeline, selected(4), { kind: 'toggle', clipId: 4 })).toEqual(noClips);
    });
  });

  describe('a press on a Clip that becomes a drag', () => {
    it('keeps the Selection when the Clip is in it, so the whole Selection moves', () => {
      const s = selected(1, 3, 4);
      expect(afterGesture(timeline, s, { kind: 'drag', clipId: 3 })).toBe(s);
    });

    it('selects the Clip alone when it is not in the Selection', () => {
      expect(afterGesture(timeline, selected(1, 4), { kind: 'drag', clipId: 3 })).toEqual(selected(3));
    });

    it('selects the Clip when none is selected', () => {
      expect(afterGesture(timeline, noClips, { kind: 'drag', clipId: 5 })).toEqual(selected(5));
    });

    it('still drops Clips that are gone while keeping the rest', () => {
      expect(afterGesture(tracks([1], [4]), selected(1, 2, 4), { kind: 'drag', clipId: 4 })).toEqual(selected(1, 4));
    });
  });

  it('clears it', () => {
    expect(afterGesture(timeline, selected(1, 3, 5), { kind: 'clear' })).toEqual(noClips);
  });

  describe('a click on empty lane space', () => {
    it('clears it', () => {
      expect(afterGesture(timeline, selected(1, 3), { kind: 'emptyClick', adds: false })).toEqual(noClips);
    });

    it('with Mod, leaves it as it is, being likely the start of a box to add', () => {
      const s = selected(1, 3);
      expect(afterGesture(timeline, s, { kind: 'emptyClick', adds: true })).toBe(s);
    });

    it('with Mod, still drops Clips no longer on the Timeline', () => {
      expect(afterGesture(tracks([1], [4]), selected(1, 2, 4), { kind: 'emptyClick', adds: true })).toEqual(
        selected(1, 4),
      );
    });
  });

  describe('a box', () => {
    it('selects every Clip it touches on a Track it spans, even partly', () => {
      expect(afterGesture(song, noClips, { kind: 'box', start: 15, end: 35, tracks: [1, 1], adds: false })).toEqual(
        selected(2, 3),
      );
    });

    it('selects a long Clip running past it on both sides', () => {
      expect(afterGesture(song, noClips, { kind: 'box', start: 15, end: 35, tracks: [0, 1], adds: false })).toEqual(
        selected(1, 2, 3),
      );
    });

    it('leaves Clips on Tracks it does not span, and Clips it does not reach in time', () => {
      expect(afterGesture(song, noClips, { kind: 'box', start: 21, end: 29, tracks: [1, 2], adds: false })).toEqual(
        selected(4),
      );
    });

    it("doesn't touch a Clip it only meets edge to edge", () => {
      expect(afterGesture(song, noClips, { kind: 'box', start: 20, end: 25, tracks: [1, 2], adds: false })).toEqual(
        noClips,
      );
    });

    it('takes its Tracks and times in either order, as drawn from any corner', () => {
      expect(afterGesture(song, noClips, { kind: 'box', start: 35, end: 26, tracks: [2, 1], adds: false })).toEqual(
        selected(3, 4),
      );
    });

    it('replaces the Selection', () => {
      expect(
        afterGesture(song, selected(1, 4), { kind: 'box', start: 15, end: 16, tracks: [1, 1], adds: false }),
      ).toEqual(selected(2));
    });

    it('selects none when it touches none', () => {
      expect(afterGesture(song, selected(1), { kind: 'box', start: 21, end: 24, tracks: [1, 1], adds: false })).toEqual(
        noClips,
      );
    });

    it('with Mod, adds the Clips it touches to the Selection', () => {
      expect(
        afterGesture(song, selected(1, 2), { kind: 'box', start: 26, end: 35, tracks: [1, 2], adds: true }),
      ).toEqual(selected(1, 2, 3, 4));
    });
  });

  it('selects every Clip, on every Track', () => {
    expect(afterGesture(song, selected(2), { kind: 'all' })).toEqual(selected(1, 2, 3, 4));
  });

  it("ignores a click on a Clip that isn't there, still dropping those gone", () => {
    expect(afterGesture(tracks([1], [4]), selected(1, 2), { kind: 'click', clipId: 7 })).toEqual(selected(1));
    expect(afterGesture(tracks([1], [4]), selected(1, 2), { kind: 'toggle', clipId: 7 })).toEqual(selected(1));
  });
});

type Lanes = ReturnType<typeof tracks>;

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

/**
 * A Timeline's Selection, as the Timeline makes it, over Tracks and a
 * freeze that change as a save, an undo, a recording or a Merge would.
 */
function timelineSelection(lanes: Lanes = timeline) {
  const state = $state<{ tracks: Lanes; freeze: Freeze }>({ tracks: lanes, freeze: null });
  let made!: Selection;
  cleanups.push(
    $effect.root(() => {
      made = new Selection(
        () => state.tracks,
        () => state.freeze,
      );
    }),
  );
  return {
    selection: made,
    /** The Timeline's Tracks becoming these, e.g. by a save, an undo or another tab. */
    async retrack(lanes: Lanes) {
      state.tracks = lanes;
      await tick();
    },
    freeze(freeze: Freeze) {
      state.freeze = freeze;
    },
  };
}

/** The selected Clips' ids, in order. */
const ids = (selection: Selection) => [...selection.ids].sort((a, b) => a - b);

describe('Selection', () => {
  it('starts with no Clip selected, and changes by a gesture', () => {
    const { selection } = timelineSelection();
    expect(ids(selection)).toEqual([]);

    selection.apply({ kind: 'toggle', clipId: 2 });
    selection.apply({ kind: 'toggle', clipId: 4 });

    expect(ids(selection)).toEqual([2, 4]);
    expect(selection.size).toBe(2);
    expect(selection.has(4)).toBe(true);
    expect(selection.has(3)).toBe(false);
  });

  describe('while frozen', () => {
    const gestures: SelectionGesture[] = [
      { kind: 'click', clipId: 2 },
      { kind: 'toggle', clipId: 2 },
      { kind: 'toggle', clipId: 1 },
      { kind: 'drag', clipId: 2 },
      { kind: 'box', start: 0, end: 100, tracks: [0, 2], adds: false },
      { kind: 'box', start: 0, end: 100, tracks: [0, 2], adds: true },
      { kind: 'all' },
      { kind: 'emptyClick', adds: false },
      { kind: 'clear' },
    ];

    for (const freeze of ['recording', 'merging'] as const) {
      it(`is left as it is by every gesture while ${freeze}`, () => {
        const { selection, freeze: frozen } = timelineSelection();
        selection.apply({ kind: 'toggle', clipId: 1 });
        selection.apply({ kind: 'toggle', clipId: 4 });
        frozen(freeze);

        for (const gesture of gestures) selection.apply(gesture);

        expect(ids(selection)).toEqual([1, 4]);
      });
    }
  });

  describe('as Clips leave the Timeline', () => {
    it('drops them, e.g. deleted in another tab or taken away by undo', async () => {
      const { selection, retrack } = timelineSelection();
      selection.apply({ kind: 'all' });

      await retrack(tracks([1], [4]));

      expect(ids(selection)).toEqual([1, 4]);
    });

    it('drops every Clip when the Timeline has none, e.g. on another Song', async () => {
      const { selection, retrack } = timelineSelection();
      selection.apply({ kind: 'all' });

      await retrack(tracks([]));

      expect(ids(selection)).toEqual([]);
    });

    it("doesn't add a Clip that's new, e.g. a new Take's", async () => {
      const { selection, retrack } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 1 });

      await retrack(tracks([1, 2], [3, 9]));

      expect(ids(selection)).toEqual([1]);
    });

    it('keeps the same ids when none are gone, so nothing needs redrawing', async () => {
      const { selection, retrack } = timelineSelection();
      selection.apply({ kind: 'all' });
      const before = selection.ids;

      await retrack(tracks([1, 2, 6], [3], [4, 5]));

      expect(selection.ids).toBe(before);
    });

    for (const freeze of ['recording', 'merging'] as const) {
      it(`drops them while ${freeze} too`, async () => {
        const { selection, retrack, freeze: frozen } = timelineSelection();
        selection.apply({ kind: 'all' });
        frozen(freeze);

        await retrack(tracks([1], [4]));

        expect(ids(selection)).toEqual([1, 4]);
      });
    }
  });

  describe('after an edit, e.g. a paste, a Duplicate, a Split, a Merge, an undo or a redo', () => {
    it('becomes the Clips it gives, whatever was selected', () => {
      const { selection } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 1 });

      selection.selectEdited([4, 5]);

      expect(ids(selection)).toEqual([4, 5]);
    });

    it('is left as it is while recording, a recording having started since the edit', () => {
      const { selection, freeze } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 1 });
      freeze('recording');

      selection.selectEdited([4, 5]);

      expect(ids(selection)).toEqual([1]);
    });

    it('still becomes them while merging, so a Merge selects its merged Clip', () => {
      const { selection, freeze } = timelineSelection();
      selection.apply({ kind: 'all' });
      freeze('merging');

      selection.selectEdited([3]);

      expect(ids(selection)).toEqual([3]);
    });
  });

  describe('a box', () => {
    // A box over Tracks 0 to 2, from 0:00 to `end`, as it's drawn.
    const to = (end: number) => ({ start: 0, end, tracks: [0, 2] as const });

    it('selects the Clips it touches as it grows and shrinks, from the Selection as it was pressed', () => {
      const { selection } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 5 });
      const box = selection.startBox(false);

      box.draw(to(25));
      expect(ids(selection)).toEqual([1, 2]);
      box.draw(to(45));
      expect(ids(selection)).toEqual([1, 2, 3, 4]);
      box.draw(to(15));
      expect(ids(selection)).toEqual([1]);
    });

    it('with Mod, adds them to the Selection as it was pressed', () => {
      const { selection } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 5 });
      const box = selection.startBox(true);

      box.draw(to(45));
      box.draw(to(25));

      expect(ids(selection)).toEqual([1, 2, 5]);
    });

    it('given up, e.g. by a second finger, restores the Selection as it was before it', () => {
      const { selection } = timelineSelection();
      for (const clipId of [3, 5]) selection.apply({ kind: 'toggle', clipId });
      const box = selection.startBox(false);
      box.draw(to(25));

      box.restore();

      expect(ids(selection)).toEqual([3, 5]);
    });

    it('given up, restores it without the Clips gone from the Timeline since', async () => {
      const { selection, retrack } = timelineSelection();
      for (const clipId of [3, 5]) selection.apply({ kind: 'toggle', clipId });
      const box = selection.startBox(false);
      box.draw(to(25));
      await retrack(tracks([1, 2], [], [4, 5]));

      box.restore();

      expect(ids(selection)).toEqual([5]);
    });

    for (const freeze of ['recording', 'merging'] as const) {
      it(`drawn while ${freeze}, leaves the Selection as it is`, () => {
        const { selection, freeze: frozen } = timelineSelection();
        for (const clipId of [3, 5]) selection.apply({ kind: 'toggle', clipId });
        frozen(freeze);
        const box = selection.startBox(false);

        box.draw(to(25));
        box.draw(to(45));

        expect(ids(selection)).toEqual([3, 5]);
      });
    }
  });

  describe("opening a Clip's menu", () => {
    it('opens the Selection menu on a Clip in a Selection of several, leaving it be', () => {
      const { selection } = timelineSelection();
      for (const clipId of [1, 3, 4]) selection.apply({ kind: 'toggle', clipId });

      expect(selection.menuFor(3)).toBe('selection');
      expect(selection.openMenu(3)).toBe('selection');
      expect(ids(selection)).toEqual([1, 3, 4]);
    });

    it("makes a Clip outside the Selection the Selection, and opens the Clip's own menu", () => {
      const { selection } = timelineSelection();
      for (const clipId of [1, 4]) selection.apply({ kind: 'toggle', clipId });

      expect(selection.menuFor(3)).toBe('clip');
      expect(ids(selection)).toEqual([1, 4]);
      expect(selection.openMenu(3)).toBe('clip');
      expect(ids(selection)).toEqual([3]);
    });

    it("opens the Clip's own menu with none selected, selecting it", () => {
      const { selection } = timelineSelection();

      expect(selection.openMenu(3)).toBe('clip');
      expect(ids(selection)).toEqual([3]);
    });

    it("opens the Clip's own menu on the only selected Clip", () => {
      const { selection } = timelineSelection();
      selection.apply({ kind: 'click', clipId: 3 });

      expect(selection.openMenu(3)).toBe('clip');
      expect(ids(selection)).toEqual([3]);
    });

    it("opens the Clip's own menu when the others selected are gone, e.g. deleted in another tab", async () => {
      const { selection, retrack } = timelineSelection();
      for (const clipId of [1, 2]) selection.apply({ kind: 'toggle', clipId });

      await retrack(tracks([1], [4]));

      expect(selection.openMenu(1)).toBe('clip');
      expect(ids(selection)).toEqual([1]);
    });

    for (const freeze of ['recording', 'merging'] as const) {
      describe(`while ${freeze}`, () => {
        it("leaves the Selection be on a Clip outside it, opening the Clip's own menu", () => {
          const { selection, freeze: frozen } = timelineSelection();
          for (const clipId of [1, 4]) selection.apply({ kind: 'toggle', clipId });
          frozen(freeze);

          expect(selection.menuFor(3)).toBe('clip');
          expect(selection.openMenu(3)).toBe('clip');
          expect(ids(selection)).toEqual([1, 4]);
        });

        it('still opens the Selection menu on a Clip in it, when several are selected', () => {
          const { selection, freeze: frozen } = timelineSelection();
          for (const clipId of [1, 4]) selection.apply({ kind: 'toggle', clipId });
          frozen(freeze);

          expect(selection.openMenu(4)).toBe('selection');
          expect(ids(selection)).toEqual([1, 4]);
        });
      });
    }
  });
});
