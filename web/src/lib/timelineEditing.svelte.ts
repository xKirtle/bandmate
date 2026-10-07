// Timeline editing: every edit the Timeline makes, and its undo and redo,
// made once per Timeline on top of Saves, which keeps them to undo. The
// Timeline only draws and sends intents; this keeps the rules around them.
//
// - The freeze: while a recording or a Merge is under way, the Timeline
//   can't be edited, but for a Track's mute, solo or volume (see freeze.ts).
//   The Timeline reads it to disable its controls and refuse drags.
// - What follows an edit: Clips it adds are selected, and a Track it adds
//   chosen. An undo says where to return the playhead to, and the Timeline
//   seeks there, as playback is its own.
// - The Cue-move offer: Cues are Timeline times and stay put, but those the
//   Clips moved spanned may belong with them, so moving them along is
//   offered, as a step of its own, for a few seconds. It stands only while
//   the Timeline as saved and the Cues as shown are the ones it was made
//   for, so whatever changes either, an edit, an undo, a Take or a Cue
//   change, withdraws it once it lands. Ignoring it leaves them where they
//   were: after recording, they usually belong to the vocal rather than
//   the Beat.
import type { Song, Timeline } from './api';
import { addedTrack } from './chosenTrack';
import type { DragSave } from './clipDrag.svelte';
import { sameCues } from './cueChanges';
import { movedCues, type TimeSpan } from './cues';
import { editsWhileRecording, type Freeze } from './freeze';
import { addedClips, restorable, type Edit } from './history';
import type { Edited, Saves } from './saves.svelte';
import type { Selection } from './selection.svelte';
import { rightHalves } from './split';

/** How long the Cue-move offer stands, in milliseconds. */
export const offerFor = 8000;

/** The offer to move the Cues the Clips moved spanned along with them. */
export interface CueOffer {
  /** How far the Clips moved, in seconds: later if positive. */
  by: number;
  /** How many Cues would move. */
  count: number;
  /** How many Clips moved. */
  clips: number;
}

/** A Cue-move offer, and what it was made for. */
interface MadeOffer {
  offer: CueOffer;
  /** Where the Clips moved were, each from its start to its end, in seconds. */
  spans: TimeSpan[];
  /** The Timeline as saved, and the Song as shown, when it was made. */
  timeline: Timeline;
  song: Song;
}

export interface TimelineEditingOptions {
  /** The Song's saves, which every edit goes through. */
  saves: Saves;
  /** The Timeline's Selection, which edits that add Clips select. */
  selection: Selection;
  /** Whether a recording is on, from pressing Record until its Take is saved. */
  recording: () => boolean;
  /** Chooses a Track, e.g. one just added. */
  choose: (trackId: number) => void;
}

