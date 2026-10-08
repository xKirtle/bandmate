import type { Clip, ClipFades, ClipMove, Track } from './api';
import { clampMove, clampTrimEnd, clampTrimStart, draggedNudge, moveSelection, nudged } from './clipEdit';
import { draggedFade, grabbedFade, isFadeEnd, type FadeEnd } from './clipFade';
import { draggedGain } from './clipGain';
import { activeTake } from './clipSource';
import type { Edit } from './history';
import { pastSlop, type Point, type PointerAt } from './press';
import type { Placed } from './schedule';
import type { Selection } from './selection.svelte';
import {
  editTargets,
  snapEdge,
  snapMove,
  snapSelection,
  type Aligned,
  type SelectionSnap,
  type Snap,
} from './snapping';

// Dragging a Clip, from press to release: its body moves it, along its
// Track or onto another; an edge trims it; Alt+dragging a Clip of Takes
// nudges its active Take within it; its gain line sets its Gain, finely
// with Shift held; a dot at either end of the gain line sets its fade in or
// fade out. It stops at its neighbours, the source's ends and 0:00 as it
// goes, and is saved on release, if it changed. Moved, trimmed or nudged,
// the Clip is shown as it was dropped until the save resolves; its Gain or
// Fades are handed over on release, for Timeline editing to show until
// saved (see timelineEditing.svelte.ts). Moved or trimmed, it snaps to other
// Clips' edges, the playhead and the Loop's edges, unless Shift is held;
// the Selection, moved together, snaps by any of its Clips' edges to those
// of Clips outside it.
//
// It works in seconds and Tracks: the Timeline measures the page, listens
// to the pointer, scrolls at the edges, saves and offers to move the Cues.

/**
 * Where a Clip is pressed: its body, to move it, its start or end edge, to
 * trim it, its gain line, to set its Gain, or a fade dot, to set that Fade.
 */
export type ClipGrip = 'move' | 'start' | 'end' | 'gain' | FadeEnd;

/** What a Clip drag does: move the Clip (or the Selection), trim either edge, nudge its active Take, or set its Gain or a Fade. */
export type ClipDragMode = ClipGrip | 'nudge';

/** Where a Clip's fade dots are as it's pressed, in seconds. */
export interface FadeDots {
  /** Where the fade in's dot's middle is, along the Timeline. */
  fadeIn: number;
  /** Where the fade out's dot's middle is, along the Timeline. */
  fadeOut: number;
  /** How wide a dot is. */
  width: number;
  /** How far in from the Clip's edge a dot rests without a Fade: just inside the trim edge. */
  rests: number;
}

/** What the Timeline measures of a Clip as it's pressed: for its gain line or for a fade dot. */
export interface ClipMeasure {
  /** How tall its waveform is, in pixels, which its gain line goes up and down. */
  waveHeight?: number;
  /** Where its fade dots are. */
  dots?: FadeDots;
}

/**
 * Where the pointer is, for a Clip drag: its point, on the page, which for
 * the gain line also says how high it is, the time under it, and the Track
 * under it.
 */
export interface DragAt extends PointerAt {
  /** The Track whose lane is nearest to it. */
  trackId: number;
}

/** The modifiers held as a Clip is pressed. */
export interface PressKeys {
  /** Shift, to move or trim without snapping, or to drag the gain line finely. */
  free: boolean;
  /** Mod, so a click adds the Clip to the Selection or takes it out. */
  toggles: boolean;
  /** Alt, so dragging a Clip of Takes nudges its active Take. */
  nudges: boolean;
}

/** What a Clip drag snaps to, for the guide: the time, what's aligned there, and the Track of the Clip whose edge snapped. */
export interface DragSnap {
  at: number;
  aligned: Aligned[];
  trackId: number;
}

/** A Clip shown where it's dragged to: as it's shown, e.g. nudged, on which Track, and where. */
export interface DraggedClip {
  clip: Clip;
  trackId: number;
  at: Placed;
}

/** The edit a release saves, and for a move, which Clips moved and by how far, to offer moving their Cues. */
export interface DragSave {
  edit: Extract<Edit, { kind: 'moveClip' | 'moveClips' | 'trimClip' | 'nudgeTake' | 'setClipGain' | 'setClipFades' }>;
  moved: { clips: Clip[]; by: number } | null;
}

