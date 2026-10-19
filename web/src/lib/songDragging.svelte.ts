import type { SongSummary } from './api';
import { GripDragging, type At } from './gripDragging.svelte';
import { longPressDelay, type Point } from './press';
import {
  listEdgeSpeed,
  pressSong,
  songDrop,
  songStep,
  type SongInput,
  type SongPress,
  type SongTarget,
} from './songDrag';

/** The attribute marking where a Song drops: a Folder's id, or empty for no Folder. */
const targetAttribute = 'data-song-target';

/** The attribute for a place a Song drops on, into `folder`, or out to none for null. */
export function songTarget(folder: number | null) {
  return { [targetAttribute]: folder === null ? '' : String(folder) };
}

// On the Songs page, a Song is dragged by its row onto a Folder's row, or,
// inside a Folder, onto the "Songs" link to take it out. With a mouse the
// drag starts once the pointer moves past the slop, so a click still opens
// the Song; with a finger, once it's held still, so a tap still opens it
// and a swipe still scrolls. Pointer events rather than HTML5 drag and
// drop, which touch doesn't have, so Esc cancels and the list scrolls when
// the drag nears its edges.
//
// The drag under way is gripDragging's, with the Songs' rule for where it
// drops handed to it; a Song's row is no grip, so telling a drag from a
// click or a tap, and the scrolling that follows it, stay here. It has no
// rows to measure either: what a Song drops on is whatever row of the page
// is under the pointer.
export class SongDragging extends GripDragging<SongSummary, SongTarget, SongTarget> {
  #inView: () => { top: number; bottom: number };
  #onDrop: (song: SongSummary, to: number | null) => void;
  #press: { press: SongPress; song: SongSummary; pointerId: number; timer: number } | null = null;
  #frame = 0;

  /**
   * `enabled` says whether there's anywhere for a Song to drop; it turning
   * false mid-drag, e.g. as a search lists every Song, cancels the drag.
   * `inView` is where the list is in view down the window, between the
   * header and the tab bar, for the drag to scroll it near its edges.
   * `onDrop` moves a dropped Song into a Folder, or out to none for null.
   */
  constructor(
    enabled: () => boolean,
    inView: () => { top: number; bottom: number },
    onDrop: (song: SongSummary, to: number | null) => void,
  ) {
    super({ enabled });
    this.#inView = inView;
    this.#onDrop = onDrop;
  }

  // What's under the pointer, which is where the Song drops if it's a place
  // Songs drop on: measured from the page itself rather than rows attached
  // here, as a Folder's row, the "Songs" link and the list all are.
  protected targetAt(_song: SongSummary, at: At): SongTarget | null {
    const el = document.elementFromPoint(at.x, at.y)?.closest(`[${targetAttribute}]`);
    const to = el?.getAttribute(targetAttribute);
    return to === undefined || to === null ? null : { folder: to === '' ? null : Number(to) };
  }

  // Dropped there, the Song moves into that Folder, or, on the "Songs" link
  // inside one, out of it; nowhere if it's the Folder it's already in.
  protected dropFor(song: SongSummary, target: SongTarget | null): SongTarget | null {
    return songDrop(song.folderId, target);
  }

  /** Whether a drop now would land on `folder`, or for null, out of the Folder open. */
  aimsAt(folder: number | null): boolean {
    return this.drop?.folder === folder;
  }

  /** Whether `song` is being dragged. */
  drags(song: SongSummary): boolean {
    return this.current?.dragged.id === song.id;
  }

