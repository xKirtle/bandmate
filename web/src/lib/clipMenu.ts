import type { Clip } from './api';
import { maxGain, minGain } from './clipGain';
import { maxPitch, minPitch } from './clipPitch';
import { maxTempo, minTempo, tempoPercent } from './clipTempo';
import { activeTake } from './clipSource';
import { editHint, type Freeze } from './freeze';
import type { MenuAction } from './menu';
import type { ClipCommand, ClipCommandKind, ClipCommands, ClipTarget } from './clipCommands.svelte';
import CircleDot from '@lucide/svelte/icons/circle-dot';
import Copy from '@lucide/svelte/icons/copy';
import CopyPlus from '@lucide/svelte/icons/copy-plus';
import Eraser from '@lucide/svelte/icons/eraser';
import Gauge from '@lucide/svelte/icons/gauge';
import Diff from '@lucide/svelte/icons/diff';
import Download from '@lucide/svelte/icons/download';
import Layers from '@lucide/svelte/icons/layers';
import Merge from '@lucide/svelte/icons/merge';
import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
import Pencil from '@lucide/svelte/icons/pencil';
import Piano from '@lucide/svelte/icons/piano';
import Scissors from '@lucide/svelte/icons/scissors';
import SquareSplitHorizontal from '@lucide/svelte/icons/square-split-horizontal';
import X from '@lucide/svelte/icons/x';

// A Clip's menu, opened by its ⋯, right-click, the Menu key, Shift+F10 or a
// long press: its entries, in the order they're listed. Deleting a Clip,
// setting its Gain, Tempo, Pitch or Nudge, or choosing, deleting and clearing its Takes,
// don't ask first: they can be undone, and a deleted Take is only detached.
// Split at playhead is always listed, but off while the playhead crosses
// no Clip it would split. Retake is off for a Clip whose Tempo isn't 100%
// or whose Pitch isn't 0, as a Take is recorded as it's sung.
// While recording, the entries that edit are shown off, and only the
// downloads run.
//
// The Clip and Selection commands run through Clip commands (see
// clipCommands.svelte.ts), which say whether each can run now; the menu
// says why one is off while frozen, or with nothing to split. The page runs the rest: Retake, Rename and the
// downloads.

/** The Clip commands a menu runs, and asks whether each can run now. */
export type ClipMenuCommands = Pick<ClipCommands, 'run' | 'can' | 'clipsOf'>;

/** What the Clip's menu needs to know besides the Clip. */
export type ClipMenuState = {
  /** A Take could start recording: stopped, and out of Sync mode. */
  canRecord: boolean;
  /** The name of the Sound a Clip of a Sound plays, or null for another Clip. */
  soundName: string | null;
  /** The keys that nudge a Clip's audio by dragging it, as shown, or null for none. */
  nudgeKeys: string | null;
  /** The keys that copy, as shown, or null for none. */
  copyKeys: string | null;
  /** The keys that cut, as shown, or null for none. */
  cutKeys: string | null;
  /** The keys that split, as shown, or null for none. */
  splitKeys: string | null;
  /** How many Clips are selected. With several, no Retake is offered. */
  selected: number;
  /**
   * A recording or a Merge is under way, so nothing's edited, or null: what
   * an entry off while frozen says, and whether Rename is off.
   */
  frozen: Freeze;
};

/** What the page runs from a Clip's menu, rather than Clip commands. */
export type ClipPageRun = {
  retake: () => void;
  downloadTake: (takeId: number) => void;
  rename: () => void;
  downloadSound: (soundId: number) => void;
};

/** A Clip command, but for its target. */
type ClipCommandOn = ClipCommand extends infer C ? (C extends ClipCommand ? Omit<C, 'target'> : never) : never;

/** Marks an entry off while its command can't run, saying why. */
type CommandEntry = (kind: ClipCommandKind, action: MenuAction, whyNot?: string) => MenuAction;

/** The entries of a Clip's menu. */
export function clipActions(
  clip: Clip,
  state: ClipMenuState,
  commands: ClipMenuCommands,
  page: ClipPageRun,
): MenuAction[] {
  const { soundId } = clip;
  const target: ClipTarget = { kind: 'clip', clipId: clip.id };
  const command = commandEntry(commands, target, state.frozen);
  const run = runOn(commands, target);
  return [
    ...takeActions(clip, state, commands, page),
    editing(state.frozen)({ icon: Pencil, label: 'Rename', title: 'Or double-click the Clip', run: page.rename }),
    command('gain', {
      icon: Diff,
      label: 'Gain',
      title: 'How much louder or quieter the Clip plays, in dB; or drag its gain line',
      field: {
        value: clip.gain,
        unit: 'dB',
        step: 0.5,
        shiftStep: 3,
        min: minGain,
        max: maxGain,
        set: (gain) => void commands.run({ kind: 'gain', target, gain }),
      },
    }),
    ...stretchActions(clip, commands, target, command),
    command(
      'nudge',
      nudgeAction(clip.nudge, state.nudgeKeys, (ms) => {
        void commands.run({ kind: 'nudge', target, ms });
      }),
    ),
    ...clipboardActions(command, state, run),
    command('duplicate', { icon: CopyPlus, label: 'Duplicate', run: run({ kind: 'duplicate' }) }),
    command('split', splitAction(state, run({ kind: 'split' })), 'Move the playhead into the Clip to split it'),
    ...(soundId !== null
      ? [
          {
            icon: Download,
            label: 'Download Sound',
            title: `Save “${state.soundName}” as it was imported`,
            run: () => page.downloadSound(soundId),
          },
        ]
      : []),
    command('delete', { icon: X, label: 'Delete Clip', run: run({ kind: 'delete' }) }),
  ];
}