/** The Timeline a Clip drag goes over. */
export interface DragContext {
  tracks: () => readonly Track[];
  /** Where the playhead is, in seconds, to snap to. */
  playhead: () => number;
  /** The Loop as shown, on or off, to snap to its edges. */
  loop: () => { start: number; end: number } | null;
  /** How near a target an edge snaps to it, in seconds, at the zoom shown. */
  reach: () => number;
  /** How long a Clip's source is, in seconds, which it can't be trimmed past. */
  sourceLength: (clip: Clip) => number;
}

interface Drag {
  clip: Clip;
  mode: ClipDragMode;
  /** Where the pointer went down, to tell a click or a long press from a drag. */
  from: Point;
  /** How far right of what it drags it was grabbed, in seconds: the Clip's start, or for a fade dot, the dot's middle. */
  grab: number;
  moved: boolean;
  /** The Track it's shown on now. */
  trackId: number;
  /** Where it's shown now. */
  placement: Placed;
  /** Where its active Take is nudged to, for a nudge. */
  nudge: number;
  /** Its Gain as dragged, in dB, for the gain line. */
  gain: number;
  /**
   * For the gain line, what it's dragged from: the Gain and the pointer's
   * height, both moved on whenever Shift is pressed or let go, so the line
   * never jumps, and how tall the Clip's waveform is, in pixels.
   */
  gainFrom: { gain: number; clientY: number; height: number };
  /** Its Fades as dragged, in seconds, for a fade dot. */
  fades: ClipFades;
  /** For a fade dot, how far in from the Clip's edge it rests without a Fade, in seconds. */
  rests: number;
  /** Whether Shift is held, to move or trim without snapping, or to drag the gain line finely. */
  free: boolean;
  /** Whether Mod was held as it was pressed, so a click adds it to the Selection or takes it out. */
  toggles: boolean;
  /** What a move or trim is snapped to, with the lanes of what's there, while it is; for the Selection, by which Clip. */
  snap: Snap<Aligned> | SelectionSnap<Aligned> | null;
  /** Where every selected Clip is shown, when the Selection is moved together; null for one Clip. */
  moves: ClipMove[] | null;
  saving: boolean;
}

/** Whether a drag snaps, unless Shift is held: a move or a trim. */
function snaps(mode: ClipDragMode): boolean {
  return mode === 'move' || mode === 'start' || mode === 'end';
}

/**
 * Whether a drag holds the Clip as it was dropped until its save resolves:
 * a move, a trim or a nudge, which Timeline editing doesn't show before
 * it's saved. A Gain or a Fade is handed over to it on release.
 */
function holdsDropped(mode: ClipDragMode): boolean {
  return mode !== 'gain' && !isFadeEnd(mode);
}

/** Whether a Clip is selected as it's grabbed, as clicking it does, rather than when let go: by its gain line or a fade dot. */
function selectsAtPress(mode: ClipDragMode): boolean {
  return mode === 'gain' || isFadeEnd(mode);
}

/** A Clip drag on a Timeline, from press to release, and for a move, a trim or a nudge, until its save resolves. */
export class ClipDrag {
  #drag = $state<Drag | null>(null);
  /** The save the drag holds the Clips as they were dropped for, while it does: only that one resolving lets them go. */
  #held: DragSave | null = null;
  #selection: Selection;
  #context: DragContext;

  /** Over a Timeline, applying drag, click and toggle to its Selection. */
  constructor(selection: Selection, context: DragContext) {
    this.#selection = selection;
    this.#context = context;
  }

  /** The Clip pressed, while it's pressed, dragged, or held as dropped while saving. */
  get clip(): Clip | null {
    return this.#drag?.clip ?? null;
  }

  /** What the drag does, while there is one. */
  get mode(): ClipDragMode | null {
    return this.#drag?.mode ?? null;
  }

  /** Whether the press has moved past the slop, becoming a drag. */
  get moved(): boolean {
    return this.#drag?.moved ?? false;
  }

  /** Whether it's been let go, holding the Clips as dropped while its edit is saving. */
  get saving(): boolean {
    return this.#drag?.saving ?? false;
  }