  override cancel() {
    if (this.#press) clearTimeout(this.#press.timer);
    this.#press = null;
    super.cancel();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    document.documentElement.classList.remove('dragging-song');
    window.removeEventListener('pointermove', this.#move);
    window.removeEventListener('pointerup', this.#up);
    window.removeEventListener('pointercancel', this.#cancelled);
    window.removeEventListener('keydown', this.#key);
  }

  /** The handlers for a Song's row, which drag it. */
  row(song: SongSummary) {
    return {
      onpointerdown: (e: PointerEvent) => this.#down(e, song),
      // A finger held on a link would open the browser's menu for it.
      oncontextmenu: (e: MouseEvent) => {
        if (this.#press?.press.phase === 'holding' || this.current) e.preventDefault();
      },
      // Nor does the browser drag the row's link or Cover away itself.
      ondragstart: (e: DragEvent) => {
        if (this.on) e.preventDefault();
      },
    };
  }

  /**
   * Attaches to the list: once a finger's drag is under way, moving it
   * drags the Song rather than scrolling. Attached before the touch starts,
   * as the browser decides then whether the touch can scroll.
   */
  stopTouchScrolling = (el: HTMLElement) => {
    const stop = (e: TouchEvent) => {
      if (this.current) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  };

  #down(e: PointerEvent, song: SongSummary) {
    if (!this.on || !e.isPrimary || e.button !== 0 || this.#press || this.current) return;
    if ((e.target as Element).closest('button, [role="menu"]')) return;
    const touch = e.pointerType === 'touch';
    // Not selecting the row's text, or dragging its link away, as the mouse moves.
    if (!touch) e.preventDefault();
    const press = pressSong(e, touch);
    const timer = press.phase === 'holding' ? window.setTimeout(this.#hold, longPressDelay) : 0;
    this.#press = { press, song, pointerId: e.pointerId, timer };
    window.addEventListener('pointermove', this.#move);
    window.addEventListener('pointerup', this.#up);
    window.addEventListener('pointercancel', this.#cancelled);
    window.addEventListener('keydown', this.#key);
  }

  #input(input: SongInput, at: Point) {
    const pressing = this.#press;
    if (!pressing) return;
    const { press, outcome } = songStep(pressing.press, input);
    if (press) pressing.press = press;
    switch (outcome) {
      case 'wait':
        return;
      case 'drag':
        if (!this.current) this.#start(pressing.song);
        this.aim(at.clientX, at.clientY);
        return;
      case 'drop': {
        // Dropped only where it moves the Song, if anywhere.
        const drop = this.drop;
        this.cancel();
        this.#swallowClick();
        if (drop) this.#onDrop(pressing.song, drop.folder);
        return;
      }
      case 'giveUp':
        this.cancel();
        return;
    }
  }

  // Shows the drag, and scrolls the list while it's near an edge, aiming
  // again at what scrolls under the pointer.
  #start(song: SongSummary) {
    this.current = { dragged: song, target: null, x: 0, y: 0 };
    document.documentElement.classList.add('dragging-song');
    getSelection()?.removeAllRanges();
    let last = performance.now();
    const step = (now: number) => {
      if (!this.current) return;
      const { top, bottom } = this.#inView();
      const speed = listEdgeSpeed(this.current.y, top, bottom);
      if (speed !== 0) {
        window.scrollBy(0, (speed * (now - last)) / 1000);
        this.aim(this.current.x, this.current.y);
      }
      last = now;
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  // A drag let go over its own row would click it, opening the Song.
  #swallowClick() {
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
  }

  // Held still, a finger starts dragging the Song, with a buzz where the
  // device has one.
  #hold = () => {
    if (!this.#press) return;
    navigator.vibrate?.(15);
    this.#input({ kind: 'hold' }, this.#press.press.from);
  };

  #move = (e: PointerEvent) => {
    if (e.pointerId === this.#press?.pointerId) this.#input({ kind: 'move', at: e }, e);
  };

  #up = (e: PointerEvent) => {
    if (e.pointerId === this.#press?.pointerId) this.#input({ kind: 'lift' }, e);
  };

  #cancelled = (e: PointerEvent) => {
    if (e.pointerId === this.#press?.pointerId) this.#input({ kind: 'cancel' }, e);
  };

  // Esc cancels the drag, and the pointer let go after it clicks nothing.
  #key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.#press) return;
    const { pointerId } = this.#press;
    const dragging = this.current !== null;
    this.cancel();
    if (!dragging) return;
    e.preventDefault();
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.#swallowClick();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
}