/** Runs a command on a target, as an entry's run. */
function runOn(commands: ClipMenuCommands, target: ClipTarget): (c: ClipCommandOn) => () => void {
  return (c) => () => void commands.run({ ...c, target } as ClipCommand);
}

/**
 * Marks an entry of a command off while it can't run on the target,
 * saying why: frozen, it says so, and with nothing to split, `whyNot`.
 */
function commandEntry(commands: ClipMenuCommands, target: ClipTarget, freeze: Freeze): CommandEntry {
  return (kind, action, whyNot) => {
    const block = commands.can(kind, target);
    if (block === null) return action;
    const title =
      block === 'frozen' ? editHint(freeze, action.title) : block === 'nothingToSplit' ? whyNot : action.title;
    return { ...action, disabled: true, title };
  };
}

/**
 * The Tempo and Pitch entries, starting at the Clip's, each offering its
 * reset while any Clip the target covers isn't there already.
 */
function stretchActions(
  clip: Clip,
  commands: ClipMenuCommands,
  target: ClipTarget,
  command: CommandEntry,
): MenuAction[] {
  const clips = commands.clipsOf(target);
  return [
    command(
      'tempo',
      tempoAction(
        clip.tempo,
        clips.some((c) => c.tempo !== 1),
        (percent) => void commands.run({ kind: 'tempo', target, percent }),
      ),
    ),
    command(
      'pitch',
      pitchAction(
        clip.pitch,
        clips.some((c) => c.pitch !== 0),
        (semitones) => void commands.run({ kind: 'pitch', target, semitones }),
      ),
    ),
  ];
}

/**
 * The Tempo entry, typed in whole percent, starting at tempo, with a reset
 * to 100% offered while `changed`.
 */
function tempoAction(tempo: number, changed: boolean, set: (percent: number) => void): MenuAction {
  return {
    icon: Gauge,
    label: 'Tempo',
    title: 'How fast the Clip plays, in percent of as recorded, without changing its Pitch',
    field: {
      value: tempoPercent(tempo),
      unit: '%',
      step: 1,
      shiftStep: 10,
      min: tempoPercent(minTempo),
      max: tempoPercent(maxTempo),
      reset: { value: 100, label: 'Reset to 100%', offered: changed },
      set,
    },
  };
}

/**
 * The Pitch entry, typed in whole semitones, starting at pitch, with a
 * reset to 0 offered while `changed`.
 */
function pitchAction(pitch: number, changed: boolean, set: (semitones: number) => void): MenuAction {
  return {
    icon: Piano,
    label: 'Pitch',
    title: 'How many semitones the Clip is moved up or down, without changing its Tempo',
    field: {
      value: pitch,
      unit: 'st',
      step: 1,
      shiftStep: 12,
      min: minPitch,
      max: maxPitch,
      reset: { value: 0, label: 'Reset to 0 st', offered: changed },
      set,
    },
  };
}

/**
 * The Nudge entry, typed in whole milliseconds of the Clip's audio,
 * starting at nudge, with a reset to 0 offered while it's nudged, and the
 * keys that nudge by dragging named, if there are any to name.
 */
function nudgeAction(nudge: number, nudgeKeys: string | null, set: (ms: number) => void): MenuAction {
  return {
    icon: MoveHorizontal,
    label: 'Nudge',
    title: `How far the Clip's audio is moved within it, in milliseconds, later if positive${nudgeKeys ? `; or ${nudgeKeys} the Clip` : ''}`,
    field: {
      value: Math.round(nudge * 1000),
      unit: 'ms',
      step: 1,
      shiftStep: 10,
      reset: { value: 0, label: 'Reset to 0 ms', offered: nudge !== 0 },
      set,
    },
  };
}

/** Marks an entry that edits as off while frozen, saying why. */
function editing(freeze: Freeze): (action: MenuAction) => MenuAction {
  return (action) => (freeze ? { ...action, disabled: true, title: editHint(freeze, action.title) } : action);
}

