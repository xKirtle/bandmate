import { describe, expect, it } from 'vitest';
import { menuFor, noSelection, selection, type Selection } from './selection';

/** A Timeline's Tracks, each holding Clips with these ids, wherever they are. */
const tracks = (...lanes: number[][]) =>
  lanes.map((ids) => ({ clips: ids.map((id) => ({ id, start: 10 * id, length: 5 })) }));

const selected = (...ids: number[]): Selection => new Set(ids);

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

describe('selection', () => {
  it('starts with no Clip selected', () => {
    expect([...noSelection]).toEqual([]);
  });

  describe('a plain click', () => {
    it('selects the Clip clicked', () => {
      expect([...selection(timeline, noSelection, { kind: 'click', clipId: 3 })]).toEqual([3]);
    });

    it('selects it alone, whatever was selected', () => {
      expect([...selection(timeline, selected(1, 4), { kind: 'click', clipId: 3 })]).toEqual([3]);
    });

    it('leaves it alone selected when it already was, with others', () => {
      expect([...selection(timeline, selected(1, 3, 4), { kind: 'click', clipId: 3 })]).toEqual([3]);
    });
  });

  describe('a Mod+click', () => {
    it('adds a Clip that is not selected', () => {
      expect(selection(timeline, selected(1), { kind: 'toggle', clipId: 4 })).toEqual(selected(1, 4));
    });

    it('takes out a Clip that is selected', () => {
      expect(selection(timeline, selected(1, 4), { kind: 'toggle', clipId: 4 })).toEqual(selected(1));
    });

    it('can gather Clips from several Tracks', () => {
      let s = noSelection;
      for (const clipId of [2, 3, 5]) s = selection(timeline, s, { kind: 'toggle', clipId });
      expect(s).toEqual(selected(2, 3, 5));
    });

    it('can take out the last one selected', () => {
      expect(selection(timeline, selected(4), { kind: 'toggle', clipId: 4 })).toEqual(noSelection);
    });
  });

  describe('a press on a Clip that becomes a drag', () => {
    it('keeps the Selection when the Clip is in it, so the whole Selection moves', () => {
      const s = selected(1, 3, 4);
      expect(selection(timeline, s, { kind: 'drag', clipId: 3 })).toBe(s);
    });

    it('selects the Clip alone when it is not in the Selection', () => {
      expect(selection(timeline, selected(1, 4), { kind: 'drag', clipId: 3 })).toEqual(selected(3));
    });

    it('selects the Clip when none is selected', () => {
      expect(selection(timeline, noSelection, { kind: 'drag', clipId: 5 })).toEqual(selected(5));
    });

    it('still drops Clips that are gone while keeping the rest', () => {
      expect(selection(tracks([1], [4]), selected(1, 2, 4), { kind: 'drag', clipId: 4 })).toEqual(selected(1, 4));
    });
  });

  it('clears it', () => {
    expect(selection(timeline, selected(1, 3, 5), { kind: 'clear' })).toEqual(noSelection);
  });

  describe('a click on empty lane space', () => {
    it('clears it', () => {
      expect(selection(timeline, selected(1, 3), { kind: 'emptyClick', adds: false })).toEqual(noSelection);
    });

    it('with Mod, leaves it as it is, being likely the start of a box to add', () => {
      const s = selected(1, 3);
      expect(selection(timeline, s, { kind: 'emptyClick', adds: true })).toBe(s);
    });

    it('with Mod, still drops Clips no longer on the Timeline', () => {
      expect(selection(tracks([1], [4]), selected(1, 2, 4), { kind: 'emptyClick', adds: true })).toEqual(
        selected(1, 4),
      );
    });
  });

  describe('a box', () => {
    it('selects every Clip it touches on a Track it spans, even partly', () => {
      expect(selection(song, noSelection, { kind: 'box', start: 15, end: 35, tracks: [1, 1], adds: false })).toEqual(
        selected(2, 3),
      );
    });

    it('selects a long Clip running past it on both sides', () => {
      expect(selection(song, noSelection, { kind: 'box', start: 15, end: 35, tracks: [0, 1], adds: false })).toEqual(
        selected(1, 2, 3),
      );
    });

    it('leaves Clips on Tracks it does not span, and Clips it does not reach in time', () => {
      expect(selection(song, noSelection, { kind: 'box', start: 21, end: 29, tracks: [1, 2], adds: false })).toEqual(
        selected(4),
      );
    });

    it("doesn't touch a Clip it only meets edge to edge", () => {
      expect(selection(song, noSelection, { kind: 'box', start: 20, end: 25, tracks: [1, 2], adds: false })).toEqual(
        noSelection,
      );
    });

    it('takes its Tracks and times in either order, as drawn from any corner', () => {
      expect(selection(song, noSelection, { kind: 'box', start: 35, end: 26, tracks: [2, 1], adds: false })).toEqual(
        selected(3, 4),
      );
    });

    it('replaces the Selection', () => {
      expect(selection(song, selected(1, 4), { kind: 'box', start: 15, end: 16, tracks: [1, 1], adds: false })).toEqual(
        selected(2),
      );
    });

    it('selects none when it touches none', () => {
      expect(selection(song, selected(1), { kind: 'box', start: 21, end: 24, tracks: [1, 1], adds: false })).toEqual(
        noSelection,
      );
    });

    it('with Mod, adds the Clips it touches to the Selection', () => {
      expect(selection(song, selected(1, 2), { kind: 'box', start: 26, end: 35, tracks: [1, 2], adds: true })).toEqual(
        selected(1, 2, 3, 4),
      );
    });
  });

  it('selects every Clip, on every Track', () => {
    expect(selection(song, selected(2), { kind: 'all' })).toEqual(selected(1, 2, 3, 4));
  });

  describe('pruning', () => {
    it('drops Clips no longer on the Timeline, e.g. deleted in another tab or by undo', () => {
      expect(selection(tracks([1], [4]), selected(1, 2, 4))).toEqual(selected(1, 4));
    });

    it('drops every Clip when the Timeline has none, e.g. on another Song', () => {
      expect(selection(tracks([]), selected(1, 2))).toEqual(noSelection);
    });

    it("doesn't add a Clip that's new, e.g. a new Take's", () => {
      expect(selection(tracks([1, 2], [3, 9]), selected(1))).toEqual(selected(1));
    });

    it('keeps the same Selection when nothing is gone, so nothing needs redrawing', () => {
      const s = selected(1, 4);
      expect(selection(timeline, s)).toBe(s);
    });

    it("ignores a click on a Clip that isn't there, still dropping those gone", () => {
      expect(selection(tracks([1], [4]), selected(1, 2), { kind: 'click', clipId: 7 })).toEqual(selected(1));
      expect(selection(tracks([1], [4]), selected(1, 2), { kind: 'toggle', clipId: 7 })).toEqual(selected(1));
    });
  });
});

describe('menuFor', () => {
  it('opens the Selection menu on a Clip in a Selection of several, leaving the Selection be', () => {
    const s = selected(1, 3, 4);
    const choice = menuFor(timeline, s, 3);
    expect(choice.menu).toBe('selection');
    expect(choice.selected).toBe(s);
  });

  it('makes a Clip outside the Selection the Selection, and opens its own menu', () => {
    expect(menuFor(timeline, selected(1, 4), 3)).toEqual({ menu: 'clip', selected: selected(3) });
    expect(menuFor(timeline, noSelection, 3)).toEqual({ menu: 'clip', selected: selected(3) });
  });

  it('opens its own menu on the only selected Clip, leaving the Selection be', () => {
    const s = selected(3);
    expect(menuFor(timeline, s, 3)).toEqual({ menu: 'clip', selected: s });
  });

  it('opens its own menu when the others selected are gone, e.g. deleted in another tab', () => {
    expect(menuFor(tracks([1], [4]), selected(1, 2), 1)).toEqual({ menu: 'clip', selected: selected(1) });
  });
});
