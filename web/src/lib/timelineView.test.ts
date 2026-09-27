import { describe, expect, it } from 'vitest';
import { edgeSpeed, fitScale, follow, maxScale, ticks, timeAt, view, waveWindow, xAt, zoom } from './timelineView';

// A 100s Timeline shown 500px wide: fitted, that's 5px a second.
const fitted = view({ span: 100, width: 500, scale: 0, scroll: 0 });

describe('fitScale', () => {
  it('is how many pixels a second fit the whole Timeline in the width', () => {
    expect(fitScale(100, 500)).toBe(5);
  });

  it('is 0 without a Timeline to fit', () => {
    expect(fitScale(0, 500)).toBe(0);
  });
});

describe('view', () => {
  it('fits the whole Timeline when not zoomed in', () => {
    expect(fitted.scale).toBe(5);
    expect(fitted.scroll).toBe(0);
  });

  it('zooms in no further than one waveform bar per stored peak', () => {
    // 100 peaks a second, 3px a bar.
    expect(maxScale).toBe(300);
    expect(view({ span: 100, width: 500, scale: 1000, scroll: 0 }).scale).toBe(300);
  });

  it('can always fit a Timeline shorter than the window at maximum zoom', () => {
    // 1s over 500px is more than the maximum, but fitting wins.
    expect(view({ span: 1, width: 500, scale: 0, scroll: 0 }).scale).toBe(500);
  });

  it('scrolls no further than the Timeline’s ends', () => {
    // 20px a second: 2000px along, 1500px of it past the window.
    expect(view({ span: 100, width: 500, scale: 20, scroll: -50 }).scroll).toBe(0);
    expect(view({ span: 100, width: 500, scale: 20, scroll: 1800 }).scroll).toBe(1500);
    expect(view({ span: 100, width: 500, scale: 0, scroll: 300 }).scroll).toBe(0);
  });
});

describe('timeAt and xAt', () => {
  it('map across the width when fitted', () => {
    expect(timeAt(fitted, 250)).toBe(50);
    expect(xAt(fitted, 50)).toBe(250);
  });

  it('count the scroll when zoomed in', () => {
    // 20px a second, scrolled 400px: 20s is at the left edge.
    const zoomed = view({ span: 100, width: 500, scale: 20, scroll: 400 });
    expect(timeAt(zoomed, 0)).toBe(20);
    expect(timeAt(zoomed, 100)).toBe(25);
    expect(xAt(zoomed, 25)).toBe(100);
  });
});

describe('zoom', () => {
  it('keeps the time under the pointer where it is', () => {
    // 30s is 150px in when fitted; zoomed 4x, it's still 150px in.
    const zoomed = zoom(fitted, 4, 150);
    expect(zoomed.scale).toBe(20);
    expect(timeAt(zoomed, 150)).toBe(30);
  });

  it('zooms out back to fitting the whole Timeline', () => {
    const zoomed = zoom(fitted, 4, 150);
    expect(zoom(zoomed, 1 / 100, 150)).toEqual(fitted);
  });

  it('stays within the Timeline when zooming near its ends', () => {
    // 20px a second, zooming out at the right edge while scrolled to the end.
    const atEnd = view({ span: 100, width: 500, scale: 20, scroll: 1500 });
    const out = zoom(atEnd, 1 / 2, 500);
    expect(out.scale).toBe(10);
    expect(out.scroll).toBe(500);
  });
});

describe('follow', () => {
  // 20px a second, showing 20s to 45s.
  const zoomed = view({ span: 100, width: 500, scale: 20, scroll: 400 });

  it('stays put while the playhead is well in view', () => {
    expect(follow(zoomed, 30)).toEqual(zoomed);
  });

  it('turns the page as the playhead nears the right edge', () => {
    // 43s is 460px in, past 90% of the width: it goes 10% in instead.
    const turned = follow(zoomed, 43);
    expect(xAt(turned, 43)).toBe(50);
  });

  it('goes back to a playhead behind the view, e.g. going round the Loop', () => {
    expect(xAt(follow(zoomed, 10), 10)).toBe(50);
    // Near the start, it can only go back to 0:00.
    expect(follow(zoomed, 1).scroll).toBe(0);
  });

  it('never needs to move when fitted', () => {
    expect(follow(fitted, 99)).toEqual(fitted);
  });
});

