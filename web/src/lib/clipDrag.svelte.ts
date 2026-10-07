import type { Clip, ClipMove, Track } from './api';
import { clampMove, clampTrimEnd, clampTrimStart, draggedNudge, moveSelection, nudged } from './clipEdit';
import { activeTake } from './clipSource';
import type { Edit } from './history';
import { pastSlop, type Point } from './press';
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
// nudges its active Take within it. It stops at its neighbours, the
// source's ends and 0:00 as it goes, and is saved on release. Until the
// save resolves, the Clip is shown where it was dropped. Moved or trimmed,
// it snaps to other Clips' edges, the playhead and the Loop's edges,
// unless Shift is held; the Selection, moved together, snaps by any of its
// Clips' edges to those of Clips outside it.
//
// It works in seconds and Tracks: the Timeline measures the page, listens
// to the pointer, scrolls at the edges, saves and offers to move the Cues.

/** Where a Clip is pressed: its body, to move it, or its start or end edge, to trim it. */
export type ClipGrip = 'move' | 'start' | 'end';

/** What a Clip drag does: move the Clip (or the Selection), trim either edge, or nudge its active Take. */
export type ClipDragMode = ClipGrip | 'nudge';

/** Where the pointer is, as the Timeline measures it. */
export interface DragAt {
  /** On the page, to tell a click from a drag. */
  point: Point;
  /** The time under it across the lanes, in seconds, which may be past the end. */
  time: number;
  /** The Track whose lane is nearest to it. */
  trackId: number;
}

/** The modifiers held as a Clip is pressed. */
export interface PressKeys {
  /** Shift, to move or trim without snapping. */
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
  edit: Extract<Edit, { kind: 'moveClip' | 'moveClips' | 'trimClip' | 'nudgeTake' }>;
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
  /** How far into the Clip it was grabbed, in seconds. */
  grab: number;
  moved: boolean;
  /** The Track it's shown on now. */
  trackId: number;
  /** Where it's shown now. */
  placement: Placed;
  /** Where its active Take is nudged to, for a nudge. */
  nudge: number;
  /** Whether Shift is held, to move or trim without snapping. */
  free: boolean;
  /** Whether Mod was held as it was pressed, so a click adds it to the Selection or takes it out. */
  toggles: boolean;
  /** What a move or trim is snapped to, with the lanes of what's there, while it is; for the Selection, by which Clip. */
  snap: Snap<Aligned> | SelectionSnap<Aligned> | null;
  /** Where every selected Clip is shown, when the Selection is moved together; null for one Clip. */
  moves: ClipMove[] | null;
  saving: boolean;
}

/** A Clip drag on a Timeline, from press to release, and until its save resolves. */
export class ClipDrag {
  #drag = $state<Drag | null>(null);
  #selection: Selection;
  #context: DragContext;

  /** Over a Timeline, applying drag, click and toggle to its Selection. */
  constructor(selection: Selection, context: DragContext) {
    this.#selection = selection;
    this.#context = context;
  }

  /** The Clip pressed, while it's pressed, dragged or saving. */
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

  /** Whether it's been let go, and its edit is saving. */
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
    const clip = drag.mode === 'nudge' ? nudged(drag.clip, drag.nudge) : drag.clip;
    return [{ clip, trackId: drag.trackId, at: drag.placement }];
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

