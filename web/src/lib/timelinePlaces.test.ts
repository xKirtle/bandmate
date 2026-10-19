import { describe, expect, it } from 'vitest';
import type { Clip, Track } from './api';
import { TimelinePlaces, type Box, type Viewing } from './timelinePlaces';
import { view as timelineView, type View } from './timelineView';

/**
 * The view the places are read off: a 100 second Timeline in an 800 pixel
 * window, fitted at 8 pixels a second, with the lanes 50 pixels across the
 * page and 200 down it.
 */
class FakeViewing implements Viewing {
  span = 100;
  scale = 8;
  scroll = 0;
  /** Where the lanes' window starts on the page, in pixels. */
  left = 50;
  top = 200;

  get view(): View {
    return timelineView({ span: this.span, width: 800, scale: this.scale, scroll: this.scroll });
  }

  xIn(clientX: number): number {
    return clientX - this.left;
  }

  yIn(clientY: number): number {
    return clientY - this.top;
  }
}

/** An element where it is on the page, as the Timeline's are. */
function box(top: number, bottom: number, left = 0): Box {
  return { getBoundingClientRect: () => ({ left, top, bottom }) };
}

/** A Track with the Clips given, numbered from 1. */
function track(id: number, clipIds: number[] = []): Track {
  return {
    id,
    name: `Track ${id}`,
    volume: 0,
    muted: false,
    soloed: false,
    clips: clipIds.map((clipId) => ({ id: clipId }) as Clip),
  };
}

/**
 * The places on a Timeline of three Tracks, their lanes 60 pixels tall from
 * 200 down the page, in a Tracks area from 180 to 400, with the scroll bar
 * 60 across it.
 */
function placesFor() {
  const viewing = new FakeViewing();
  const state = {
    tracks: [track(1, [11, 12]), track(2, [21]), track(3)],
    lanes: [box(200, 260), box(260, 320), box(320, 380)] as (Box | undefined)[],
    area: box(180, 400) as Box | undefined,
  };
  const places = new TimelinePlaces(viewing, {
    tracks: () => state.tracks,
    lane: (index) => state.lanes[index],
    area: () => state.area,
    bar: () => box(0, 0, 60),
  });
  return { places, viewing, state };
}

describe('the time under a point', () => {
  it('is read across the lanes, at the scale shown', () => {
    const { places } = placesFor();
    expect(places.timeAt(50)).toBe(0);
    expect(places.timeAt(450)).toBe(50);
  });

  it('follows the lanes as they scroll', () => {
    const { places, viewing } = placesFor();
    viewing.scale = 16;
    viewing.scroll = 160;
    expect(places.timeAt(50)).toBe(10);
  });

  it('runs on past the end of the Timeline shown, e.g. to drag a Clip later', () => {
    const { places } = placesFor();
    expect(places.timeAt(50 + 100 * 8 + 200)).toBe(125);
  });

  it('is kept on the ruler, where the ruler asks', () => {
    const { places } = placesFor();
    expect(places.rulerTimeAt(50 + 100 * 8 + 200)).toBe(100);
    expect(places.rulerTimeAt(10)).toBe(0);
    expect(places.rulerTimeAt(450)).toBe(50);
  });

  it('keeps a time asked for by hand, e.g. by a key, on the ruler too', () => {
    const { places } = placesFor();
    expect(places.onRuler(-5)).toBe(0);
    expect(places.onRuler(125)).toBe(100);
    expect(places.onRuler(50)).toBe(50);
  });

  it('measures a width across the lanes as a length of time', () => {
    const { places } = placesFor();
    expect(places.seconds(16)).toBe(2);
  });
});

describe('the Track a point is over', () => {
  it('is the one whose lane it is in', () => {
    const { places } = placesFor();
    expect(places.trackIdAt(230)).toBe(1);
    expect(places.trackIdAt(290)).toBe(2);
    expect(places.trackIdAt(350)).toBe(3);
  });

  it('is the first Track above the first lane, and the last below the last', () => {
    const { places } = placesFor();
    expect(places.trackIdAt(0)).toBe(1);
    expect(places.trackIdAt(5000)).toBe(3);
  });

  it('is given by its place among the Tracks too', () => {
    const { places } = placesFor();
    expect(places.trackIndexAt(290)).toBe(1);
    expect(places.trackIndexAt(0)).toBe(0);
  });

  it('skips a removed Track whose lane is still on the page', () => {
    const { places, state } = placesFor();
    state.tracks = state.tracks.slice(0, 2);
    // Over the lane the third Track left behind, so the second is nearest.
    expect(places.trackIdAt(350)).toBe(2);
  });

  it('falls back to the first Track with no lane drawn yet', () => {
    const { places, state } = placesFor();
    state.lanes = [undefined, undefined, undefined];
    expect(places.trackIdAt(290)).toBe(1);
  });

  it('is how far down the lanes the point is, for a box drawn across them', () => {
    const { places } = placesFor();
    expect(places.yIn(230)).toBe(30);
  });
});

describe('the Track a Clip is on', () => {
  it('is the one holding it', () => {
    const { places } = placesFor();
    expect(places.trackOf({ id: 21 } as Clip).id).toBe(2);
  });
});

describe('the Track files dropped would go to', () => {
  it('is the one their lane is over', () => {
    const { places } = placesFor();
    expect(places.fileTrackAt(230, 2)).toBe(1);
  });

  it('is the Chosen Track below the last lane', () => {
    const { places } = placesFor();
    expect(places.fileTrackAt(390, 2)).toBe(2);
    expect(places.fileTrackAt(450, 2)).toBe(2);
  });

  it('is nowhere above the Tracks area, or before it is drawn', () => {
    const { places, state } = placesFor();
    expect(places.fileTrackAt(100, 2)).toBeNull();
    state.area = undefined;
    expect(places.fileTrackAt(230, 2)).toBeNull();
    state.area = box(180, 400);
    state.lanes = [box(200, 260), undefined, box(320, 380)];
    expect(places.fileTrackAt(230, 2)).toBeNull();
  });
});

describe('a point along the scroll bar', () => {
  it('is measured from the bar, which is not in the lanes', () => {
    const { places } = placesFor();
    expect(places.xInBar(100)).toBe(40);
  });
});
