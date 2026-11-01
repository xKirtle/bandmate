// Where a Track starts to clip: the volume at which its loudest Clip reaches
// full scale, from the peaks of what its Clips play, as their Fades and Gain
// shape them. Playback lets a Track go past it, and its fader marks it. It
// only knows the one Track, as Tracks adding together can clip below it, and
// peaks are of the audio as recorded, so a Clip's Tempo and Pitch can move it
// a little. Plain arithmetic, so the Timeline only has to show it.
import type { Clip, Track } from './api';
import { fitFades, shapedPeak } from './clipFade';
import { gainFactor } from './clipGain';
import { heard, type ClipSource, type ClipSources } from './clipSource';
import { maxVolume, minVolume } from './mixer';
import { peaksPerSecond } from './peaks';

/** How loud a Clip gets at its Track's 0 dB, as a factor of full scale. */
function loudest(clip: Clip, source: ClipSource, peaks: readonly number[]): number {
  const stretch = heard(clip, source);
  if (!stretch) return 0;
  const fades = fitFades(clip, clip.length);
  // Into the Clip, where what's heard starts.
  const lead = stretch.start - clip.start;
  const from = Math.floor(stretch.offset * peaksPerSecond);
  const to = Math.ceil((stretch.offset + stretch.length * clip.tempo) * peaksPerSecond);
  let most = 0;
  for (let i = Math.max(0, from); i < Math.min(to, peaks.length); i++) {
    const t = lead + (i / peaksPerSecond - stretch.offset) / clip.tempo;
    most = Math.max(most, shapedPeak(peaks[i], fades, clip.length, t));
  }
  return most * gainFactor(clip.gain);
}

/**
 * The volume, in dB, above which a Track's loudest Clip clips, whose audio's
 * peaks come from peaksOf: null while there are no peaks to go by. Audio
 * peaking at exactly full scale doesn't clip at 0 dB, so this is 0 for it.
 */
export function clipsAbove(
  track: Track,
  sources: ClipSources,
  peaksOf: (source: ClipSource) => readonly number[],
): number | null {
  const most = Math.max(0, ...track.clips.map((c) => loudest(c, sources.of(c), peaksOf(sources.of(c)))));
  // Not −0 dB for audio at full scale.
  return most > 0 ? -20 * Math.log10(most) || 0 : null;
}

/** Whether a Track's fader can show where it clips: that volume's on it. */
export function onFader(volume: number | null): volume is number {
  return volume !== null && volume >= minVolume && volume <= maxVolume;
}
