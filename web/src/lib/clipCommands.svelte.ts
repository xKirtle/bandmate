// Clip commands: every Clip and Selection command on the Timeline, run in
// one place, on top of Timeline editing, the Selection, the playhead and the
// Chosen Track. The Timeline's keys, the Clip menu and the Selection menu
// only name a command and what it's for; this runs it, and says whether it
// can run now. It owns the Clipboard, and never touches the page: a Split
// says which Clip should take focus, and the Timeline moves it.
//
// - The target: the Selection, or one Clip, as the caller chooses. With the
//   Selection, a Split with none selected splits the Chosen Track's Clip
//   under the playhead. A paste ignores it, pasting at the playhead on the
//   Chosen Track.
// - The freeze: while a recording or a Merge is under way, no command runs,
//   and `can` says it's frozen (see freeze.ts).
// - The Clipboard: the Clips last copied or cut, as they were then. Like
//   the Selection, it's never kept, so leaving the Song drops it, and undo
//   and redo never change it.
import type { Clip, Track } from './api';
import { copy, duplicate, emptyClipboard, paste, type Clipboard } from './clipboard';
import { clampGain } from './clipGain';
import { pitchOf } from './clipPitch';
import { tempoOf } from './clipTempo';
import type { Edit } from './history';
import { mergeTarget } from './merge';
import type { Edited } from './saves.svelte';
import type { Selection } from './selection.svelte';
import { rightHalfOf, splitTargets } from './split';
import type { TimelineEditing } from './timelineEditing.svelte';

/** What a command acts on: the Selection, or one Clip. */
export type ClipTarget = { kind: 'selection' } | { kind: 'clip'; clipId: number };

/** A Clip or Selection command, and what it acts on. */
export type ClipCommand = { target: ClipTarget } & (
  | { kind: 'copy' }
  /** Copies, then deletes, as one step to undo. */
  | { kind: 'cut' }
  /** Pastes the Clipboard at the playhead on the Chosen Track, whatever the target. */
  | { kind: 'paste' }
  | { kind: 'duplicate' }
  /** Splits at the playhead; `focused` is the Clip that has focus, if any. */
  | { kind: 'split'; focused?: number }
  | { kind: 'delete' }
  /** Merges the Selection into one Clip of a new Sound. */
  | { kind: 'merge' }
  | { kind: 'tempo'; percent: number }
  | { kind: 'pitch'; semitones: number }
  /** Sets one Clip's Gain, in dB. */
  | { kind: 'gain'; gain: number }
  | { kind: 'chooseTake'; takeId: number }
  | { kind: 'deleteTake'; takeId: number }
  /** Sets a Take's nudge, in milliseconds. */
  | { kind: 'nudgeTake'; takeId: number; ms: number }
  | { kind: 'clearInactiveTakes' }
);

export type ClipCommandKind = ClipCommand['kind'];

/**
 * Why a command can't run now: the Timeline is frozen, the target covers
 * no Clip, or not exactly one for a command on one Clip, the playhead
 * crosses none of its Clips to split, they can't be merged, or the
 * Clipboard holds nothing to paste.
 */
export type ClipCommandBlock = 'frozen' | 'noClips' | 'notOneClip' | 'nothingToSplit' | 'cantMerge' | 'nothingToPaste';

/** What a command that ran did: which Clip should take focus, if any. */
export type ClipCommandRan = { focus: number | null };

export interface ClipCommandsOptions {
  /** The Timeline's editing, which every command's edit goes through. */
  editing: TimelineEditing;
  /** The Timeline's Selection. */
  selection: Selection;
  /** Where the playhead is, in seconds. */
  playhead: () => number;
  /** The Chosen Track's id, or null for none. */
  chosen: () => number | null;
}

export class ClipCommands {
  #editing: TimelineEditing;
  #selection: Selection;
  #playhead: () => number;
  #chosen: () => number | null;
  #clipboard = $state.raw<Clipboard>(emptyClipboard);

  constructor(options: ClipCommandsOptions) {
    this.#editing = options.editing;
    this.#selection = options.selection;
    this.#playhead = options.playhead;
    this.#chosen = options.chosen;
  }

