// Song undo: the Song's Undo and Redo, made once per Song by the Song page
// alongside Saves, which keeps the edits to undo. The header's buttons and
// the keys both go through it, so they always agree on whether there's
// anything to undo or redo.
//
// - Undo can be pressed while the Song isn't frozen, and there's an edit to
//   undo, typing into a Section not saved yet, or an edit kept to undo
//   still queued. Redo can be pressed while it isn't frozen, and there's an
//   edit to redo. A save that isn't kept to undo, e.g. the title, doesn't
//   count.
// - Pressed, it leaves the text field being typed in, saving what's typed
//   as a step of its own, so Undo undoes it rather than have it land after
//   what's put back; waits for the saves queued; checks the freeze again;
//   then undoes or redoes the step.
// - What follows is the followers': the Timeline reselects Clips and seeks,
//   the Song page shows the Section changed. Each gets the one result; if a
//   recording started since Undo was pressed, it has no playhead.
import type { Freeze } from './freeze';
import type { Saves, Undone } from './saves.svelte';

/** Follows what an undo or a redo did. */
export type UndoFollower = (undone: Undone) => void;

export interface SongUndoOptions {
  /** The Song's saves, which keep the edits to undo. */
  saves: Saves;
  /** Why the Song can't change now, as the Timeline reports it: a recording or a Merge under way, or null. */
  freeze: () => Freeze;
  /** Leaves the text field being typed in, if any, saving what's typed. */
  leaveField: () => void;
}

export class SongUndo {
  #saves: Saves;
  #freeze: () => Freeze;
  #leaveField: () => void;
  #followers = new Set<UndoFollower>();

  constructor(options: SongUndoOptions) {
    this.#saves = options.saves;
    this.#freeze = options.freeze;
    this.#leaveField = options.leaveField;
  }

  /** Whether pressing Undo would do anything. */
  get undoes(): boolean {
    const saves = this.#saves;
    return !this.#frozen() && (saves.canUndo || saves.unsavedInSections || saves.undoablesQueued > 0);
  }

  /** Whether pressing Redo would do anything. */
  get redoes(): boolean {
    return !this.#frozen() && this.#saves.canRedo;
  }

  /**
   * Has a follower follow what each undo and redo does, until the function
   * returned is called, e.g. as its component goes.
   */
  follow = (follower: UndoFollower): (() => void) => {
    this.#followers.add(follower);
    return () => {
      this.#followers.delete(follower);
    };
  };

  /** Undoes the Song's latest edit, if Undo can be pressed. Resolves to what it did, or null if nothing. */
  undo = (): Promise<Undone | null> => this.#step(this.undoes, (go) => this.#saves.undo(go));

  /** Redoes the Song's latest edit undone, like undo. */
  redo = (): Promise<Undone | null> => this.#step(this.redoes, (go) => this.#saves.redo(go));

  async #step(pressable: boolean, send: (go: () => boolean) => Promise<Undone | null>): Promise<Undone | null> {
    if (!pressable) return null;
    this.#leaveField();
    // Saves waits for the saves queued, then asks whether to go on.
    const done = await send(() => !this.#frozen());
    if (!done) return null;
    // A recording keeps the playhead where it started.
    const undone = this.#freeze() === 'recording' ? { ...done, playhead: null } : done;
    for (const follower of [...this.#followers]) follower(undone);
    return undone;
  }

  #frozen(): boolean {
    return this.#freeze() !== null;
  }
}
