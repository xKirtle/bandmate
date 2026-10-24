import { describe as group, expect, it } from 'vitest';
import { AutoScroll, autoScrollPace, startingLevel, type AutoScrollPage } from './autoScroll.svelte';
import { FakeFrames } from './transportFakes';

/** A page that scrolls as it's told, and as a reader scrolls it by hand, with the Lyric Sheet ending at `end`. */
class FakePage implements AutoScrollPage {
  top = 0;
  end = 1000;
  /** Whether a finger is on the page. */
  held = false;
  scrolledTo: number[] = [];
  heldByHand() {
    return this.held;
  }
  scrolled() {
    return this.top;
  }
  sheetEnd() {
    return this.end;
  }
  scrollTo(top: number) {
    this.scrolledTo.push(top);
    this.top = top;
  }
}

function setUp({ pace = 40, playing = false } = {}) {
  const page = new FakePage();
  const frames = new FakeFrames();
  const clock = { now: 0 };
  const timeline = { playing };
  const awake = { held: 0, released: 0 };
  const autoScroll = new AutoScroll({
    page,
    frames,
    now: () => clock.now,
    pace: () => pace,
    timelinePlaying: () => timeline.playing,
    keepAwake: () => {
      awake.held++;
      return () => awake.released++;
    },
  });
  /** Moves the clock on by `ms` and runs the frame then. */
  const frame = (ms: number) => {
    clock.now += ms;
    frames.step();
  };
  /** Runs `ms` of frames, 50 ms apart. */
  const after = (ms: number) => {
    for (let t = 0; t < ms; t += 50) frame(50);
  };
  return { page, frames, autoScroll, frame, after, timeline, awake };
}

