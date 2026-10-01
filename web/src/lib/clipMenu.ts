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
  /** The title of the Sound a Clip of a Sound plays. */
  soundTitle: string;
  /** The keys that nudge a Take, as shown, or null for none. */
  nudgeKeys: string | null;
};

/** What each entry does. */
export type ClipRun = {
  retake: () => void;
  chooseTake: (takeId: number) => void;
  deleteTake: (takeId: number) => void;
  /** Sets the active Take's nudge, in milliseconds. */
  nudgeTake: (ms: number) => void;
  clearInactiveTakes: () => void;
  downloadTake: () => void;
  rename: () => void;
  duplicate: () => void;
  downloadSound: () => void;
  deleteClip: () => void;
};

/** The entries of a Clip's menu. */
export function clipActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  return [
    ...(clip.activeTakeId !== null && state.canRecord
      ? [{ icon: '●', label: 'Retake', title: 'Record another Take into this Clip', run: run.retake }]
      : []),
    ...takeActions(clip, state, run),
    { icon: '✎', label: 'Rename', title: 'Or double-click the Clip', run: run.rename },
    { icon: '⧉', label: 'Duplicate', run: run.duplicate },
    ...(clip.soundId !== null
      ? [
          {
            icon: '⤓',
            label: 'Download Sound',
            title: `Save “${state.soundTitle}” as it was imported`,
            run: run.downloadSound,
          },
        ]
      : []),
    { icon: '×', label: 'Delete Clip', run: run.deleteClip },
  ];
}

function takeActions(clip: Clip, state: ClipMenuState, run: ClipRun): MenuAction[] {
  if (clip.activeTakeId === null) return [];
  const { activeTakeId, takes } = clip;
  const active = activeTake(clip)!;
  const { nudgeKeys } = state;
  // With one Take, there's no other to choose, and deleting it is
  // deleting the Clip.
  const several = takes.length > 1;
  return [
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
        set: run.nudgeTake,
      },
    },
    ...(several ? [{ icon: '⊘', label: 'Clear inactive Takes', run: run.clearInactiveTakes }] : []),
    {
      icon: '⤓',
      label: 'Download Take',
      title: `Save Take ${active.number}'s WAV as it was recorded, lead-in and all`,
      run: run.downloadTake,
    },
  ];
}
