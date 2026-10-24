// Auto-scroll: the Lyric Sheet scrolling on its own at a steady pace in Read
// mode, every frame, from wherever the page is.
import { browserFrames, type Frames } from './transport.svelte';

/**
 * The pace of each speed level, 1 to 10 (see autoScrollSpeed.ts), in px a second at a Lyric Size of
 * 100%: from a slow ballad's to a fast song's.
 */
const paces = [6, 10, 15, 21, 28, 36, 46, 58, 72, 90];

/**
 * How fast a speed level scrolls, in px a second: its pace scaled by the
 * Lyric Size, as the Lines, Chords and gaps between Sections are, so a level
 * reads at the same pace whatever the size.
 */
export function autoScrollPace(level: number, lyricSize: number): number {
  return (paces[level - 1] * lyricSize) / 100;
}

/** The page Auto-scroll scrolls: the window's, or a fake of it. */
export interface AutoScrollPage {
  /** How far down the page is scrolled, in px. */
  scrolled(): number;
  /** How far down the page is scrolled once the end of the Lyric Sheet is in view, in px. */
  sheetEnd(): number;
  /** Scrolls the page straight to `top`, in px. */
  scrollTo(top: number): void;
  /** Whether a finger is on the page, which may be about to scroll it. */
  heldByHand(): boolean;
}

export interface AutoScrollOptions {
  page: AutoScrollPage;
  /** The pace, in px a second. */
  pace: () => number;
  /** Whether the Timeline is playing, whose cued Lines lead instead. */
  timelinePlaying: () => boolean;
  /** Keeps the screen awake where the browser allows, handing back what lets it sleep again. */
  keepAwake: () => () => void;
  /** The frames it scrolls on; the browser's by default. */
  frames?: Frames;
  /** The time, in ms; the page's clock by default. */
  now?: () => number;
}

/**
 * The longest a frame moves the page for, in seconds, so it carries on
 * rather than jumping when frames have stopped a while, e.g. in another tab.
 */
const longestFrame = 0.1;

/**
 * Whether the page is at the end of the Lyric Sheet, to within a pixel: a
 * browser may round where it scrolls to.
 */
function atEnd(scrolled: number, end: number): boolean {
  return scrolled >= end - 1;
}

export class AutoScroll {
  #running = $state(false);
  #options: AutoScrollOptions;
  #frames: Frames;
  #now: () => number;
  /** Where it's taking the page, unrounded, as a browser may round where it scrolls to. */
  #target = 0;
  /** Where the page was left last frame, as the page said: anywhere else, it's been scrolled by hand. */
  #left = 0;
  /** When the last frame ran, in ms. */
  #lastFrame = 0;
  #frame = 0;
  /** Lets the screen sleep again. */
  #sleep = () => {};

  constructor(options: AutoScrollOptions) {
    this.#options = options;
    this.#frames = options.frames ?? browserFrames;
    this.#now = options.now ?? (() => performance.now());
  }

  /** Whether it's scrolling. */
  get running(): boolean {
    return this.#running;
  }

  /**
   * Starts scrolling from where the page is, or from the top once at the end
   * of the Lyric Sheet. It can't while the Timeline plays, nor where the
   * whole Lyric Sheet is in view from the top, with nowhere to scroll to.
   */
  start = () => {
    const { page, timelinePlaying } = this.#options;
    if (this.#running || timelinePlaying()) return;
    const end = page.sheetEnd();
    if (atEnd(0, end)) return;
    if (atEnd(page.scrolled(), end)) page.scrollTo(0);
    this.#target = this.#left = page.scrolled();
    this.#lastFrame = this.#now();
    this.#running = true;
    this.#sleep = this.#options.keepAwake();
    this.#frame = this.#frames.request(this.#tick);
  };

  /** Stops scrolling, leaving the page where it is. */
  stop = () => {
    if (!this.#running) return;
    this.#running = false;
    this.#frames.cancel(this.#frame);
    this.#sleep();
  };

  /** Starts scrolling, or pauses it. */
  toggle = () => {
    if (this.#running) this.stop();
    else this.start();
  };

  #tick = () => {
    if (this.#options.timelinePlaying()) {
      this.stop();
      return;
    }
    const now = this.#now();
    const seconds = Math.min(longestFrame, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    const { page } = this.#options;
    const end = page.sheetEnd();
    const scrolled = page.scrolled();
    if (page.heldByHand() || scrolled !== this.#left) {
      // Held, or scrolled by hand (a wheel, a swipe, the scroll bar), however
      // little: it carries on from there, but only once the page is let go
      // and stops moving, so a drag isn't fought and a smooth scroll or a
      // swipe's glide finishes first.
      this.#target = this.#left = scrolled;
    } else {
      this.#target = Math.min(end, this.#target + this.#options.pace() * seconds);
      page.scrollTo(this.#target);
      this.#left = page.scrolled();
    }
    if (atEnd(this.#target, end)) this.stop();
    else this.#frame = this.#frames.request(this.#tick);
  };
}
