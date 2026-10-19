// Timeline viewing: what part of the Timeline is on screen, kept for one
// Timeline. The arithmetic of a view — pixels to seconds, what a zoom or a
// thumb leaves, where the ruler's marked — is timelineView.ts, which this
// holds the state and the scrolling for. The Timeline only draws the view
// it shows and hands over the gestures it hears.
//
// - The view shown: how far it's zoomed in (the scale), how far along it's
//   scrolled, and how wide its window is. Zoomed all the way out (scale 0)
//   the whole Timeline fits, however long it grows, and it stays fitted
//   once it fits again, e.g. after a long Clip is deleted.
// - The lanes element's own scroll, which this is the only writer of: a new
//   view is shown by scrolling it there, once it's as wide as the new scale
//   makes it, so the lanes and the view never disagree.
// - Hand-scrolling, told from the scrolling the Timeline did itself by
//   comparing the lanes' scroll with where it was last put, and reported so
//   the Transport can stop following the playhead. Transport keeps
//   deciding that; this only says when a hand scrolled.
// - Revealing a time, i.e. scrolling the playhead into view as it plays.
// - Zooming around a point, and pinching, which zooms and pans together.
// - The scroll bar's thumb and its drag, given up when the bar goes or a
//   pinch starts.
// - Scrolling along near the lanes' edges while something's dragged, which
//   the drags that follow the pointer ask for (see pointerFollow.ts).
import { tick, untrack } from 'svelte';
import type { EdgeScroll } from './pointerFollow';
import type { Point } from './press';
import {
  edgeSpeed,
  fitScale,
  follow,
  scrollThumb,
  thumbScroll,
  view as timelineView,
  zoom,
  type View,
} from './timelineView';

/**
 * The lanes, the window onto the Timeline: the element the Timeline draws
 * them in, or a fake of it.
 */
export interface Lanes {
  /** How far along the lanes are scrolled, in pixels. */
  scrollLeft: number;
  /** Where the lanes' window is on the page, to measure a point against. */
  getBoundingClientRect(): { left: number };
}

/** The narrowest the scroll bar's thumb gets, in pixels, to stay easy to grab. */
const leastThumb = 32;

export interface TimelineViewingOptions {
  /** How long the Timeline shown is, in seconds. */
  span: () => number;
  /** The lanes, once the Timeline has drawn them. */
  lanes: () => Lanes | undefined;
  /**
   * Hears the view scrolled by hand, rather than to where the Timeline
   * showed it, e.g. to stop following the playhead.
   */
  onHandScroll: () => void;
}

/** Two fingers pinching: how far apart they are, and where their middle is on the page. */
interface Pinch {
  distance: number;
  x: number;
}

/** A pinch between two fingers. */
function pinchOf(a: Point, b: Point): Pinch {
  return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2 };
}

export class TimelineViewing {
  #options: TimelineViewingOptions;
  /** How many pixels a second takes, or 0 zoomed all the way out, where the whole Timeline fits. */
  #scale = $state(0);
  #scroll = $state(0);
  #width = $state(0);
  /** Where the lanes were last scrolled to from here, to tell scrolling by hand. */
  #scrolledTo = 0;
  /** The pointer dragging the thumb, and how far into it it grabbed, in pixels. */
  #thumbDrag = $state<{ pointerId: number; grip: number } | null>(null);
  #pinch: Pinch | null = null;
  /** Where something's dragged to, and what to move again as the lanes scroll under it. */
  #dragScroll: { at: Point; move: (at: Point) => void } | null = null;
  #dragFrame = 0;

