// Timeline editing: every edit the Timeline makes, and its undo and redo,
// made once per Timeline on top of Saves, which keeps them to undo. The
// Timeline only draws and sends intents; this keeps the rules around them.
//
// - The freeze: while a recording or a Merge is under way, the Timeline
//   can't be edited, but for a Track's mute, solo or volume (see freeze.ts).
//   The Timeline reads it to disable its controls and refuse drags.
// - The Timeline as shown, which the Timeline draws and plays: the Timeline
//   as saved, with the values of edits on their way and of previews on top,
//   for the edits that set values on a Track or a Clip already there,
//   e.g. a Clip's Gain or Fades, which the Clip drag hands over on
//   release, or on the Loop (see ShownEdit). A preview is a value shown without being
//   sent, e.g. a fader's level while it's dragged, refused whenever the
//   same edit would be. Which value shows goes by field, e.g. a Track's
//   volume, or the Loop: an edit's stops showing once its save resolves,
//   saved or failed, unless something newer for that field is showing, and
//   a preview gives way to the next preview or edit of that field. A Loop
//   switched keeps the stretch shown when it was, even if the set that
//   stretch came from then fails, until the switch resolves. A refresh
//   replacing the Song drops them all; undo and redo leave them be. What's
//   worked out to send (Merge rendering, the Cue-move offer, undo) goes by
//   the Timeline as saved.
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
// - Merge and Sound import, the rarer edits whose audio the browser makes
//   (see the audio port below). Each is kept to undo as placing what it
//   made, so redoing it never renders or uploads anything again.
import type { Clip, Song, SoundImport, Timeline, Track } from './api';
import { addedTrack } from './chosenTrack';
import type { DragSave } from './clipDrag.svelte';
import { sameCues } from './cueChanges';
import { movedCues, type TimeSpan } from './cues';
import { importEach } from './fileDrop';
import { editsWhileRecording, type Freeze } from './freeze';
import { addedClips, mergingAdded, placingAdded, restorable, type Edit } from './history';
import { mergeTarget, mergeWarning, type MergedAudio, type MergeTarget } from './merge';
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

/** An audio file decoded and named, ready to import as a Sound onto a Track. */
export type PreparedSound = Omit<SoundImport, 'trackId'>;

/**
 * The edits shown before they're saved: those setting values on a Track or
 * a Clip already on the Timeline, or on the Loop, which the browser makes
 * exactly as the server will.
 */
export type ShownEdit = Extract<
  Edit,
  { kind: 'updateTrack' | 'renameClip' | 'setClipGain' | 'setClipFades' | 'setLoop' | 'switchLoop' | 'clearLoop' }
>;

/** Sets one field of a Track or a Clip, or the Loop, on a Timeline to the value an edit gives it. */
type SetField = (timeline: Timeline) => Timeline;

/** A value shown over the Timeline as saved, for one field of a Track or a Clip, or the Loop. */
interface ShownValue {
  show: SetField;
  /** The edit or preview it came from, by identity: only that one stops it showing. */
  from: object;
}

/** The audio the browser makes for an edit: the browser's own, or a fake of it. */
export interface TimelineAudio {
  /**
   * Checks an audio file can be imported, decodes it, and names it. Fails
   * with a message to show if it can't be imported.
   */
  prepare(file: File): Promise<PreparedSound>;
  /** Renders the audio of the Clips a Merge merges, from the Timeline as saved. */
  renderMerge(timeline: Timeline, target: MergeTarget): Promise<MergedAudio>;
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
  /** Prepares files to import and renders Merges. */
  audio: TimelineAudio;
}

