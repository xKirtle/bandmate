// A Clip's waveform on the Timeline, drawn as it sounds: its source's peaks
// over what it plays, trimmed, from where its audio file starts, at its
// Tempo, shaped by its Fades and scaled by its Gain. Plain arithmetic, so
// the Timeline only has to draw a bar for each.
import type { Clip } from './api';
import { fitFades, shapedPeak } from './clipFade';
import { heardPeak } from './clipGain';
import { fileStart } from './clipSource';
import { sourceAt, sourceLength } from './clipTime';
import { clipping } from './liveWave';
import { peaksPerSecond } from './peaks';
import type { Placed } from './schedule';
import type { WaveWindow } from './timelineView';
import { barWidth, bars } from './waveform';

/** One bar of a Clip's waveform. */
export interface ClipBar {
  /** How tall it's drawn, in percent of the Clip's waveform, never under minHeight. */
  height: number;
  /** Whether its audio clipped: marked on a Take, not on a Beat or a Sound, often mastered loud. */
  clipped: boolean;
}

/** How tall a silent bar is drawn, in percent, so a quiet stretch still shows a line. */
const minHeight = 2;

/**
 * A Clip's waveform, placed at `at`, over the stretch of it in a wave
 * window, at a scale in pixels a second, from the peaks of its source:
 * none while they load, or if they couldn't, which draws it flat.
 */
export function clipBars(clip: Clip, at: Placed, wave: WaveWindow, scale: number, peaks: readonly number[]): ClipBar[] {
  const { from, to, bars: count } = wave;
  // How long a bar is, in seconds of the Timeline.
  const bar = barWidth / scale;
  // The same stretch, in its source.
  const shape = sourceShape(
    peaks,
    fileStart(clip),
    sourceAt(at, at.start + from),
    sourceLength(at, to - from),
    sourceLength(at, count * bar),
    count,
  );
  // As trimmed, so a trim being dragged shortens them to fit, as saving it will.
  const fades = fitFades(clip, at.length);
  const isTake = clip.activeTakeId !== null;
  return shape.map((peak, i) => {
    // Halfway across the bar, in seconds into the Clip.
    const t = from + (i + 0.5) * bar;
    return {
      height: Math.max(minHeight, heardPeak(shapedPeak(peak, fades, at.length, t), clip.gain) * 100),
      clipped: isTake && peak >= clipping,
    };
  });
}

/**
 * A stretch of a source's waveform, from offset seconds into it, as count
 * bars over drawn seconds of it. Before its audio file starts, `lead`
 * seconds in, and past heard seconds in, trimmed off the Clip, it's silent.
 */
function sourceShape(
  peaks: readonly number[],
  lead: number,
  offset: number,
  heard: number,
  drawn: number,
  count: number,
): number[] {
  const leadPeaks = Math.round(lead * peaksPerSecond);
  const from = Math.floor(offset * peaksPerSecond);
  const to = Math.max(from, Math.min(Math.ceil((offset + heard) * peaksPerSecond), leadPeaks + peaks.length));
  const kept = Array.from({ length: to - from }, (_, i) => peaks[from + i - leadPeaks] ?? 0);
  const silent = Math.max(0, Math.ceil((offset + drawn) * peaksPerSecond) - to);
  return bars([...kept, ...new Array<number>(silent).fill(0)], count);
}
