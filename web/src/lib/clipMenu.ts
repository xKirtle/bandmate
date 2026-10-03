import type { Clip } from './api';
import { maxGain, minGain } from './clipGain';
import { activeTake } from './clipSource';
import { editHint, type Freeze } from './freeze';
import type { MenuAction } from './menu';

// A Clip's menu, opened by its ⋯, right-click, the Menu key, Shift+F10 or a
// long press: its entries, in the order they're listed. Deleting a Clip,
// setting its Gain, or choosing, nudging, deleting and clearing its Takes,
// don't ask first: they can be undone, and a deleted Take is only detached.
// Split at playhead is always listed, but off while the playhead crosses
// no Clip it would split.
// While recording, the entries that edit are shown off, and only the
// downloads run.

/** What the Clip's menu needs to know besides the Clip. */
export type ClipMenuState = {
  /** A Take could start recording: stopped, and out of Sync mode. */
  canRecord: boolean;
  /** The name of the Sound a Clip of a Sound plays, or null for another Clip. */
  soundName: string | null;
  /** The keys that nudge a Take, as shown, or null for none. */
  nudgeKeys: string | null;
  /** The keys that copy, as shown, or null for none. */
  copyKeys: string | null;
  /** The keys that cut, as shown, or null for none. */
  cutKeys: string | null;
  /** The playhead crosses the Clip, so it can be split there. */
  canSplit: boolean;
  /** The keys that split, as shown, or null for none. */
  splitKeys: string | null;
  /** How many Clips are selected. With several, no Retake is offered. */
  selected: number;
  /** A recording or a Merge is under way, so nothing's edited, or null. */
  frozen: Freeze;
};

/** What each entry does. */
export type ClipRun = {
  retake: () => void;
  chooseTake: (takeId: number) => void;
  deleteTake: (takeId: number) => void;
  /** Sets a Take's nudge, in milliseconds. */
  nudgeTake: (takeId: number, ms: number) => void;
  clearInactiveTakes: () => void;
  downloadTake: (takeId: number) => void;
  rename: () => void;
  /** Sets the Clip's Gain, in dB. */
  setGain: (gain: number) => void;
  /** Copies the Clip to the Clipboard. */
  copy: () => void;
  /** Copies the Clip to the Clipboard, then deletes it. */
  cut: () => void;
  duplicate: () => void;
  /** Splits the Clip in two at the playhead. */
  split: () => void;
  downloadSound: (soundId: number) => void;
  deleteClip: () => void;
};

/** The entries of a Clip's menu. */
export function clipActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  const { soundId } = clip;
  const edit = editing(state.frozen);
  return [
    ...takeActions(clip, state, run),
    edit({ icon: '✎', label: 'Rename', title: 'Or double-click the Clip', run: run.rename }),
    edit({
      icon: '±',
      label: 'Gain',
      title: 'How much louder or quieter the Clip plays, in dB; or drag its gain line',
      field: { value: clip.gain, unit: 'dB', step: 0.5, shiftStep: 3, min: minGain, max: maxGain, set: run.setGain },
    }),
    ...clipboardActions(edit, state, run.copy, run.cut),
    edit({ icon: '⧉', label: 'Duplicate', run: run.duplicate }),
    edit(splitAction(state, 'Move the playhead into the Clip to split it', run.split)),
    ...(soundId !== null
      ? [
          {
            icon: '⤓',
            label: 'Download Sound',
            title: `Save “${state.soundName}” as it was imported`,
            run: () => run.downloadSound(soundId),
          },
        ]
      : []),
    edit({ icon: '×', label: 'Delete Clip', run: run.deleteClip }),
  ];
}

/** Marks an entry that edits as off while frozen, saying why. */
function editing(freeze: Freeze): (action: MenuAction) => MenuAction {
  return (action) => (freeze ? { ...action, disabled: true, title: editHint(freeze, action.title) } : action);
}

/** Copy and Cut, naming their keys, if there are any to name, as Rename names double-clicking. */
function clipboardActions(
  edit: (action: MenuAction) => MenuAction,
  keys: Pick<ClipMenuState, 'copyKeys' | 'cutKeys'>,
  copy: () => void,
  cut: () => void,
): MenuAction[] {
  const orKeys = (shown: string | null) => (shown ? `Or ${shown}` : undefined);
  return [
    edit({ icon: '⎘', label: 'Copy', title: orKeys(keys.copyKeys), run: copy }),
    // Not ✂, which some fonts only draw as an emoji, unlike the other glyphs.
    edit({ icon: '✁', label: 'Cut', title: orKeys(keys.cutKeys), run: cut }),
  ];
}

