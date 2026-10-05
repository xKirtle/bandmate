import type { MenuAction } from './menu';
import Download from '@lucide/svelte/icons/download';
import Mic from '@lucide/svelte/icons/mic';
import Upload from '@lucide/svelte/icons/upload';

// The transport row's ⋯: its occasional actions, in the order they're
// listed. Those that edit the Timeline, or set up recording, apply only
// where it's shown in full, so on a transport-only Timeline, e.g. an
// upright phone, Mix down… is the only one offered.

/** What the Timeline is doing, which decides what the ⋯ offers. */
export type TransportState = {
  /** The full Timeline shows, rather than the transport row alone. */
  fullTimeline: boolean;
  importing: boolean;
  recording: boolean;
  /** A Merge is being made, so the Timeline can't be edited. */
  merging: boolean;
  /** The Chosen Track's name, which Import audio… imports onto. */
  chosenTrack: string;
  /** The Timeline has Clips, which a Mixdown needs. */
  hasClips: boolean;
};

/** What each entry does. */
export type TransportRun = {
  importAudio: () => void;
  mixDown: () => void;
  recordingSettings: () => void;
};

/** The entries of the transport row's ⋯: always at least Mix down…. */
export function transportActions(state: TransportState, run: TransportRun): MenuAction[] {
  const importAudio: MenuAction = {
    icon: Upload,
    label: 'Import audio…',
    title: state.recording
      ? 'Stop recording to import audio'
      : state.merging
        ? 'Wait for the Merge to finish to import audio'
        : `Import an audio file as a Sound onto ${state.chosenTrack}`,
    disabled: state.importing || state.recording || state.merging,
    run: run.importAudio,
  };
  const mixDown: MenuAction = {
    icon: Download,
    label: 'Mix down…',
    title: state.recording
      ? 'Stop recording to mix down'
      : state.hasClips
        ? 'Download the Timeline, or its Loop, as one audio file'
        : 'Add a Beat, Sound or Take to mix down',
    disabled: !state.hasClips || state.recording,
    run: run.mixDown,
  };
  const recordingSettings: MenuAction = {
    icon: Mic,
    label: 'Recording settings…',
    title: state.recording
      ? 'Stop recording to change the recording settings'
      : 'The input to record from, its level, and the Latency Offset',
    disabled: state.recording,
    run: run.recordingSettings,
  };
  return state.fullTimeline ? [importAudio, mixDown, recordingSettings] : [mixDown];
}