  /** Presses a Clip by its body or an edge, at a point, with modifiers held. */
  press(clip: Clip, grip: ClipGrip, at: Pick<DragAt, 'point' | 'time'>, keys: PressKeys) {
    const trackId = this.#trackOf(clip);
    const take = activeTake(clip);
    this.#drag = {
      clip,
      mode: grip === 'move' && keys.nudges && take ? 'nudge' : grip,
      from: { clientX: at.point.clientX, clientY: at.point.clientY },
      grab: at.time - clip.start,
      moved: false,
      trackId,
      placement: clip,
      nudge: take?.nudge ?? 0,
      free: keys.free,
      toggles: keys.toggles,
      snap: null,
      moves: null,
      saving: false,
    };
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
      // selects it alone. A trim or a nudge leaves the Selection be.
      this.#selection.apply({ kind: 'drag', clipId: drag.clip.id });
      // Another Clip moves alone while the Selection is frozen.
      if (this.#selection.size > 1 && this.#selection.has(drag.clip.id)) drag.moves = [];
    }
    drag.moved = true;
    if (free !== undefined) drag.free = free;
    this.#place(drag, at);
    return true;
  }

  /**
   * A modifier pressed or let go mid-move or mid-trim, e.g. the Shift that
   * skips snapping, snaps or frees the Clip there and then, where the
   * pointer is, without waiting for it to move.
   */
  modifier(free: boolean, at: DragAt) {
    const drag = this.#drag;
    if (!drag?.moved || drag.mode === 'nudge' || drag.saving) return;
    drag.free = free;
    this.#place(drag, at);
  }

  #place(drag: Drag, at: DragAt) {
    const { tracks, reach } = this.#context;
    const { clip } = drag;
    const t = at.time;
    if (drag.mode === 'nudge') {
      drag.nudge = draggedNudge(clip, t - drag.grab - clip.start);
    } else if (drag.moves) {
      // Selected Clips move as one, snapped by any of their edges.
      drag.trackId = at.trackId;
      const ids = this.#selection.ids;
      const place = (by: number) => moveSelection(tracks(), ids, clip.id, at.trackId, clip.start + by);
      // How far moveSelection lets the Selection move, as the Clip dragged goes.
      const clamp = (by: number) => place(by).find((m) => m.clipId === clip.id)!.start - clip.start;
      const desired = t - drag.grab - clip.start;
      const clips = tracks().flatMap((track) => track.clips.filter((c) => ids.has(c.id)));
      const moved = snapSelection(this.#targets(ids), clips, desired, reach(), clamp, drag.free);
      drag.moves = place(moved.by);
      drag.snap = moved.snap;
    } else if (drag.mode === 'move') {
      drag.trackId = at.trackId;
      const others = this.#othersOn(drag.trackId, clip);
      const clamp = (start: number) => clampMove(others, clip.length, start);
      const desired = t - drag.grab;
      const moved = drag.free
        ? { start: clamp(desired), snap: null }
        : snapMove(this.#targets(new Set([clip.id])), clip.length, desired, reach(), clamp);
      drag.placement = { ...clip, start: moved.start };
      drag.snap = moved.snap;
    } else {
      const others = this.#othersOn(drag.trackId, clip);
      const trimStart = drag.mode === 'start';
      const trim = (to: number) =>
        trimStart ? clampTrimStart(clip, others, to) : clampTrimEnd(clip, others, this.#context.sourceLength(clip), to);
      // Where the edge dragged ends up, trimmed to `to`.
      const edge = (to: number) => {
        const trimmed = trim(to);
        return trimStart ? trimmed.start : trimmed.start + trimmed.length;
      };
      const snapped = drag.free ? { at: t, snap: null } : snapEdge(this.#targets(new Set([clip.id])), t, reach(), edge);
      drag.placement = trim(snapped.at);
      drag.snap = snapped.snap;
    }
  }

  /**
   * Lets go. Pressed and let go without dragging, the Clip is clicked: it's
   * selected alone, or with Mod held as it was pressed, added to the
   * Selection or taken out. Gives back the edit to save, holding the Clips
   * where they were dropped until told it's saved, or null with nothing
   * changed, ending the drag.
   */
  release(): DragSave | null {
    const drag = this.#drag;
    if (!drag || drag.saving) return null;
    drag.snap = null;
    if (!drag.moved) this.#selection.apply({ kind: drag.toggles ? 'toggle' : 'click', clipId: drag.clip.id });
    const save = drag.moved ? this.#save(drag) : null;
    if (save) drag.saving = true;
    else this.#drag = null;
    return save;
  }

  #save(drag: Drag): DragSave | null {
    const { clip, trackId, placement: to, mode } = drag;
    if (mode === 'nudge') {
      if (drag.nudge === activeTake(clip)!.nudge) return null;
      return {
        edit: { kind: 'nudgeTake', clipId: clip.id, takeId: clip.activeTakeId!, nudge: drag.nudge },
        moved: null,
      };
    }
    if (drag.moves) {
      const { moves } = drag;
      const clips = this.#placed();
      const from = moves.map((m) => clips.get(m.clipId)!);
      if (moves.every((m, i) => m.trackId === from[i].trackId && m.start === from[i].clip.start)) return null;
      return {
        edit: { kind: 'moveClips', moves },
        moved: { clips: from.map((f) => f.clip), by: moves[0].start - from[0].clip.start },
      };
    }
    const unchanged =
      trackId === this.#trackOf(clip) &&
      to.start === clip.start &&
      to.offset === clip.offset &&
      to.length === clip.length;
    if (unchanged) return null;
    if (mode !== 'move') {
      return { edit: { kind: 'trimClip', clipId: clip.id, offset: to.offset, length: to.length }, moved: null };
    }
    return {
      edit: { kind: 'moveClip', clipId: clip.id, trackId, start: to.start },
      moved: { clips: [clip], by: to.start - clip.start },
    };
  }

  /** Its save resolved, saved or not: the Clips are shown as the Timeline has them again. */
  saved() {
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