group('AutoScroll', () => {
  it('scrolls the page down at its pace from where it is', () => {
    const { page, autoScroll, after } = setUp({ pace: 40 });
    page.top = 100;
    autoScroll.start();
    expect(autoScroll.running).toBe(true);

    after(500);
    expect(page.top).toBe(120);
    after(250);
    expect(page.top).toBe(130);
  });

  it('pauses where it is, and starts again from there', () => {
    const { page, autoScroll, after } = setUp({ pace: 40 });
    autoScroll.toggle();
    after(500);
    autoScroll.toggle();
    expect(autoScroll.running).toBe(false);

    after(500);
    expect(page.top).toBe(20);
    autoScroll.toggle();
    after(500);
    expect(page.top).toBe(40);
  });

  it('stops at the end of the Lyric Sheet', () => {
    const { page, frames, autoScroll, after } = setUp({ pace: 40 });
    page.top = 990;
    autoScroll.start();
    after(200);
    expect(page.top).toBe(998);
    expect(autoScroll.running).toBe(true);

    after(200);
    expect(page.top).toBe(1000);
    expect(autoScroll.running).toBe(false);
    expect(frames.waiting).toBe(0);
  });

  it('starts again from the top once at the end of the Lyric Sheet', () => {
    const { page, autoScroll, after } = setUp({ pace: 40 });
    page.top = 1000;
    autoScroll.start();
    expect(page.top).toBe(0);

    after(500);
    expect(page.top).toBe(20);
  });

  it('carries on from where the page is scrolled to by hand, once it stops moving', () => {
    const { page, autoScroll, frame, after } = setUp({ pace: 40 });
    autoScroll.start();
    after(500);
    expect(page.top).toBe(20);

    // A wheel's smooth scroll, still gliding: it's left to finish.
    page.top = 300;
    frame(50);
    expect(page.top).toBe(300);
    page.top = 400;
    frame(50);
    expect(page.top).toBe(400);

    after(500);
    expect(page.top).toBe(420);
    expect(autoScroll.running).toBe(true);
  });

  it('carries on from a scroll by hand of a pixel, however slow', () => {
    const { page, autoScroll, frame, after } = setUp({ pace: 40 });
    autoScroll.start();
    after(500);
    page.top = 21;
    frame(50);
    expect(page.top).toBe(21);
    frame(50);
    expect(page.top).toBe(23);
  });

  it("doesn't scroll while a finger is on the page, and carries on from where it's left", () => {
    const { page, autoScroll, frame, after } = setUp({ pace: 40 });
    autoScroll.start();
    after(500);
    page.held = true;
    after(500);
    expect(page.top).toBe(20);
    page.top = 200;
    after(500);
    expect(page.top).toBe(200);

    page.held = false;
    frame(50);
    expect(page.top).toBe(202);
    expect(autoScroll.running).toBe(true);
  });

  it('carries on from the top of the page when scrolled back up by hand', () => {
    const { page, autoScroll, frame, after } = setUp({ pace: 40 });
    page.top = 500;
    autoScroll.start();
    page.top = 0;
    frame(50);
    after(500);
    expect(page.top).toBe(20);
  });

  it('stops where it is when scrolled past the end of the Lyric Sheet by hand', () => {
    const { page, autoScroll, frame } = setUp({ pace: 40 });
    autoScroll.start();
    page.top = 1200;
    frame(50);
    expect(page.top).toBe(1200);
    frame(50);
    expect(page.top).toBe(1200);
    expect(autoScroll.running).toBe(false);
  });

  it("doesn't take a page rounding where it scrolls to for a scroll by hand", () => {
    const { page, autoScroll, after } = setUp({ pace: 3 });
    const scrollTo = page.scrollTo.bind(page);
    page.scrollTo = (top) => scrollTo(Math.round(top));
    autoScroll.start();
    after(1000);
    expect(page.top).toBe(3);
  });

  it("doesn't start where the whole Lyric Sheet is in view", () => {
    const { page, frames, autoScroll, awake } = setUp();
    page.end = 0;
    autoScroll.start();
    expect(autoScroll.running).toBe(false);
    expect(frames.waiting).toBe(0);
    expect(awake.held).toBe(0);
  });

  it("can't start while the Timeline plays", () => {
    const { page, frames, autoScroll } = setUp({ playing: true });
    page.top = 1000;
    autoScroll.start();
    expect(autoScroll.running).toBe(false);
    expect(page.top).toBe(1000);
    expect(frames.waiting).toBe(0);
  });

  it('stops where it is as the Timeline starts playing', () => {
    const { page, autoScroll, after, timeline } = setUp({ pace: 40 });
    autoScroll.start();
    after(500);
    timeline.playing = true;
    after(500);
    expect(autoScroll.running).toBe(false);
    expect(page.top).toBe(20);
  });

  it('keeps the screen awake while it runs', () => {
    const { page, autoScroll, after, awake } = setUp({ pace: 40 });
    autoScroll.start();
    expect(awake).toEqual({ held: 1, released: 0 });
    autoScroll.stop();
    expect(awake).toEqual({ held: 1, released: 1 });

    page.top = 990;
    autoScroll.start();
    after(500);
    expect(autoScroll.running).toBe(false);
    expect(awake).toEqual({ held: 2, released: 2 });
  });

  it("doesn't jump after a long frame, e.g. back from another tab", () => {
    const { page, autoScroll, frame } = setUp({ pace: 40 });
    autoScroll.start();
    frame(60_000);
    expect(page.top).toBe(4);
  });
});

group('autoScrollPace', () => {
  it('starts at level 4', () => {
    expect(startingLevel).toBe(4);
  });

  it('goes from slow to fast through the levels, at a Lyric Size of 100%', () => {
    expect(autoScrollPace(1, 100)).toBe(6);
    expect(autoScrollPace(4, 100)).toBe(21);
    expect(autoScrollPace(10, 100)).toBe(90);
  });

  it('scales with the Lyric Size, so a level reads as many Lines a minute at any size', () => {
    expect(autoScrollPace(4, 50)).toBe(10.5);
    expect(autoScrollPace(4, 150)).toBe(31.5);
    expect(autoScrollPace(10, 175)).toBe(157.5);
  });
});
