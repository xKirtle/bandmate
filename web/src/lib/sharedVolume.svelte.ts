import { deviceStorage } from './timelineHeight';
import { readVolume, setLevel, storeVolume, toggleMute, type Volume } from './volume';

// The one volume every player outside the Timeline follows, so turning a
// Master down turns Beat previews down too, including ones already showing.

let current = $state<Volume>(readVolume(deviceStorage()));

function keep(v: Volume) {
  current = v;
  storeVolume(deviceStorage(), v);
}

export const playerVolume = {
  get value(): Volume {
    return current;
  },
  setLevel: (level: number) => keep(setLevel(level)),
  toggleMute: () => keep(toggleMute(current)),
};

let settable: boolean | undefined;

/** Whether this browser lets a page set a media element's volume; iOS Safari doesn't, only mute. */
export function canSetVolume(): boolean {
  if (settable === undefined) {
    const probe = document.createElement('audio');
    probe.volume = 0.5;
    settable = probe.volume === 0.5;
  }
  return settable;
}
