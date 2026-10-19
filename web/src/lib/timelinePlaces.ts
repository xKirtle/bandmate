// Where something is on the Timeline, as the Timeline shows it now:
//
// - A point on the page: the time under it, kept on the ruler or running
//   on past the end, the Track whose lane it is over, and how far down the
//   lanes it is. Also a point along the scroll bar, which isn't in them.
// - A Clip: the Track it's on.
// - A length in pixels across the lanes, as a length of time, and a time
//   asked for by hand, kept on the ruler.
//
// Every pointer gesture on the lanes — seeking and scrubbing on the ruler,
// drawing a box, moving, trimming and fading a Clip, setting the Loop,
// dropping files, and the scroll bar — asks here rather than measuring the
// page itself.
//
// It reads the places off the view shown (see timelineViewing.svelte.ts),
// which owns the lanes element and measures points into it, and off the
// elements the Timeline draws a Track's lane, the Tracks area and the
// scroll bar in. The Timeline keeps those references, as it keeps its
// markup; this is the only thing that measures them. The arithmetic of a
// view stays in timelineView.ts, underneath both.
import type { Clip, Track } from './api';
import { fileDropTrack, type TrackRow } from './fileDrop';
import { nearestRow } from './gripDragging.svelte';
import { timeAt, type View } from './timelineView';

/** An element the Timeline draws, where it is on the page. */
export interface Box {
  getBoundingClientRect(): { left: number; top: number; bottom: number };
}

/**
 * The view the places are read off: the stretch of the Timeline on screen,
 * and points measured into the lanes it fills (see TimelineViewing).
 */
export interface Viewing {
  readonly view: View;
  /** How far a point on the page is from the left of the lanes' window, in pixels. */
  xIn(clientX: number): number;
  /** How far a point on the page is down the lanes, in pixels. */
  yIn(clientY: number): number;
}

export interface TimelinePlacesOptions {
  /** The Timeline's Tracks, in the order their lanes are drawn. */
  tracks: () => readonly Track[];
  /** A Track's lane by its place among them, or undefined before it's drawn. */
  lane: (index: number) => Box | undefined;
  /** The Tracks area, which files are dropped on, or undefined while it's hidden. */
  area: () => Box | undefined;
  /** The scroll bar laid over the lanes' bottom edge, whose points are measured along it. */
  bar: () => Box | undefined;
}

export class TimelinePlaces {
  #viewing: Viewing;
  #options: TimelinePlacesOptions;

  constructor(viewing: Viewing, options: TimelinePlacesOptions) {
    this.#viewing = viewing;
    this.#options = options;
  }

  /**
   * The time under a point across the lanes, which may be past the end of
   * the Timeline shown, e.g. a Clip dragged later than anything on it.
   */
  timeAt(clientX: number): number {
    return timeAt(this.#viewing.view, this.#viewing.xIn(clientX));
  }

  /** The time under a point, kept on the ruler. */
  rulerTimeAt(clientX: number): number {
    return this.onRuler(this.timeAt(clientX));
  }

  /**
   * A time kept on the Timeline shown, i.e. on its ruler: past the end too,
   * e.g. to record there, though playback still stops at the end.
   */
  onRuler(time: number): number {
    return Math.max(0, Math.min(this.#viewing.view.span, time));
  }

  /** How long a width across the lanes is, in seconds at the scale shown. */
  seconds(pixels: number): number {
    return pixels / this.#viewing.view.scale;
  }

  /** How far a point is down the lanes, in pixels, e.g. for a box drawn across them. */
  yIn(clientY: number): number {
    return this.#viewing.yIn(clientY);
  }

  /** The Track whose lane is nearest a height on the page. */
  trackIdAt(clientY: number): number {
    const tracks = this.#options.tracks();
    return tracks[this.trackIndexAt(clientY)].id;
  }

  /** The place among the Tracks of the one whose lane is nearest a height on the page. */
  trackIndexAt(clientY: number): number {
    // Only the lanes of Tracks there now: a removed Track's may linger.
    const lanes = this.#options.tracks().map((_, i) => this.#lane(i));
    return nearestRow(clientY, lanes) ?? 0;
  }

  /** The Track a Clip is on. */
  trackOf(clip: Clip): Track {
    return this.#options.tracks().find((t) => t.clips.some((c) => c.id === clip.id))!;
  }

  /**
   * The Track files dropped this far down the page would go to, or null
   * where they'd do nothing. Unlike a Clip dragged, which goes to the
   * nearest Track, files go nowhere above the first Track (see fileDrop.ts).
   */
  fileTrackAt(clientY: number, chosen: number): number | null {
    const area = this.#options.area();
    if (!area) return null;
    const rows: TrackRow[] = [];
    for (const [i, track] of this.#options.tracks().entries()) {
      const lane = this.#lane(i);
      if (!lane) return null;
      rows.push({ trackId: track.id, top: lane.top, bottom: lane.bottom });
    }
    return fileDropTrack(clientY, area.getBoundingClientRect(), rows, chosen);
  }

  /** How far a point is from the left of the scroll bar, in pixels. */
  xInBar(clientX: number): number {
    return clientX - this.#options.bar()!.getBoundingClientRect().left;
  }

  /** Where a Track's lane runs down the page, or null before it's drawn. */
  #lane(index: number): { top: number; bottom: number } | null {
    return this.#options.lane(index)?.getBoundingClientRect() ?? null;
  }
}