describe('ticks', () => {
  it('marks round times at least 60px apart', () => {
    // 5px a second: 15s is 75px, 10s only 50px.
    expect(ticks(fitted)).toEqual([0, 15, 30, 45, 60, 75, 90]);
  });

  it('marks closer times zoomed in, only around what is in view', () => {
    // 20px a second, showing 20s to 45s: every 5s (100px), with one either side.
    const zoomed = view({ span: 100, width: 500, scale: 20, scroll: 400 });
    expect(ticks(zoomed)).toEqual([15, 20, 25, 30, 35, 40, 45, 50]);
  });

  it('marks every second at most', () => {
    const closest = view({ span: 100, width: 500, scale: 300, scroll: 0 });
    expect(ticks(closest)).toEqual([0, 1, 2]);
  });

  it('marks every 20 minutes on a very long Timeline', () => {
    const long = view({ span: 7200, width: 500, scale: 0, scroll: 0 });
    expect(ticks(long)).toEqual([0, 1200, 2400, 3600, 4800, 6000]);
  });
});

describe('waveWindow', () => {
  // 30px a second, so a 3px bar is 0.1s, showing 20s to 40s. Drawn with
  // half the width either side, that's 10s to 50s.
  const zoomed = view({ span: 100, width: 600, scale: 30, scroll: 600 });

  function rounded(w: ReturnType<typeof waveWindow>) {
    return w && { from: +w.from.toFixed(6), to: +w.to.toFixed(6), bars: w.bars };
  }

  it('covers what of a long Clip is around the view, a bar every 3px', () => {
    // A Clip from 5s: 5s to 45s into it.
    expect(rounded(waveWindow(zoomed, 5, 100))).toEqual({ from: 5, to: 45, bars: 400 });
  });

  it('covers all of a short Clip in view', () => {
    expect(rounded(waveWindow(zoomed, 30, 5))).toEqual({ from: 0, to: 5, bars: 50 });
  });

  it('lines bars up from the Clip’s start, so they don’t shift as it scrolls', () => {
    // From 5.05s, 10s is 4.95s in: the bar it's in starts at 4.9s.
    expect(rounded(waveWindow(zoomed, 5.05, 100))).toEqual({ from: 4.9, to: 45, bars: 401 });
  });

  it('draws nothing of a Clip well out of view', () => {
    expect(waveWindow(zoomed, 60, 10)).toBeNull();
    expect(waveWindow(zoomed, 0, 9)).toBeNull();
  });
});

describe('edgeSpeed', () => {
  // 20px a second, showing 20s to 45s of 100s: room to scroll both ways.
  const zoomed = view({ span: 100, width: 500, scale: 20, scroll: 400 });

  it('is still while dragging well inside the window', () => {
    expect(edgeSpeed(zoomed, 250)).toBe(0);
  });

  it('scrolls later faster the nearer the right edge', () => {
    // The last 48px ramp up to a window's width a second.
    expect(edgeSpeed(zoomed, 452)).toBe(0);
    expect(edgeSpeed(zoomed, 476)).toBe(250);
    expect(edgeSpeed(zoomed, 500)).toBe(500);
  });

  it('scrolls earlier near the left edge', () => {
    expect(edgeSpeed(zoomed, 24)).toBe(-250);
  });

  it('goes no faster past the edge', () => {
    expect(edgeSpeed(zoomed, 900)).toBe(500);
    expect(edgeSpeed(zoomed, -300)).toBe(-500);
  });

  it('is still where there’s no further to scroll', () => {
    expect(edgeSpeed(fitted, 490)).toBe(0);
    expect(edgeSpeed(view({ ...zoomed, scroll: 0 }), 10)).toBe(0);
    expect(edgeSpeed(view({ ...zoomed, scroll: 1500 }), 490)).toBe(0);
  });
});
