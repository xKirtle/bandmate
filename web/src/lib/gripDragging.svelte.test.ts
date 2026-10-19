import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { GripDragging, nearestRow, type At, type Span } from './gripDragging.svelte';

/**
 * A drag of a row by its place among the rows, as the Timeline, the Lyric
 * Sheet and the Songs page each do with a rule of their own: it aims at the
 * row the pointer is over, and dropping there moves the row dragged to it.
 */
class RowDragging extends GripDragging<number, number, { from: number; to: number }> {
  protected targetAt(_dragged: number, at: At, rows: readonly (Span | null)[]): number | null {
    const over = rows.findIndex((row) => row !== null && at.y >= row.top && at.y <= row.bottom);
    return over === -1 ? null : over;
  }

  protected dropFor(dragged: number, target: number | null): { from: number; to: number } | null {
    return target === null || target === dragged ? null : { from: dragged, to: target };
  }
}

/** How tall each row is in the tests, in pixels. */
const rowHeight = 100;

/**
 * A row's element, the `index`th down a page of rows 100 px tall, or `at`
 * pixels down it for one moved since.
 */
function rowElement(index: number, at = index * rowHeight): HTMLElement {
  return {
    getBoundingClientRect: () => ({ top: at, bottom: at + rowHeight }),
  } as unknown as HTMLElement;
}