  /**
   * The Clips shown where they're dragged to, once the press is a drag:
   * the Clip, or every selected Clip, when they're moved together. Until
   * then, none: the Clip pressed stays where it is among the others, as
   * moved in the page it would never get its click, or double-click.
   */
  get shown(): DraggedClip[] {
    const drag = this.#drag;
    if (!drag?.moved) return [];
    if (drag.moves) {
      const clips = this.#placed();
      return drag.moves.flatMap((m) => {
        const clip = clips.get(m.clipId)?.clip;
        return clip ? [{ clip, trackId: m.trackId, at: { ...clip, start: m.start } }] : [];
      });
    }
    return [{ clip: shownClip(drag), trackId: drag.trackId, at: drag.placement }];
  }

  /** What a move or trim is snapped to, while it is, for the guide. */
  get snap(): DragSnap | null {
    const drag = this.#drag;
    if (!drag?.snap) return null;
    const { snap, moves } = drag;
    const clipId = 'clipId' in snap ? snap.clipId : null;
    const trackId = moves?.find((m) => m.clipId === clipId)?.trackId ?? drag.trackId;
    return { at: snap.at, aligned: snap.aligned, trackId };
  }

  /**
   * Presses a Clip by its body, an edge, its gain line or a fade dot, at a
   * point, with modifiers held, as measured for the gain line or the fade
   * dots. Where the dots sit together, the side of their middle pressed
   * says which is grabbed. Its gain line or a fade dot selects it there and
   * then, as clicking it does.
   */
  press(clip: Clip, grip: ClipGrip, at: PointerAt, keys: PressKeys, measured: ClipMeasure = {}) {
    const take = activeTake(clip);
    let mode: ClipDragMode = grip === 'move' && keys.nudges && take ? 'nudge' : grip;
    let grab = at.time - clip.start;
    let rests = 0;
    if (isFadeEnd(grip)) {
      const dots = measured.dots!;
      const end = grabbedFade(grip, at.time, dots.fadeIn, dots.fadeOut, dots.width);
      [mode, grab, rests] = [end, at.time - dots[end], dots.rests];
    }
    this.#drag = {
      clip,
      mode,
      from: { clientX: at.point.clientX, clientY: at.point.clientY },
      grab,
      moved: false,
      trackId: this.#trackOf(clip),
      placement: clip,
      nudge: take?.nudge ?? 0,
      gain: clip.gain,
      gainFrom: { gain: clip.gain, clientY: at.point.clientY, height: measured.waveHeight ?? 0 },
      fades: { fadeIn: clip.fadeIn, fadeOut: clip.fadeOut },
      rests,
      free: keys.free,
      toggles: keys.toggles,
      snap: null,
      moves: null,
      saving: false,
    };
    if (selectsAtPress(grip)) this.#selection.apply({ kind: keys.toggles ? 'toggle' : 'click', clipId: clip.id });
  }

  /**
   * Drags to where the pointer is, with Shift held or not, where that's
   * known: replayed as the lanes scroll along, it isn't. Says whether the
   * press is a drag now, having moved past the slop.
   */
  move(at: DragAt, free?: boolean): boolean {
    const drag = this.#drag;
    if (!drag || drag.saving) return false;
    // A small wobble while clicking or holding still isn't a drag.
    if (!drag.moved && !pastSlop(drag.from, at.point)) return false;
    if (!drag.moved && drag.mode === 'move') {
      // Moving a selected Clip moves the whole Selection; moving another
      // selects it alone. Any other drag leaves the Selection be.
      this.#selection.apply({ kind: 'drag', clipId: drag.clip.id });
      // Another Clip moves alone while the Selection is frozen.
      if (this.#selection.size > 1 && this.#selection.has(drag.clip.id)) drag.moves = [];
    }
    drag.moved = true;
    if (free !== undefined) this.#shiftHeld(drag, free, at);
    this.#place(drag, at);
    return true;
  }

  /**
   * A modifier pressed or let go mid-drag, e.g. Shift: mid-move or
   * mid-trim, it snaps or frees the Clip there and then, where the pointer
   * is, without waiting for it to move; on the gain line, it drags finely,
   * or not, from there on.
   */
  modifier(free: boolean, at: DragAt) {
    const drag = this.#drag;
    if (!drag?.moved || drag.saving) return;
    this.#shiftHeld(drag, free, at);
    if (snaps(drag.mode)) this.#place(drag, at);
  }

  /**
   * Shift held, or not. The gain line goes finely, or not, from the Gain
   * it's at and the pointer's height, so it never jumps.
   */
  #shiftHeld(drag: Drag, free: boolean, at: DragAt) {
    if (drag.mode === 'gain' && free !== drag.free) {
      drag.gainFrom = { ...drag.gainFrom, gain: drag.gain, clientY: at.point.clientY };
    }
    drag.free = free;
  }

  #place(drag: Drag, at: DragAt) {
    const { clip } = drag;
    switch (drag.mode) {
      case 'move':
        if (drag.moves) this.#placeSelection(drag, at);
        else this.#placeMove(drag, at);
        return;
      case 'start':
      case 'end':
        this.#placeTrim(drag, at);
        return;
      case 'nudge':
        drag.nudge = draggedNudge(clip, at.time - drag.grab - clip.start);
        return;
      case 'gain': {
        const { gain, clientY, height } = drag.gainFrom;
        drag.gain = draggedGain(gain, at.point.clientY - clientY, height, drag.free);
        return;
      }
      case 'fadeIn':
      case 'fadeOut': {
        // The dot's middle, in seconds from the Clip's start.
        const dot = at.time - drag.grab - clip.start;
        const { fadeIn, fadeOut } = drag.fades;
        drag.fades =
          drag.mode === 'fadeIn'
            ? { fadeIn: draggedFade(dot, fadeOut, clip.length, drag.rests), fadeOut }
            : { fadeIn, fadeOut: draggedFade(clip.length - dot, fadeIn, clip.length, drag.rests) };
        return;
      }
    }
  }

  /** Moves the selected Clips as one, snapped by any of their edges. */
  #placeSelection(drag: Drag, at: DragAt) {
    const { tracks, reach } = this.#context;
    const { clip } = drag;
    drag.trackId = at.trackId;
    const ids = this.#selection.ids;
    const place = (by: number) => moveSelection(tracks(), ids, clip.id, at.trackId, clip.start + by);
    // How far moveSelection lets the Selection move, as the Clip dragged goes.
    const clamp = (by: number) => place(by).find((m) => m.clipId === clip.id)!.start - clip.start;
    const desired = at.time - drag.grab - clip.start;
    const clips = tracks().flatMap((track) => track.clips.filter((c) => ids.has(c.id)));
    const moved = snapSelection(this.#targets(ids), clips, desired, reach(), clamp, drag.free);
    drag.moves = place(moved.by);
    drag.snap = moved.snap;
  }

  #placeMove(drag: Drag, at: DragAt) {
    const { clip } = drag;
    drag.trackId = at.trackId;
    const others = this.#othersOn(drag.trackId, clip);
    const clamp = (start: number) => clampMove(others, clip.length, start);
    const desired = at.time - drag.grab;
    const moved = drag.free
      ? { start: clamp(desired), snap: null }
      : snapMove(this.#targets(new Set([clip.id])), clip.length, desired, this.#context.reach(), clamp);
    drag.placement = { ...clip, start: moved.start };
    drag.snap = moved.snap;
  }

  #placeTrim(drag: Drag, at: DragAt) {
    const { clip } = drag;
    const t = at.time;
    const others = this.#othersOn(drag.trackId, clip);
    const trimStart = drag.mode === 'start';
    const trim = (to: number) =>
      trimStart ? clampTrimStart(clip, others, to) : clampTrimEnd(clip, others, this.#context.sourceLength(clip), to);
    // Where the edge dragged ends up, trimmed to `to`.
    const edge = (to: number) => {
      const trimmed = trim(to);
      return trimStart ? trimmed.start : trimmed.start + trimmed.length;
    };
    const snapped = drag.free
      ? { at: t, snap: null }
      : snapEdge(this.#targets(new Set([clip.id])), t, this.#context.reach(), edge);
    drag.placement = trim(snapped.at);
    drag.snap = snapped.snap;
  }

  /**
   * Lets go. Pressed and let go without dragging, the Clip is clicked: it's
   * selected alone, or with Mod held as it was pressed, added to the
   * Selection or taken out, unless it was selected as it was grabbed.
   * Gives back the edit to save, or null with nothing changed. A move, a
   * trim or a nudge holds the Clips as they were dropped until told it's
   * saved; anything else ends the drag, as does nothing changed.
   */
  release(): DragSave | null {
    const drag = this.#drag;
    if (!drag || drag.saving) return null;
    drag.snap = null;
    if (!drag.moved && !selectsAtPress(drag.mode)) {
      this.#selection.apply({ kind: drag.toggles ? 'toggle' : 'click', clipId: drag.clip.id });
    }
    const save = drag.moved ? this.#save(drag) : null;
    if (save && holdsDropped(drag.mode)) {
      drag.saving = true;
      this.#held = save;
    } else this.#drag = null;
    return save;
  }

  #save(drag: Drag): DragSave | null {
    const { clip, trackId, placement: to } = drag;
    // Moved or trimmed, the Clip is where it was, on the Track it was on.
    const unchanged = () =>
      trackId === this.#trackOf(clip) &&
      to.start === clip.start &&
      to.offset === clip.offset &&
      to.length === clip.length;
    switch (drag.mode) {
      case 'move':
        if (drag.moves) return this.#saveSelection(drag.moves);
        if (unchanged()) return null;
        return {
          edit: { kind: 'moveClip', clipId: clip.id, trackId, start: to.start },
          moved: { clips: [clip], by: to.start - clip.start },
        };
      case 'start':
      case 'end':
        if (unchanged()) return null;
        return { edit: { kind: 'trimClip', clipId: clip.id, offset: to.offset, length: to.length }, moved: null };
      case 'nudge':
        if (drag.nudge === activeTake(clip)!.nudge) return null;
        return {
          edit: { kind: 'nudgeTake', clipId: clip.id, takeId: clip.activeTakeId!, nudge: drag.nudge },
          moved: null,
        };
      case 'gain':
        if (drag.gain === clip.gain) return null;
        return { edit: { kind: 'setClipGain', clipId: clip.id, gain: drag.gain }, moved: null };
      case 'fadeIn':
      case 'fadeOut': {
        const { fadeIn, fadeOut } = drag.fades;
        if (fadeIn === clip.fadeIn && fadeOut === clip.fadeOut) return null;
        return { edit: { kind: 'setClipFades', clipId: clip.id, fadeIn, fadeOut }, moved: null };
      }
    }
  }

  /** The selected Clips moved together, unless let go where they were. */
  #saveSelection(moves: ClipMove[]): DragSave | null {
    const clips = this.#placed();
    const from = moves.map((m) => clips.get(m.clipId)!);
    if (moves.every((m, i) => m.trackId === from[i].trackId && m.start === from[i].clip.start)) return null;
    return {
      edit: { kind: 'moveClips', moves },
      moved: { clips: from.map((f) => f.clip), by: moves[0].start - from[0].clip.start },
    };
  }

  /**
   * A save released resolved, saved or not: if the drag holds the Clips as
   * they were dropped for it, they're shown as the Timeline has them again.
   * Any other, e.g. a Gain handed over before this drag, leaves it be.
   */
  saved(save: DragSave) {
    if (save !== this.#held) return;
    this.#held = null;
    this.#drag = null;
  }

  /** Gives the press or drag up, e.g. for a long press opening the Clip's menu; not once it's saving. */
  cancel() {
    if (!this.#drag?.saving) this.#drag = null;
  }

  /** What Clips moved or trimmed snap to: the other Clips' edges, the playhead and the Loop's edges. */
  #targets(dragged: ReadonlySet<number>) {
    const { tracks, playhead, loop } = this.#context;
    return editTargets(tracks(), dragged, playhead(), loop());
  }

  /** Every Clip on the Timeline by its id, with the id of the Track it's on. */
  #placed(): Map<number, { clip: Clip; trackId: number }> {
    return new Map(this.#context.tracks().flatMap((t) => t.clips.map((clip) => [clip.id, { clip, trackId: t.id }])));
  }

  #trackOf(clip: Clip): number {
    return this.#context.tracks().find((t) => t.clips.some((c) => c.id === clip.id))!.id;
  }

  /** The other Clips on a Track, which the one dragged can't overlap. */
  #othersOn(trackId: number, clip: Clip): Clip[] {
    return this.#context
      .tracks()
      .find((t) => t.id === trackId)!
      .clips.filter((c) => c.id !== clip.id);
  }
}

/** The Clip dragged, as shown: nudged, or with the Gain or Fades it's dragged to. */
function shownClip(drag: Drag): Clip {
  switch (drag.mode) {
    case 'nudge':
      return nudged(drag.clip, drag.nudge);
    case 'gain':
      return { ...drag.clip, gain: drag.gain };
    case 'fadeIn':
    case 'fadeOut':
      return { ...drag.clip, ...drag.fades };
    default:
      return drag.clip;
  }
}