export class TimelineEditing {
  #saves: Saves;
  #selection: Selection;
  #recording: () => boolean;
  #choose: (trackId: number) => void;
  #audio: TimelineAudio;
  /** Whether a Merge is under way, from pressing Merge until its Sound is saved or it fails. */
  #merging = $state(false);
  /** The Cue-move offer made last, until it lapses or is answered. Raw, so the timer can tell it's still its own. */
  #made = $state.raw<MadeOffer | null>(null);
  #offerTimer: ReturnType<typeof setTimeout> | undefined;
  /** Which Tracks the last Merge left silent, until it's dismissed or the next Merge. */
  #mergeNote = $state<string | null>(null);
  /** What importing an audio file is doing, while it is. */
  #importing = $state<string | null>(null);
  /** Imports run one at a time, in the order they were asked for. */
  #imports: Promise<void> = Promise.resolve();
  /** What the files imported refused said, until a new import or a Merge. */
  #error = $state<string | null>(null);
  /**
   * The values shown over the Timeline as saved, by field, e.g. "track 3
   * volume", and which Song they were set over: they go once a refresh
   * replaces it.
   */
  #shown = $state.raw<{ over: number; values: ReadonlyMap<string, ShownValue> }>({ over: 0, values: new Map() });
  /** The values shown over the Song as it is now. */
  #values = $derived.by(() =>
    this.#shown.over === this.#saves.replaced ? this.#shown.values : new Map<string, ShownValue>(),
  );
  /** The Timeline as shown: as saved, with the values of edits on their way and of previews on top. */
  #timeline = $derived.by(() => [...this.#values.values()].reduce((tl, v) => v.show(tl), this.#saves.timeline));
  /** The offer made last, while the Timeline as saved and the Cues as shown are still the ones it was made for. */
  #standing = $derived.by(() => {
    const made = this.#made;
    if (!made || made.timeline !== this.#saves.timeline || !sameCues(made.song, this.#saves.song)) return null;
    return made;
  });

  constructor(options: TimelineEditingOptions) {
    this.#saves = options.saves;
    this.#selection = options.selection;
    this.#recording = options.recording;
    this.#choose = options.choose;
    this.#audio = options.audio;
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
    const sent = $state.snapshot(e) as Edit;
    const fields = this.#fieldsOf(sent);
    this.#show(fields, sent);
    const edited = await this.#saves.edit(sent);
    this.#unshow(fields, sent);
    if (edited) this.#follow(e, edited);
    return edited;
  };

  /** The Timeline as shown: the Timeline as saved, with the values of edits on their way and of previews on top. */
  get timeline(): Timeline {
    return this.#timeline;
  }

  /**
   * Shows an edit's values without sending it, e.g. a fader's level while
   * it's dragged, until the next preview or edit of the same field.
   * Refused whenever the same edit would be. Returns whether it's shown.
   */
  preview = (e: ShownEdit): boolean => {
    if (this.frozen && !editsWhileRecording(e)) return false;
    const previewed = $state.snapshot(e) as Edit;
    this.#show(this.#fieldsOf(previewed), previewed);
    return true;
  };

  /** How an edit sets each field it shows a value for, over what's shown for that field now. */
  #fieldsOf(e: Edit): Map<string, SetField> {
    return shownFields(e, (field) => this.#values.get(field)?.show);
  }

  /** Shows values over the Timeline as saved, each in place of any shown for its field. */
  #show(fields: Map<string, SetField>, from: object) {
    if (fields.size === 0) return;
    const values = new Map(this.#values);
    for (const [field, show] of fields) values.set(field, { show, from });
    this.#shown = { over: this.#saves.replaced, values };
  }

  /** Stops showing the values an edit or preview set, but for those newer ones showing since. */
  #unshow(fields: Map<string, SetField>, from: object) {
    const values = new Map(this.#values);
    for (const field of fields.keys()) if (values.get(field)?.from === from) values.delete(field);
    if (values.size !== this.#values.size) this.#shown = { over: this.#saves.replaced, values };
  }

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
    if (edited && moved) this.#offerMove(moved, edited.after);
    return edited !== null;
  };

  /** Offers to move the Cues the Clips moved spanned, if any, made for the Timeline the move left. */
  #offerMove({ clips, by }: NonNullable<DragSave['moved']>, timeline: Timeline) {
    if (by === 0) return;
    const spans = clips.map((c) => ({ start: c.start, end: c.start + c.length }));
    const song = this.#saves.song;
    const count = movedCues(song, spans, by).length;
    if (count === 0) return;
    const made: MadeOffer = { offer: { by, count, clips: clips.length }, spans, timeline, song };
    this.#made = made;
    clearTimeout(this.#offerTimer);
    this.#offerTimer = setTimeout(() => {
      if (this.#made === made) this.#made = null;
    }, offerFor);
  }

  /** The offer to move the Cues the Clips just moved spanned, while it stands. */
  get cueOffer(): CueOffer | null {
    return this.#standing?.offer ?? null;
  }

  /**
   * Accepts the Cue-move offer. One Clip's Cues move by its span, as the
   * server finds them. Several Clips' are worked out from the Song as
   * shown, Cue changes not saved yet included, and set, so each moves
   * once, however many of the Clips spanned it. Either way, they move on
   * screen at once.
   */
  moveCues() {
    const made = this.#standing;
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

  /** Whether the Clips selected can be merged now: two or more, all on the Timeline, while it isn't frozen. */
  get mergeable(): boolean {
    return !this.frozen && mergeTarget(this.#saves.timeline.tracks, this.#selection.ids) !== null;
  }

  /**
   * Merges the selected Clips, on any Tracks, into one Clip of a new
   * Sound, rendered from the Timeline as saved once the edits queued
   * before it land, with its Tracks' levels as they are then. Until it's
   * saved, or fails, the Timeline is frozen; if rendering or saving fails,
   * nothing changes, and the save error says why. Once saved, the merged
   * Clip becomes the Selection, its Track the Chosen Track, and the Merge
   * note names any Track that came out silent. It's kept in the history as
   * replacing the Clips with it, so redoing it never renders it again.
   * Resolves to whether it was saved; refused while it can't be merged.
   */
  merge = async (): Promise<boolean> => {
    if (!this.mergeable) return false;
    const clipIds = new Set(this.#selection.ids);
    this.#error = null;
    this.#mergeNote = null;
    // What it says once made, worked out in its turn.
    let note: string | null = null;
    this.#merging = true;
    const made = await this.#saves
      .make(async (at, before, server) => {
        const target = mergeTarget(before.tracks, clipIds);
        if (!target) throw new Error("The Clips to merge aren't all on the Timeline any more.");
        let audio: MergedAudio;
        try {
          audio = await this.#audio.renderMerge(before, target);
        } catch (e) {
          throw new Error(`Couldn't merge the Clips (${(e as Error).message}).`);
        }
        const after = await server.mergeClips(at, audio.wav, {
          clipIds: target.clipIds,
          peaks: audio.peaks,
          ...target.onto,
        });
        note = mergeWarning(target.silent);
        return { timeline: after, kept: mergingAdded(before, after, target.clipIds) };
      })
      .finally(() => (this.#merging = false));
    if (!made) return false;
    const [mergedId] = addedClips(made.before, made.after);
    this.#selection.selectEdited([mergedId]);
    this.#choose(made.after.tracks.find((t) => t.clips.some((c) => c.id === mergedId))!.id);
    this.#mergeNote = note;
    return true;
  };

  /** Which Tracks the last Merge left silent, muted or left out by a solo, until it's dismissed, the next Merge, or an undo or redo. */
  get mergeNote(): string | null {
    return this.#mergeNote;
  }

  /** Dismisses the Merge note. */
  dismissMergeNote() {
    this.#mergeNote = null;
  }

  /**
   * Imports audio files as Sounds onto a Track, each after the last, e.g.
   * from Import audio… or dropped, once the imports asked for before are
   * done; refused while frozen. Each one refused says why in the error as
   * it's refused, and a new import clears what the last ones said, unless
   * one is still under way. Resolves once they're done.
   */
  importFiles = (files: File[], trackId: number): Promise<void> => {
    if (this.frozen) return Promise.resolve();
    if (this.#importing === null) this.#error = null;
    const done = this.#imports.then(async () => {
      await importEach(
        files,
        (file) => this.#importSound(file, trackId),
        (message) => (this.#error = this.#error ? `${this.#error} ${message}` : message),
      );
      this.#importing = null;
    });
    this.#imports = done;
    return done;
  };

  /**
   * Imports an audio file as a Sound, in a new Clip after a Track's last
   * Clip, or at 0:00. Fails with why if the file can't be imported. It's
   * kept in the history as placing that Clip, so redoing it never uploads
   * the file again.
   */
  async #importSound(file: File, trackId: number) {
    this.#importing = `Reading “${file.name}”…`;
    const { name, ...decoded } = await this.#audio.prepare(file);
    this.#importing = `Importing “${name}”…`;
    await this.#saves.make(async (at, before, server) => {
      const after = await server.importSound(at, file, { trackId, name, ...decoded });
      return { timeline: after, kept: placingAdded(before, after) };
    });
  }

  /** What importing an audio file is doing, e.g. "Reading “intro.wav”…", while it is. */
  get importing(): string | null {
    return this.#importing;
  }

  /** What the files imported refused said, until a new import, a Merge, or it's dismissed. */
  get error(): string | null {
    return this.#error;
  }

  /** Dismisses what the files imported refused said. */
  dismissError() {
    this.#error = null;
  }

  /**
   * Whether pressing undo would do anything: not while frozen, and not with
   * nothing to undo, nor any save queued that could be.
   */
  get undoes(): boolean {
    return !this.frozen && (this.#saves.canUndo || this.#saves.pending > 0);
  }

  /** Whether pressing redo would do anything: not while frozen, and not with nothing to redo. */
  get redoes(): boolean {
    return !this.frozen && this.#saves.canRedo;
  }

  /**
   * Undoes the latest edit, once those queued before it land, unless
   * frozen, or with nothing to undo and nothing queued. Clips it brings
   * back together are selected again. Resolves to where to return the
   * playhead to: where a new Take undone started, unless a recording
   * started since. Null to leave it where it is.
   */
  undo = async (): Promise<number | null> => {
    if (!this.undoes) return null;
    this.#mergeNote = null;
    const undone = await this.#saves.undo();
    if (!undone) return null;
    if (undone.reselect) this.#selection.selectEdited(undone.reselect);
    return undone.playhead !== null && !this.#recording() ? undone.playhead : null;
  };

  /** Redoes the latest edit undone, unless frozen; a Merge or a Split redone selects what it did again. */
  redo = async (): Promise<void> => {
    if (!this.redoes) return;
    this.#mergeNote = null;
    const redone = await this.#saves.redo();
    if (redone?.reselect) this.#selection.selectEdited(redone.reselect);
  };

  /** Stops the Cue-move offer's timer, e.g. as the Timeline goes. */
  close() {
    clearTimeout(this.#offerTimer);
  }
}

/**
 * How an edit sets each field it shows a value for, by field, or none for
 * an edit that isn't shown before it's saved. Given what's shown for a
 * field now, e.g. a Loop set but not saved yet, so that switching it keeps
 * that stretch, as the server will once the set lands before it.
 */
function shownFields(e: Edit, shown: (field: string) => SetField | undefined): Map<string, SetField> {
  const fields = new Map<string, SetField>();
  if (e.kind === 'setLoop') {
    const loop = { ...e.loop };
    fields.set('loop', (tl) => ({ ...tl, loop }));
  } else if (e.kind === 'switchLoop') {
    // Switched, it keeps its stretch: the one shown, if any, else as saved.
    const shownLoop = shown('loop');
    fields.set('loop', (tl) => {
      const { loop } = shownLoop ? shownLoop(tl) : tl;
      return { ...tl, loop: loop && { ...loop, on: e.on } };
    });
  } else if (e.kind === 'clearLoop') {
    fields.set('loop', (tl) => ({ ...tl, loop: null }));
  } else if (e.kind === 'updateTrack') {
    const { name, ...levels } = e.changes;
    // As the server saves it, which refuses a blank one.
    const named = name?.trim();
    const changes: Partial<Track> = named ? { ...levels, name: named } : levels;
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      fields.set(`track ${e.trackId} ${key}`, (tl) => withTrack(tl, e.trackId, { [key]: value }));
    }
  } else if (e.kind === 'renameClip') {
    // A blank name clears the Clip's own, as the server saves it.
    const name = e.name.trim() || null;
    fields.set(`clip ${e.clipId} name`, (tl) => withClip(tl, e.clipId, { name }));
  } else if (e.kind === 'setClipGain') {
    const { gain } = e;
    fields.set(`clip ${e.clipId} gain`, (tl) => withClip(tl, e.clipId, { gain }));
  } else if (e.kind === 'setClipFades') {
    // Both Fades are one field, as they're set together.
    const { fadeIn, fadeOut } = e;
    fields.set(`clip ${e.clipId} fades`, (tl) => withClip(tl, e.clipId, { fadeIn, fadeOut }));
  }
  return fields;
}

/** A Timeline with changes made to a Clip, if it's there. */
function withClip(tl: Timeline, clipId: number, changes: Partial<Clip>): Timeline {
  return {
    ...tl,
    tracks: tl.tracks.map((t) =>
      t.clips.some((c) => c.id === clipId)
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...changes } : c)) }
        : t,
    ),
  };
}

/** A Timeline with changes made to a Track, if it's there. */
function withTrack(tl: Timeline, trackId: number, changes: Partial<Track>): Timeline {
  return { ...tl, tracks: tl.tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t)) };
}