/** Split at playhead, naming its keys, or off, saying why, while there's nothing to split. */
function splitAction(
  { canSplit, splitKeys }: Pick<ClipMenuState, 'canSplit' | 'splitKeys'>,
  whyNot: string,
  split: () => void,
): MenuAction {
  const action: MenuAction = { icon: '¦', label: 'Split at playhead', run: split };
  if (!canSplit) return { ...action, disabled: true, title: whyNot };
  return splitKeys ? { ...action, title: `Or ${splitKeys}` } : action;
}

/** What each entry of the Selection menu does. */
export type SelectionRun = {
  copyClips: () => void;
  cutClips: () => void;
  duplicateClips: () => void;
  /** Splits those the playhead crosses in two at it. */
  splitClips: () => void;
  /** Merges them into one Clip of a new Sound. */
  mergeClips: () => void;
  deleteClips: () => void;
};

/** What the Selection menu needs to know besides how many Clips are selected. */
export type SelectionMenuState = Pick<ClipMenuState, 'frozen' | 'copyKeys' | 'cutKeys' | 'splitKeys'> & {
  /** The playhead crosses one or more of them, so they can be split there. */
  canSplit: boolean;
  /** They can be merged: two or more, on any Tracks. */
  canMerge: boolean;
};

/**
 * The entries of the Selection menu, a selected Clip's menu while there are
 * several selected, acting on all `count` of them.
 */
export function selectionActions(count: number, run: SelectionRun, state: SelectionMenuState): MenuAction[] {
  const edit = editing(state.frozen);
  const howMany = `${count} Clip${count === 1 ? '' : 's'}`;
  return [
    ...clipboardActions(edit, state, run.copyClips, run.cutClips),
    edit({ icon: '⧉', label: `Duplicate ${howMany}`, run: run.duplicateClips }),
    edit(splitAction(state, 'Move the playhead into a selected Clip to split it', run.splitClips)),
    ...(state.canMerge
      ? [edit({ icon: '⊕', label: 'Merge', title: 'Into one Clip of a new Sound', run: run.mergeClips })]
      : []),
    edit({ icon: '×', label: `Delete ${howMany}`, run: run.deleteClips }),
  ];
}

function takeActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  if (clip.activeTakeId === null) return [];
  const { activeTakeId, takes } = clip;
  const active = activeTake(clip)!;
  const { nudgeKeys } = state;
  const edit = editing(state.frozen);
  const canRecord = state.canRecord && state.selected <= 1;
  // With one Take, there's no other to choose, and deleting it is
  // deleting the Clip.
  const several = takes.length > 1;
  return [
    ...(canRecord
      ? [{ icon: '●', label: 'Retake', title: 'Record another Take into this Clip', run: run.retake }]
      : []),
    ...(several
      ? [
          edit({
            icon: '♪',
            label: 'Takes',
            title: 'Choose the Take this Clip plays',
            choices: takes.map((t) => ({
              label: `Take ${t.number}`,
              checked: t.id === activeTakeId,
              run: () => {
                if (t.id !== activeTakeId) run.chooseTake(t.id);
              },
            })),
          }),
          edit({
            icon: '⌫',
            label: 'Delete Take',
            choices: takes.map((t) => ({
              label: `Take ${t.number}${t.id === activeTakeId ? ' (active)' : ''}`,
              run: () => run.deleteTake(t.id),
            })),
          }),
        ]
      : []),
    edit({
      icon: '↔',
      label: 'Nudge',
      title: `Move Take ${active.number} within the Clip, in milliseconds, later if positive${nudgeKeys ? `; or ${nudgeKeys} the Clip` : ''}`,
      field: {
        value: Math.round(active.nudge * 1000),
        unit: 'ms',
        step: 1,
        shiftStep: 10,
        set: (ms) => run.nudgeTake(activeTakeId, ms),
      },
    }),
    ...(several ? [edit({ icon: '⊘', label: 'Clear inactive Takes', run: run.clearInactiveTakes })] : []),
    {
      icon: '⤓',
      label: 'Download Take',
      title: `Save Take ${active.number}'s WAV as it was recorded, lead-in and all`,
      run: () => run.downloadTake(activeTakeId),
    },
  ];
}