/** A pointer going down on a grip, or moving, at `y` down the page. */
function pointerAt(y: number, button = 0) {
  return {
    button,
    pointerId: 7,
    clientX: 0,
    clientY: y,
    preventDefault: vi.fn(),
    currentTarget: { setPointerCapture: vi.fn() },
  } as unknown as PointerEvent & { currentTarget: HTMLElement; preventDefault: ReturnType<typeof vi.fn> };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * A drag of three rows, inside an effect root, with the rows on the page and
 * draggable unless the test says otherwise.
 */
function rowDragging({ placed = [0, 1, 2] }: { placed?: number[] } = {}) {
  const page = $state({ on: true, order: 'a b c' });
  let drag!: RowDragging;
  disposers.push(
    $effect.root(() => {
      drag = new RowDragging({ enabled: () => page.on, order: () => page.order });
    }),
  );
  for (const index of placed) drag.placeRow(rowElement(index), index);
  flushSync();
  // The drops made, in order, as a Track's or a Section's move would be saved.
  const dropped: { from: number; to: number }[] = [];
  return {
    drag,
    page,
    dropped,
    /** Takes the grip of the row at `index` with the pointer `y` pixels down the page. */
    take(index: number, y: number) {
      const down = pointerAt(y);
      drag.grip(index, (drop) => dropped.push(drop)).onpointerdown(down);
      flushSync();
      return down;
    },
    /** Moves the pointer to `y` pixels down the page. */
    move(index: number, y: number) {
      drag.grip(index, (drop) => dropped.push(drop)).onpointermove(pointerAt(y));
      flushSync();
    },
    /** Lets the pointer go. */
    lift(index: number) {
      drag.grip(index, (drop) => dropped.push(drop)).onpointerup();
      flushSync();
    },
    /** The pointer cancelled, e.g. by the browser taking it over. */
    cancelled(index: number) {
      drag.grip(index, (drop) => dropped.push(drop)).onpointercancel();
      flushSync();
    },
  };
}

describe('a drag by a grip', () => {
  it('takes the grip, captures the pointer, and aims nowhere until it moves off the row', () => {
    const { drag, take } = rowDragging();

    const down = take(0, 50);

    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(7);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(drag.current).toEqual({ dragged: 0, target: 0, x: 0, y: 50 });
    expect(drag.drop).toBe(null);
  });

  it('leaves a press of another button to the browser', () => {
    const { drag } = rowDragging();

    drag.grip(0, () => {}).onpointerdown(pointerAt(50, 2));
    flushSync();

    expect(drag.current).toBe(null);
  });

  it('ends on the row the pointer is over, dropping what the rule says', () => {
    const { drag, take, move, lift, dropped } = rowDragging();
    take(0, 50);

    move(0, 250);
    expect(drag.drop).toEqual({ from: 0, to: 2 });
    lift(0);

    expect(dropped).toEqual([{ from: 0, to: 2 }]);
    expect(drag.current).toBe(null);
  });

  it('ends off every row without dropping anything', () => {
    const { drag, take, move, lift, dropped } = rowDragging();
    take(0, 50);

    move(0, 900);
    expect(drag.drop).toBe(null);
    lift(0);

    expect(dropped).toEqual([]);
    expect(drag.current).toBe(null);
  });

  it('aims again where the pointer last was, as the rows scroll under it', () => {
    const { drag, take, move } = rowDragging({ placed: [] });
    drag.placeRow(rowElement(0), 0);
    take(0, 150);
    // The pointer is over nothing: the only row is at the page's top.
    expect(drag.current?.target).toBe(null);

    // Scrolled down, the row is now under the pointer where it was.
    drag.placeRow(rowElement(0, 100), 0);
    drag.aim();
    flushSync();

    expect(drag.current?.target).toBe(0);
    move(0, 150);
    expect(drag.current?.target).toBe(0);
  });

  it('gives the drag up once what it drags can no longer be dragged', () => {
    const { drag, page, take, lift, dropped } = rowDragging();
    take(0, 250);
    expect(drag.drop).toEqual({ from: 0, to: 2 });

    page.on = false;
    flushSync();

    expect(drag.current).toBe(null);
    lift(0);
    expect(dropped).toEqual([]);
  });

  it('gives the drag up once the rows are reordered under it, e.g. by an undo', () => {
    const { drag, page, take, lift, dropped } = rowDragging();
    take(0, 250);

    page.order = 'c b a';
    flushSync();

    expect(drag.current).toBe(null);
    lift(0);
    expect(dropped).toEqual([]);
  });

  it('gives the drag up once the pointer is cancelled', () => {
    const { drag, take, move, cancelled, dropped } = rowDragging();
    take(0, 50);
    move(0, 250);

    cancelled(0);

    expect(drag.current).toBe(null);
    expect(dropped).toEqual([]);
  });

  it('aims nowhere at a row that is not on the page, and still at those that are', () => {
    const { drag, take, move } = rowDragging({ placed: [0, 2] });
    take(0, 50);

    move(0, 150);
    expect(drag.current?.target).toBe(null);

    move(0, 250);
    expect(drag.current?.target).toBe(2);
  });

  it('measures a row whose element is replaced mid-drag, not the one it replaced', () => {
    const { drag, take, move } = rowDragging({ placed: [0] });
    const taken = drag.placeRow(rowElement(1), 1);
    take(0, 50);

    // The row is drawn anew lower down the page, and only then is the
    // element it replaced taken off.
    drag.placeRow(rowElement(1, 400), 1);
    taken();

    move(0, 150);
    expect(drag.current?.target).toBe(null);
    move(0, 450);
    expect(drag.current?.target).toBe(1);
  });

  it('forgets a row once its element goes', () => {
    const { drag, take, move } = rowDragging({ placed: [0] });
    const taken = drag.placeRow(rowElement(1), 1);
    take(0, 50);
    move(0, 150);
    expect(drag.current?.target).toBe(1);

    taken();

    move(0, 150);
    expect(drag.current?.target).toBe(null);
  });
});

describe('the row nearest a height on the page', () => {
  // Three rows 100 px tall down the page, the middle one off it.
  const rows: (Span | null)[] = [{ top: 0, bottom: 100 }, null, { top: 200, bottom: 300 }];

  it('is the row the height is within', () => {
    expect(nearestRow(250, rows)).toBe(2);
  });

  it('is the first row above the first one', () => {
    expect(nearestRow(-40, rows)).toBe(0);
  });

  it('is the last row below the last one', () => {
    expect(nearestRow(500, rows)).toBe(2);
  });

  it('is whichever is nearer between two, skipping a row that is not on the page', () => {
    expect(nearestRow(120, rows)).toBe(0);
    expect(nearestRow(190, rows)).toBe(2);
  });

  it('is the first of two equally near', () => {
    expect(nearestRow(150, rows)).toBe(0);
  });

  it('is none with no row on the page', () => {
    expect(nearestRow(150, [null, null])).toBe(null);
  });
});