export class TimelineEditing {
  #saves: Saves;
  #selection: Selection;
  #recording: () => boolean;
  #choose: (trackId: number) => void;
  /** Whether a Merge is under way, from pressing Merge until its Sound is saved or it fails. */
  #merging = $state(false);
  // Raw, so the timer can tell whether the offer made is still its own.
  #made = $state.raw<MadeOffer | null>(null);
  #offerTimer: ReturnType<typeof setTimeout> | undefined;
  #offer = $derived.by(() => {
    const made = this.#made;
    if (!made || made.timeline !== this.#saves.timeline || !sameCues(made.song, this.#saves.song)) return null;
    return made.offer;
  });

  constructor(options: TimelineEditingOptions) {
    this.#saves = options.saves;
    this.#selection = options.selection;
    this.#recording = options.recording;
    this.#choose = options.choose;
  }

  /** Why the Timeline can't be edited: a recording or a Merge under way, or null while it can be. */
  get freeze(): Freeze {
    return this.#recording() ? 'recording' : this.#merging ? 'merging' : null;
  }

  /** Whether the Timeline can't be edited, but for a Track's levels. */
  get frozen(): boolean {
    return this.freeze !== null;
  }

  /**
   * Queues an edit, to undo later, unless frozen. Resolves to what it did,
   * or null if it was refused or wasn't saved.
   */
  edit = async (e: Edit): Promise<Edited | null> => {
    if (this.frozen && !editsWhileRecording(e)) return null;
    const edited = await this.#saves.edit($state.snapshot(e) as Edit);
    if (edited) this.#follow(e, edited);
    return edited;
  };

  /**
   * What follows an edit once it's saved: a paste or a Selection Duplicate
   * selects the Clips it made, a Split its right halves, and a Track
   * added is chosen, now it's on the Timeline to choose.
   */
  #follow(e: Edit, { before, after }: Edited) {
    switch (e.kind) {
      case 'pasteClips':
        return this.#selection.selectEdited(addedClips(before, after));
      case 'splitClips':
        return this.#selection.selectEdited(rightHalves(before, after));
      case 'addTrack': {
        const added = addedTrack(before.tracks, after.tracks);
        if (added !== null) this.#choose(added);
      }
    }
  }

  /**
   * Saves a Clip drag's edit, and for a move over Cues, offers to move
   * them along. Resolves to whether it was saved.
   */
  saveDrag = async ({ edit, moved }: DragSave): Promise<boolean> => {
    const edited = await this.edit(edit);
    if (edited && moved) this.#offerMove(moved.clips, moved.by, edited.after);
    return edited !== null;
  };

  #offerMove(moved: readonly { start: number; length: number }[], by: number, timeline: Timeline) {
    if (by === 0) return;
    const spans = moved.map((c) => ({ start: c.start, end: c.start + c.length }));
    const song = this.#saves.song;
    const count = movedCues(song, spans, by).length;
    if (count === 0) return;
    const made: MadeOffer = { offer: { by, count, clips: moved.length }, spans, timeline, song };
    this.#made = made;
    clearTimeout(this.#offerTimer);
    this.#offerTimer = setTimeout(() => {
      if (this.#made === made) this.#made = null;
    }, offerFor);
  }

  /** The offer to move the Cues the Clips just moved spanned, while it stands. */
  get cueOffer(): CueOffer | null {
    return this.#offer;
  }

  /**
   * Accepts the Cue-move offer. One Clip's Cues move by its span, as the
   * server finds them. Several Clips' are worked out from the Song as
   * shown, Cue changes not saved yet included, and set, so each moves
   * once, however many of the Clips spanned it. Either way, they move on
   * screen at once.
   */
  moveCues() {
    const made = this.#offer && this.#made;
    if (!made) return;
    this.#made = null;
    const { spans, offer } = made;
    const what = `moving the Cues with ${offer.clips === 1 ? 'the Clip' : 'the Clips'}`;
    const song = this.#saves.song;
    if (spans.length === 1) void this.#saves.cue({ kind: 'shiftCues', ...spans[0], by: offer.by }, what);
    else void this.#saves.cue({ kind: 'restoreCues', cues: restorable(movedCues(song, spans, offer.by), song) }, what);
  }

  /** Leaves the Cues where they are, dismissing the Cue-move offer. */
  leaveCues() {
    this.#made = null;
  }

  /** Freezes the Timeline for a Merge while its work runs, until it's saved or fails. */
  whileMerging = async <T>(work: () => Promise<T>): Promise<T> => {
    this.#merging = true;
    try {
      return await work();
    } finally {
      this.#merging = false;
    }
  };

  /**
   * Undoes the latest edit, once those queued before it land, unless
   * frozen, or with nothing to undo and nothing queued. Clips it brings
   * back together are selected again. Resolves to where to return the
   * playhead to: where a new Take undone started, unless a recording
   * started since. Null to leave it where it is.
   */
  undo = async (): Promise<number | null> => {
    if (this.frozen || (!this.#saves.canUndo && this.#saves.pending === 0)) return null;
    const undone = await this.#saves.undo();
    if (!undone) return null;
    if (undone.reselect) this.#selection.selectEdited(undone.reselect);
    return undone.playhead !== null && !this.#recording() ? undone.playhead : null;
  };

  /** Redoes the latest edit undone, unless frozen; a Merge or a Split redone selects what it did again. */
  redo = async (): Promise<void> => {
    if (this.frozen || !this.#saves.canRedo) return;
    const redone = await this.#saves.redo();
    if (redone?.reselect) this.#selection.selectEdited(redone.reselect);
  };

  /** Stops the Cue-move offer's timer, e.g. as the Timeline goes. */
  close() {
    clearTimeout(this.#offerTimer);
  }
}
