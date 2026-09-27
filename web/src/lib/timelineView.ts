// What part of the Timeline is on screen: how far it's zoomed in and
// scrolled along, and where times fall in pixels. Plain arithmetic, so the
// Timeline only has to follow it.

import { peaksPerSecond } from './peaks';
import { barWidth } from './waveform';

/** A stretch of the Timeline shown in a window some pixels wide. */
export interface View {
  /** How long the Timeline shown is, in seconds. */
  span: number;
  /** How wide the window onto it is, in pixels. */
  width: number;
  /** How many pixels a second takes. */
  scale: number;
  /** How far along it's scrolled, in pixels. */
  scroll: number;
}

/**
 * The most pixels a second can take: one waveform bar per stored peak, as
 * sharp as the waveform gets.
 */
export const maxScale = peaksPerSecond * barWidth;

/** How many pixels a second fit a Timeline span seconds long in width pixels. */
export function fitScale(span: number, width: number): number {
  return span > 0 ? width / span : 0;
}

/**
 * The view as it can be: zoomed out no further than the whole Timeline
 * fitting the width, in no further than maxScale unless that's what
 * fits, and scrolled no further than its ends.
 */
export function view(v: View): View {
  const scale = Math.max(Math.min(v.scale, maxScale), fitScale(v.span, v.width));
  const most = Math.max(0, v.span * scale - v.width);
  return { ...v, scale, scroll: Math.min(Math.max(v.scroll, 0), most) };
}

/** The time at x pixels from the left of the window. */
export function timeAt(v: View, x: number): number {
  return v.scale > 0 ? (x + v.scroll) / v.scale : 0;
}

/** How many pixels from the left of the window a time is. */
export function xAt(v: View, time: number): number {
  return time * v.scale - v.scroll;
}

/**
 * The view zoomed in by factor (below 1 to zoom out), keeping the time x
 * pixels from the left of the window where it is, e.g. under the pointer.
 */
export function zoom(v: View, factor: number, x: number): View {
  const time = timeAt(v, x);
  const scale = view({ ...v, scale: v.scale * factor }).scale;
  return view({ ...v, scale, scroll: time * scale - x });
}

/**
 * The view keeping a playing playhead in sight: once it passes 90% of the
 * width, or falls behind the view, the page turns to put it 10% in.
 */
export function follow(v: View, time: number): View {
  const x = xAt(v, time);
  if (x >= 0 && x <= v.width * 0.9) return v;
  return view({ ...v, scroll: time * v.scale - v.width * 0.1 });
}

// Round intervals for ruler marks, in seconds.
const tickSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

/** The closest ruler marks can be, in pixels, to fit an m:ss label. */
const tickSpacing = 60;

/**
 * Where the ruler is marked: every so many seconds, as few as keeps the
 * marks tickSpacing apart, and only in view and one mark either side.
 */
export function ticks(v: View): number[] {
  const step = tickSteps.find((s) => s * v.scale >= tickSpacing) ?? tickSteps[tickSteps.length - 1];
  const first = Math.max(0, Math.floor(timeAt(v, 0) / step) - 1);
  const last = Math.floor(timeAt(v, v.width) / step) + 1;
  const result: number[] = [];
  for (let i = first; i <= last && i * step < v.span; i++) result.push(i * step);
  return result;
}

/**
 * The stretch of a Clip, starting at start and length seconds long, whose
 * waveform is drawn: what's in view and half the width either side, so
 * scrolling doesn't show a gap before it's redrawn. It's in seconds into
 * the Clip, a whole number of bars barWidth pixels wide counted from the
 * Clip's start, so bars stay put as it scrolls. Null when none of it is near.
 */
export function waveWindow(v: View, start: number, length: number): { from: number; to: number; bars: number } | null {
  const bar = barWidth / v.scale;
  const near = v.width / 2;
  // In bars from the Clip's start.
  const first = Math.max(0, Math.floor(((timeAt(v, -near) - start) * v.scale) / barWidth));
  const last = Math.min(Math.ceil(length / bar), Math.ceil(((timeAt(v, v.width + near) - start) * v.scale) / barWidth));
  if (last <= first) return null;
  return { from: first * bar, to: Math.min(length, last * bar), bars: last - first };
}

/** How close to an edge of the window dragging scrolls it, in pixels. */
const edgeZone = 48;

/**
 * How fast to scroll while something's dragged x pixels from the left of
 * the window, in pixels a second, negative to go earlier: still until the
 * last edgeZone pixels before either edge, then faster the nearer it gets,
 * up to a window's width a second at the edge and past it. Still where
 * there's no further to scroll.
 */
export function edgeSpeed(v: View, x: number): number {
  // From -1, at or past the left edge, to 1 at or past the right.
  const toward =
    x < edgeZone
      ? -Math.min(1, (edgeZone - x) / edgeZone)
      : Math.max(0, Math.min(1, (x - (v.width - edgeZone)) / edgeZone));
  const most = view({ ...v, scroll: Infinity }).scroll;
  if (toward === 0 || (toward < 0 && v.scroll <= 0) || (toward > 0 && v.scroll >= most)) return 0;
  return toward * v.width;
}