  /** The Tracks as shown, which commands work out what to send from. */
  get #tracks(): readonly Track[] {
    return this.#editing.timeline.tracks;
  }

  /** The ids of the Clips a target names, whether or not they're on the Timeline. */
  #idsOf(target: ClipTarget): ReadonlySet<number> {
    return target.kind === 'selection' ? this.#selection.ids : new Set([target.clipId]);
  }

  /** The Clips a target covers that are on the Timeline, in Timeline order. */
  clipsOf = (target: ClipTarget): Clip[] => {
    const ids = this.#idsOf(target);
    return this.#tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  };

  /** The Clips a Split at the playhead would cut, in Timeline order. */
  #splitting(target: ClipTarget): number[] {
    return splitTargets(this.#tracks, this.#idsOf(target), this.#chosen(), this.#playhead());
  }

  /** Whether a command can run now on a target: null if it can, else why not. */
  can = (kind: ClipCommandKind, target: ClipTarget): ClipCommandBlock | null => {
    if (this.#editing.frozen) return 'frozen';
    switch (kind) {
      case 'paste':
        return this.#clipboard.clips.length === 0 ? 'nothingToPaste' : null;
      case 'split':
        return this.#splitting(target).length === 0 ? 'nothingToSplit' : null;
      case 'merge':
        return target.kind === 'selection' && mergeTarget(this.#tracks, this.#selection.ids) !== null
          ? null
          : 'cantMerge';
      case 'gain':
      case 'chooseTake':
      case 'deleteTake':
      case 'nudgeTake':
      case 'clearInactiveTakes': {
        const clips = this.clipsOf(target);
        return clips.length === 0 ? 'noClips' : clips.length > 1 ? 'notOneClip' : null;
      }
      default:
        return this.clipsOf(target).length === 0 ? 'noClips' : null;
    }
  };

  /**
   * Runs a command, unless it can't run now. Resolves to which Clip should
   * take focus, or null if nothing ran: it was refused, changed nothing, or
   * its edit wasn't saved. After a Split, the focused Clip's right half
   * should, unless a recording started since.
   */
  run = async (command: ClipCommand): Promise<ClipCommandRan | null> => {
    const { kind, target } = command;
    if (this.can(kind, target) !== null) return null;
    const ran = (edited: Edited | null) => (edited ? { focus: null } : null);
    switch (command.kind) {
      case 'copy':
        this.#copy(target);
        return { focus: null };
      case 'cut':
        this.#copy(target);
        return ran(await this.#delete(target));
      case 'paste': {
        const pasted = paste(this.#clipboard, this.#tracks, this.#playhead(), this.#chosen()!);
        return pasted ? ran(await this.#editing.edit({ kind: 'pasteClips', ...pasted })) : null;
      }
      case 'duplicate': {
        if (target.kind === 'clip')
          return ran(await this.#editing.edit({ kind: 'duplicateClip', clipId: target.clipId }));
        const copies = duplicate(this.#tracks, this.#selection.ids);
        return copies ? ran(await this.#editing.edit({ kind: 'pasteClips', ...copies })) : null;
      }
      case 'split':
        return this.#split(target, command.focused);
      case 'delete':
        return ran(await this.#delete(target));
      case 'merge':
        return (await this.#editing.merge()) ? { focus: null } : null;
      case 'tempo': {
        const tempo = tempoOf(command.percent);
        const tempos = this.clipsOf(target)
          .filter((c) => c.tempo !== tempo)
          .map((c) => ({ clipId: c.id, tempo }));
        return tempos.length > 0 ? ran(await this.#editing.edit({ kind: 'setClipTempos', tempos })) : null;
      }
      case 'pitch': {
        const pitch = pitchOf(command.semitones);
        const pitches = this.clipsOf(target)
          .filter((c) => c.pitch !== pitch)
          .map((c) => ({ clipId: c.id, pitch }));
        return pitches.length > 0 ? ran(await this.#editing.edit({ kind: 'setClipPitches', pitches })) : null;
      }
      default:
        return ran(await this.#editing.edit(this.#oneClipEdit(command, this.clipsOf(target)[0].id)));
    }
  };

  /** The edit of a command on one Clip. */
  #oneClipEdit(
    command: Extract<ClipCommand, { kind: 'gain' | 'chooseTake' | 'deleteTake' | 'nudgeTake' | 'clearInactiveTakes' }>,
    clipId: number,
  ): Edit {
    switch (command.kind) {
      case 'gain':
        // To the tenth, as a drag sets it.
        return { kind: 'setClipGain', clipId, gain: clampGain(command.gain) };
      case 'chooseTake':
        return { kind: 'chooseTake', clipId, takeId: command.takeId };
      case 'deleteTake':
        return { kind: 'deleteTake', clipId, takeId: command.takeId };
      case 'nudgeTake':
        return { kind: 'nudgeTake', clipId, takeId: command.takeId, nudge: command.ms / 1000 };
      case 'clearInactiveTakes':
        return { kind: 'clearInactiveTakes', clipId };
    }
  }

  /** Copies a target's Clips to the Clipboard. */
  #copy(target: ClipTarget) {
    this.#clipboard = copy(this.#tracks, this.#idsOf(target)) ?? this.#clipboard;
  }

  /** Deletes a target's Clips, as one step. */
  #delete(target: ClipTarget): Promise<Edited | null> {
    if (target.kind === 'clip') return this.#editing.edit({ kind: 'deleteClip', clipId: target.clipId });
    return this.#editing.edit({ kind: 'deleteClips', clipIds: this.clipsOf(target).map((c) => c.id) });
  }

  /**
   * Splits a target's Clips the playhead crosses, as one step; Timeline
   * editing selects the right halves. The focused Clip's right half should
   * take focus, so Delete then trims off what's after the playhead, unless
   * a recording started since, which keeps focus where it is, as it keeps
   * the Selection.
   */
  async #split(target: ClipTarget, focused: number | undefined): Promise<ClipCommandRan | null> {
    const at = this.#playhead();
    const clipIds = this.#splitting(target);
    const edited = await this.#editing.edit({ kind: 'splitClips', clipIds, at });
    if (!edited) return null;
    if (focused === undefined || !clipIds.includes(focused) || this.#editing.freeze === 'recording') {
      return { focus: null };
    }
    return { focus: rightHalfOf(edited.before, edited.after, focused) };
  }
}
