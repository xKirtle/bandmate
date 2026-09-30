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
  /** The Chosen Track's name, which Import audio… imports onto. */
  chosenTrack: string;
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
      title: `Import an audio file as a Sound onto ${state.chosenTrack}`,
      disabled: state.importing || state.recording,
      run: run.importAudio,
    },
    {
      icon: '◎',
      label: 'Recording settings…',
      title: 'The input to record from, its level, and the Latency Offset',
      disabled: state.recording,
      run: run.recordingSettings,
    },
  ];
}
