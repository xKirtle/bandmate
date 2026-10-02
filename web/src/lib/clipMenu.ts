import type { Clip } from './api';
import { activeTake } from './clipSource';
import type { MenuAction } from './menu';

// A Clip's menu, opened by its ⋯, right-click, the Menu key, Shift+F10 or a
// long press: its entries, in the order they're listed. Deleting a Clip, or
// choosing, nudging, deleting and clearing its Takes, don't ask first: they
// can be undone, and a deleted Take is only detached.

/** What the Clip's menu needs to know besides the Clip. */
export type ClipMenuState = {
  /** A Take could start recording: stopped, and out of Sync mode. */
  canRecord: boolean;
  /** The name of the Sound a Clip of a Sound plays, or null for another Clip. */
  soundName: string | null;
  /** The keys that nudge a Take, as shown, or null for none. */
  nudgeKeys: string | null;
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
  duplicate: () => void;
  downloadSound: (soundId: number) => void;
  deleteClip: () => void;
};

/** The entries of a Clip's menu. */
export function clipActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  const { soundId } = clip;
  return [
    ...takeActions(clip, state, run),
    { icon: '✎', label: 'Rename', title: 'Or double-click the Clip', run: run.rename },
    { icon: '⧉', label: 'Duplicate', run: run.duplicate },
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
    { icon: '×', label: 'Delete Clip', run: run.deleteClip },
  ];
}

/** What each entry of the Selection menu does. */
export type SelectionRun = {
  deleteClips: () => void;
};

/**
 * The entries of the Selection menu, a selected Clip's menu while there are
 * several selected, acting on all `count` of them.
 */
export function selectionActions(count: number, run: SelectionRun): MenuAction[] {
  return [{ icon: '×', label: `Delete ${count} Clip${count === 1 ? '' : 's'}`, run: run.deleteClips }];
}

function takeActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  if (clip.activeTakeId === null) return [];
  const { activeTakeId, takes } = clip;
  const active = activeTake(clip)!;
  const { canRecord, nudgeKeys } = state;
  // With one Take, there's no other to choose, and deleting it is
  // deleting the Clip.
  const several = takes.length > 1;
  return [
    ...(canRecord
      ? [{ icon: '●', label: 'Retake', title: 'Record another Take into this Clip', run: run.retake }]
      : []),
    ...(several
      ? [
          {
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
          },
          {
            icon: '⌫',
            label: 'Delete Take',
            choices: takes.map((t) => ({
              label: `Take ${t.number}${t.id === activeTakeId ? ' (active)' : ''}`,
              run: () => run.deleteTake(t.id),
            })),
          },
        ]
      : []),
    {
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
    },
    ...(several ? [{ icon: '⊘', label: 'Clear inactive Takes', run: run.clearInactiveTakes }] : []),
    {
      icon: '⤓',
      label: 'Download Take',
      title: `Save Take ${active.number}'s WAV as it was recorded, lead-in and all`,
      run: () => run.downloadTake(activeTakeId),
    },
  ];
}