/** Copy and Cut, naming their keys, if there are any to name, as Rename names double-clicking. */
function clipboardActions(
  command: CommandEntry,
  keys: Pick<ClipMenuState, 'copyKeys' | 'cutKeys'>,
  run: (c: ClipCommandOn) => () => void,
): MenuAction[] {
  const orKeys = (shown: string | null) => (shown ? `Or ${shown}` : undefined);
  return [
    command('copy', { icon: Copy, label: 'Copy', title: orKeys(keys.copyKeys), run: run({ kind: 'copy' }) }),
    command('cut', { icon: Scissors, label: 'Cut', title: orKeys(keys.cutKeys), run: run({ kind: 'cut' }) }),
  ];
}

/** Split at playhead, naming its keys. */
function splitAction({ splitKeys }: Pick<ClipMenuState, 'splitKeys'>, split: () => void): MenuAction {
  const action: MenuAction = { icon: SquareSplitHorizontal, label: 'Split at playhead', run: split };
  return splitKeys ? { ...action, title: `Or ${splitKeys}` } : action;
}

/** What the Selection menu needs to know besides its Clips. */
export type SelectionMenuState = Pick<ClipMenuState, 'frozen' | 'copyKeys' | 'cutKeys' | 'splitKeys'>;

/**
 * The entries of the Selection menu, a selected Clip's menu while there are
 * several selected, acting on all of them. Its Tempo and Pitch entries
 * start at those of `clip`, the Clip it opened on.
 */
export function selectionActions(clip: Clip, state: SelectionMenuState, commands: ClipMenuCommands): MenuAction[] {
  const target: ClipTarget = { kind: 'selection' };
  const command = commandEntry(commands, target, state.frozen);
  const run = runOn(commands, target);
  const count = commands.clipsOf(target).length;
  const howMany = `${count} Clip${count === 1 ? '' : 's'}`;
  return [
    ...stretchActions(clip, commands, target, command),
    ...clipboardActions(command, state, run),
    command('duplicate', { icon: CopyPlus, label: `Duplicate ${howMany}`, run: run({ kind: 'duplicate' }) }),
    command('split', splitAction(state, run({ kind: 'split' })), 'Move the playhead into a selected Clip to split it'),
    ...(commands.can('merge', target) !== 'cantMerge'
      ? [
          command('merge', {
            icon: Merge,
            label: 'Merge',
            title: 'Into one Clip of a new Sound',
            run: run({ kind: 'merge' }),
          }),
        ]
      : []),
    command('delete', { icon: X, label: `Delete ${howMany}`, run: run({ kind: 'delete' }) }),
  ];
}

/** Retake's title, and off, saying what to set back, while the Clip's Tempo or Pitch is changed. */
function retakeState({ tempo, pitch }: Clip): { title: string; disabled?: true } {
  const setBack =
    tempo !== 1 && pitch !== 0
      ? 'the Tempo back to 100% and the Pitch to 0'
      : tempo !== 1
        ? 'the Tempo back to 100%'
        : pitch !== 0
          ? 'the Pitch back to 0'
          : null;
  if (setBack === null) return { title: 'Record another Take into this Clip' };
  return { title: `Set ${setBack} to retake this Clip`, disabled: true };
}

function takeActions(clip: Clip, state: ClipMenuState, commands: ClipMenuCommands, page: ClipPageRun): MenuAction[] {
  if (clip.activeTakeId === null) return [];
  const { activeTakeId, takes } = clip;
  const active = activeTake(clip)!;
  const target: ClipTarget = { kind: 'clip', clipId: clip.id };
  const command = commandEntry(commands, target, state.frozen);
  const canRecord = state.canRecord && state.selected <= 1;
  // With one Take, there's no other to choose, and deleting it is
  // deleting the Clip.
  const several = takes.length > 1;
  return [
    ...(canRecord
      ? [
          {
            icon: CircleDot,
            label: 'Retake',
            run: page.retake,
            // A Take is recorded as it's sung, so only lines up in a Clip
            // at 100% and 0 semitones.
            ...retakeState(clip),
          },
        ]
      : []),
    ...(several
      ? [
          command('chooseTake', {
            icon: Layers,
            label: 'Takes',
            title: 'Choose the Take this Clip plays',
            choices: takes.map((t) => ({
              label: `Take ${t.number}`,
              checked: t.id === activeTakeId,
              run: () => {
                if (t.id !== activeTakeId) void commands.run({ kind: 'chooseTake', target, takeId: t.id });
              },
            })),
          }),
          command('deleteTake', {
            icon: X,
            label: 'Delete Take',
            choices: takes.map((t) => ({
              label: `Take ${t.number}${t.id === activeTakeId ? ' (active)' : ''}`,
              run: () => void commands.run({ kind: 'deleteTake', target, takeId: t.id }),
            })),
          }),
        ]
      : []),
    ...(several
      ? [
          command('clearInactiveTakes', {
            icon: Eraser,
            label: 'Clear inactive Takes',
            run: () => void commands.run({ kind: 'clearInactiveTakes', target }),
          }),
        ]
      : []),
    {
      icon: Download,
      label: 'Download Take',
      title: `Save Take ${active.number}'s WAV as it was recorded, lead-in and all`,
      run: () => page.downloadTake(activeTakeId),
    },
  ];
}
