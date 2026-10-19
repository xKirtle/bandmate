import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, tick } from 'svelte';
import { timeAt } from './timelineView';
import { TimelineViewing, type Lanes } from './timelineViewing.svelte';

/**
 * The lanes as the browser's are: scrolled no further than their content,
 * which is the Timeline at the scale shown, and telling the view each time
 * they're scrolled, as their scroll event does.
 */
class FakeLanes implements Lanes {
  #scrollLeft = 0;
  /** The view the lanes belong to, set once it's made. */
  viewing!: TimelineViewing;
  /** Where the lanes' window starts on the page, in pixels. */
  left = 0;
  /** How far the lanes are down the page, in pixels. */
  top = 0;

  get scrollLeft(): number {
    return this.#scrollLeft;
  }

  set scrollLeft(to: number) {
    const { span, scale, width } = this.viewing.view;
    this.#scrollLeft = Math.min(Math.max(0, to), Math.max(0, span * scale - width));
    this.viewing.scrolled();
  }

  /** Loses where the lanes were scrolled to, as hiding them does, which tells the view nothing. */
  lose() {
    this.#scrollLeft = 0;
  }

  getBoundingClientRect() {
    return { left: this.left, top: this.top };
  }
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/**
 * The Timeline's view as the Timeline makes it, inside an effect root, on
 * fake lanes: a 100 second Timeline in an 800 pixel window, so fitted it's
 * 8 pixels a second, with what its hook heard.
 */
function viewingFor() {
  const state = $state({ span: 100 });
  const lanes = new FakeLanes();
  /** Each scroll away from where the view put it, and whether a drag at the edges did it. */
  const heard: { handScrolls: boolean[] } = { handScrolls: [] };
  let viewing!: TimelineViewing;
  disposers.push(
    $effect.root(() => {
      viewing = new TimelineViewing({
        span: () => state.span,
        lanes: () => lanes,
        onHandScroll: (dragging) => heard.handScrolls.push(dragging),
      });
      lanes.viewing = viewing;
      viewing.width = 800;
    }),
  );
  flushSync();
  return { viewing, lanes, state, heard };
}

/** Two fingers that far apart, around a point on the page. */
function fingers(middle: number, apart: number) {
  return [
    { clientX: middle - apart / 2, clientY: 0 },
    { clientX: middle + apart / 2, clientY: 0 },
  ] as const;
}

/** Zooms to twice the fitted scale around the left edge: 16 pixels a second, with as far again to scroll. */
async function zoomedIn(viewing: TimelineViewing) {
  viewing.zoomAt(2, 0);
  flushSync();
  await tick();
}

describe('the Timeline view shown', () => {
  it('fits the whole Timeline in the window until it is zoomed in', () => {
    const { viewing } = viewingFor();
    expect(viewing.view.scale).toBe(8);
    expect(viewing.view.scroll).toBe(0);
    expect(viewing.thumb).toBeNull();
  });

  it('scrolls the lanes to where a new view has it', async () => {
    const { viewing, lanes } = viewingFor();
    viewing.zoomAt(2, 400);
    flushSync();
    // The lanes are only scrolled once they are as wide as the new scale.
    expect(lanes.scrollLeft).toBe(0);
    await tick();
    expect(viewing.view.scale).toBe(16);
    expect(viewing.view.scroll).toBe(400);
    expect(lanes.scrollLeft).toBe(400);
  });
});

describe('the Timeline view scrolled', () => {
  it('reports a scroll by hand', async () => {
    const { viewing, lanes, heard } = viewingFor();
    await zoomedIn(viewing);
    lanes.scrollLeft = 200;
    expect(viewing.view.scroll).toBe(200);
    expect(heard.handScrolls).toEqual([false]);
  });

  it('reports no scroll it made itself', async () => {
    const { viewing, lanes, heard } = viewingFor();
    await zoomedIn(viewing);
    viewing.reveal(60);
    flushSync();
    await tick();
    expect(lanes.scrollLeft).toBeGreaterThan(0);
    expect(heard.handScrolls).toEqual([]);
  });

  it('reports no scroll of less than a pixel, which is the lanes rounding', async () => {
    const { viewing, lanes, heard } = viewingFor();
    await zoomedIn(viewing);
    lanes.scrollLeft = 200;
    lanes.scrollLeft = 200.4;
    expect(heard.handScrolls).toEqual([false]);
  });
});

describe('the Timeline view refitted', () => {
  it('fits the whole Timeline again once a wider window fits it', async () => {
    const { viewing } = viewingFor();
    await zoomedIn(viewing);
    expect(viewing.view.scale).toBe(16);
    viewing.width = 3200;
    flushSync();
    // Fitted at 32 pixels a second, rather than left zoomed in at 16.
    expect(viewing.view.scale).toBe(32);
    expect(viewing.view.scroll).toBe(0);
  });

  it('stays fitted as the Timeline grows', () => {
    const { viewing, state } = viewingFor();
    state.span = 200;
    flushSync();
    expect(viewing.view.scale).toBe(4);
  });

  it('scrolls the lanes back to the view once the Timeline is shown again', async () => {
    const { viewing, lanes } = viewingFor();
    await zoomedIn(viewing);
    lanes.scrollLeft = 300;
    expect(viewing.view.scroll).toBe(300);
    // Hidden, the lanes have no width and lose where they were scrolled to.
    viewing.width = 0;
    flushSync();
    lanes.lose();
    viewing.width = 800;
    flushSync();
    await tick();
    expect(viewing.view.scale).toBe(16);
    expect(lanes.scrollLeft).toBe(300);
  });
});

describe('revealing a time', () => {
  it('leaves the view where it is while the time is in it', async () => {
    const { viewing, lanes } = viewingFor();
    await zoomedIn(viewing);
    viewing.reveal(10);
    flushSync();
    await tick();
    expect(lanes.scrollLeft).toBe(0);
  });

  it('turns the page to put a time it has run past near the left', async () => {
    const { viewing, lanes } = viewingFor();
    await zoomedIn(viewing);
    // 50s is 800px in, past 90% of the 800px window: the page turns to put it 80px in.
    viewing.reveal(50);
    flushSync();
    await tick();
    expect(lanes.scrollLeft).toBe(720);
  });
});

describe('a point on the page', () => {
  it('is measured into the lanes, across them and down them', () => {
    const { viewing, lanes } = viewingFor();
    lanes.left = 40;
    lanes.top = 120;
    expect(viewing.xIn(100)).toBe(60);
    expect(viewing.yIn(200)).toBe(80);
  });
});

describe('zooming at a point', () => {
  it('keeps the time under the point where it is', async () => {
    const { viewing } = viewingFor();
    const was = timeAt(viewing.view, 600);
    expect(was).toBe(75);
    viewing.zoomAt(2, 600);
    flushSync();
    await tick();
    expect(viewing.view.scale).toBe(16);
    expect(timeAt(viewing.view, 600)).toBe(was);
  });
});

describe('pinching', () => {
  it('zooms around the fingers and pans along with them together', async () => {
    const { viewing } = viewingFor();
    viewing.pinchStart(...fingers(400, 200));
    expect(viewing.pinching).toBe(true);
    // Twice as far apart, their middle 50px to the right.
    viewing.pinchMove(...fingers(450, 400));
    flushSync();
    await tick();
    expect(viewing.view.scale).toBe(16);
    // Zoomed 2x around 450px leaves 56.25s there, at a scroll of 450;
    // the 50px the fingers moved pans it back.
    expect(viewing.view.scroll).toBe(400);
  });

  it('does nothing once the fingers have gone', async () => {
    const { viewing } = viewingFor();
    viewing.pinchStart(...fingers(400, 200));
    viewing.pinchEnd();
    expect(viewing.pinching).toBe(false);
    viewing.pinchMove(...fingers(400, 400));
    flushSync();
    await tick();
    expect(viewing.view.scale).toBe(8);
  });
});

describe('the scroll bar thumb', () => {
  it('scrolls the view as it is dragged, and stops once it is let go', async () => {
    const { viewing, lanes, heard } = viewingFor();
    await zoomedIn(viewing);
    // Half the Timeline is in view, so the thumb is half the bar.
    expect(viewing.thumb).toEqual({ left: 0, width: 400 });
    viewing.thumbDown(1, 10);
    expect(viewing.thumbDragging).toBe(true);
    viewing.thumbMove(1, 110);
    // The thumb 100px along a 400px run of bar is a quarter of the 800px of scroll.
    expect(viewing.view.scroll).toBe(200);
    expect(heard.handScrolls).toEqual([false]);
    viewing.thumbUp();
    expect(viewing.thumbDragging).toBe(false);
    viewing.thumbMove(1, 210);
    expect(lanes.scrollLeft).toBe(200);
  });

  it('ignores another pointer while one drags it', async () => {
    const { viewing } = viewingFor();
    await zoomedIn(viewing);
    viewing.thumbDown(1, 10);
    viewing.thumbMove(2, 410);
    expect(viewing.view.scroll).toBe(0);
  });

  it('gives the drag up once the bar goes', async () => {
    const { viewing } = viewingFor();
    await zoomedIn(viewing);
    viewing.thumbDown(1, 10);
    // Zoomed back out, the whole Timeline fits and the bar goes with it.
    viewing.zoomAt(0.5, 0);
    flushSync();
    await tick();
    expect(viewing.thumb).toBeNull();
    expect(viewing.thumbDragging).toBe(false);
  });

  it('gives the drag up once a pinch starts', async () => {
    const { viewing } = viewingFor();
    await zoomedIn(viewing);
    viewing.thumbDown(1, 10);
    viewing.pinchStart(...fingers(400, 200));
    expect(viewing.thumbDragging).toBe(false);
    viewing.thumbMove(1, 110);
    expect(viewing.view.scroll).toBe(0);
  });

  it('centres the thumb where the bar is clicked beside it', async () => {
    const { viewing, heard } = viewingFor();
    await zoomedIn(viewing);
    // Clicked at 600px, the 400px thumb starts 400px along: the end of the Timeline.
    viewing.barDown(600);
    expect(viewing.view.scroll).toBe(800);
    expect(heard.handScrolls).toEqual([false]);
  });
});