  constructor(options: TimelineViewingOptions) {
    this.#options = options;

    // Zoomed out while dragging the thumb, e.g. by pinching, the bar goes
    // and the drag with it.
    $effect(() => {
      if (!this.thumb) this.#thumbDrag = null;
    });

    // Hidden or shown again, the lanes lose where they were scrolled to.
    // Resized, they may need to go back within the Timeline.
    $effect(() => {
      if (!options.lanes() || this.#width === 0) return;
      untrack(() => void this.#show(this.view));
    });

    // Once the Timeline fits without zooming out, e.g. after deleting a long
    // Clip, it stays fitted rather than zooming back in as it grows again.
    $effect(() => {
      if (this.#scale > 0 && this.#scale <= fitScale(options.span(), this.#width)) this.#scale = 0;
    });

    // Nothing is left scrolling once the Timeline goes.
    $effect(() => () => this.dragDone());
  }

  /** The view shown: the Timeline's span in a window, zoomed and scrolled as it can be. */
  get view(): View {
    return timelineView({ span: this.#options.span(), width: this.#width, scale: this.#scale, scroll: this.#scroll });
  }

  /** How wide the window onto the Timeline is, in pixels: the lanes' width, which the Timeline binds. */
  get width(): number {
    return this.#width;
  }

  set width(width: number) {
    this.#width = width;
  }

  /** How far a point on the page is from the left of the lanes' window, in pixels. */
  xIn(clientX: number): number {
    return clientX - this.#options.lanes()!.getBoundingClientRect().left;
  }

  /** Shows the Timeline zoomed and scrolled as v has it, scrolling the lanes there. */
  async #show(v: View) {
    // Zoomed all the way out, it keeps fitting as the Timeline or window changes.
    this.#scale = v.scale > fitScale(v.span, v.width) ? v.scale : 0;
    this.#scroll = this.#scrolledTo = v.scroll;
    // Once the lanes are as wide as zoomed to.
    await tick();
    const lanes = this.#options.lanes();
    if (lanes) lanes.scrollLeft = v.scroll;
  }

  /** Scrolls a time into view, if it isn't: the least that brings it back. */
  reveal(time: number) {
    // Not while the Timeline's hidden, with no view to scroll.
    if (this.#width === 0) return;
    const shown = this.view;
    const next = follow(shown, time);
    if (next.scroll !== shown.scroll) void this.#show(next);
  }

  /** Zooms in by factor (below 1 to zoom out), keeping the time under a point on the page where it is. */
  zoomAt(factor: number, clientX: number) {
    void this.#show(zoom(this.view, factor, this.xIn(clientX)));
  }

  /** Scrolls the lanes along by pixels, e.g. for a wheel over the scroll bar, which isn't in them. */
  scrollBy(pixels: number) {
    this.#options.lanes()!.scrollLeft += pixels;
  }

  /** Takes the lanes' scroll as it is now, telling a hand's scroll from the Timeline's own. */
  scrolled() {
    const at = this.#options.lanes()!.scrollLeft;
    this.#scroll = at;
    // Scrolled by hand, rather than to where it was shown.
    if (Math.abs(at - timelineView({ ...this.view, scroll: this.#scrolledTo }).scroll) > 1)
      this.#options.onHandScroll();
    this.#scrolledTo = at;
  }

  // The browser's own scroll bar is hidden, as it took height on zooming in
  // and shifted the Timeline. The Timeline draws one over the lanes' bottom
  // edge instead, taking none, whose thumb is the stretch in view. Its
  // points are measured along the bar, not the page: the Timeline owns that
  // element. Dragging the thumb or clicking beside it scrolls the lanes, so
  // it counts as scrolling by hand.

  /** Where the thumb is and how wide, in pixels along the bar, or null with the whole Timeline in view. */
  get thumb(): { left: number; width: number } | null {
    return scrollThumb(this.view, leastThumb);
  }

  /** Whether the thumb is being dragged. */
  get thumbDragging(): boolean {
    return this.#thumbDrag !== null;
  }

  /** Takes the thumb, grabbed by a pointer at a point along the bar. */
  thumbDown(pointerId: number, atBar: number) {
    const thumb = this.thumb;
    if (!thumb) return;
    this.#thumbDrag = { pointerId, grip: atBar - thumb.left };
  }

  /** Drags the thumb, by the pointer that took it, to a point along the bar. */
  thumbMove(pointerId: number, atBar: number) {
    if (pointerId !== this.#thumbDrag?.pointerId) return;
    this.#thumbTo(atBar - this.#thumbDrag.grip);
  }

  /** Lets the thumb go. */
  thumbUp() {
    this.#thumbDrag = null;
  }

  /** Centres the thumb on a point along the bar, and so the view on the time there. */
  barDown(atBar: number) {
    const thumb = this.thumb;
    if (!thumb) return;
    this.#thumbTo(atBar - thumb.width / 2);
  }

  /** Scrolls the lanes so the thumb starts left pixels along the bar. */
  #thumbTo(left: number) {
    this.#options.lanes()!.scrollLeft = thumbScroll(this.view, leastThumb, left).scroll;
  }

  /** Whether two fingers are pinching, so the lanes pan under them rather than the page scrolling. */
  get pinching(): boolean {
    return this.#pinch !== null;
  }

  /**
   * Starts a pinch between two fingers, giving up a thumb drag and any
   * scrolling at the edges the first finger started.
   */
  pinchStart(a: Point, b: Point) {
    this.#pinch = pinchOf(a, b);
    this.#thumbDrag = null;
    this.dragDone();
  }

  /** Zooms around a pinch's middle as the fingers move, and pans along with it. */
  pinchMove(a: Point, b: Point) {
    if (!this.#pinch) return;
    const now = pinchOf(a, b);
    const zoomed = zoom(this.view, now.distance / this.#pinch.distance, this.xIn(now.x));
    void this.#show(timelineView({ ...zoomed, scroll: zoomed.scroll - (now.x - this.#pinch.x) }));
    this.#pinch = now;
  }

  /** Ends a pinch, as a finger leaves. */
  pinchEnd() {
    this.#pinch = null;
  }

  /**
   * Scrolling along near the edges of the lanes while something's dragged,
   * for the drags that follow the pointer (see pointerFollow.ts): faster
   * the nearer the edge, with what's dragged moved again as they go.
   */
  readonly edgeScroll: EdgeScroll = {
    along: (at, move) => this.dragTo(at, move),
    done: () => this.dragDone(),
  };

  /** Notes where something's dragged to, scrolling the lanes if it's near an edge. */
  dragTo(at: Point, move: (at: Point) => void) {
    this.#dragScroll = { at: { clientX: at.clientX, clientY: at.clientY }, move };
    if (this.#dragFrame) return;
    let last = performance.now();
    const step = (now: number) => {
      if (!this.#dragScroll) return;
      const shown = this.view;
      const speed = edgeSpeed(shown, this.xIn(this.#dragScroll.at.clientX));
      if (speed !== 0) {
        void this.#show(timelineView({ ...shown, scroll: shown.scroll + (speed * (now - last)) / 1000 }));
        this.#options.onHandScroll();
        this.#dragScroll.move(this.#dragScroll.at);
      }
      last = now;
      this.#dragFrame = requestAnimationFrame(step);
    };
    this.#dragFrame = requestAnimationFrame(step);
  }

  /** Stops scrolling along at the edges, as a drag ends or is given up. */
  dragDone() {
    this.#dragScroll = null;
    if (this.#dragFrame) cancelAnimationFrame(this.#dragFrame);
    this.#dragFrame = 0;
  }
}
