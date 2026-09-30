import type { MenuAction } from './menu';

// The transport row's ⋯: its occasional actions, in the order they're
// listed. Those that edit the Timeline apply only where it's shown in full,
// so on a transport-only Timeline, e.g. an upright phone, they aren't
// offered, and with nothing left the ⋯ doesn't show.

/** What the Timeline is doing, which decides what the ⋯ offers. */
export type TransportState = {
  /** The full Timeline shows, rather than the transport row alone. */
  fullTimeline: boolean;
  importing: boolean;
  recording: boolean;
};

/** What each entry does. */
export type TransportRun = {
  importAudio: () => void;
  recordingSettings: () => void;
};

/** The entries of the transport row's ⋯, or none for no ⋯. */
export function transportActions(state: TransportState, run: TransportRun): MenuAction[] {
  if (!state.fullTimeline) return [];
  return [
    {
      icon: '⤒',
      label: 'Import audio…',
      disabled: state.importing || state.recording,
      run: run.importAudio,
    },
    {
      icon: '◎',
      label: 'Recording settings…',
      disabled: state.recording,
      run: run.recordingSettings,
    },
  ];
}
