// A Mixdown: the Timeline rendered into one stereo file at 48 kHz, whatever
// the device's rate, sounding as playback would. It's built with the same
// pieces playback is (schedule, and TrackMix for the Clip → Track wiring),
// on an offline context that mixes as fast as it can and resamples each
// Clip's decoded audio itself. It's never normalised: what it clips, the file
// clips too, and a note says so.
import { schedule, type Placed } from './schedule';
import { TrackMix, type PlayableClip } from './timelinePlayer';
import { atFullScale } from './wav';

/** A Mixdown's sample rate, in Hz. */
export const mixdownRate = 48000;
const channels = 2;

/** How far a Mixdown has got: loading its Clips' audio, then mixing, done a fraction of the way. */
export type MixdownProgress = { step: 'loading' } | { step: 'mixing'; done: number };

/** What a Mixdown mixes, and how. */
export interface MixdownPlan {
  /** What each Clip plays, as playback would. */
  clips: readonly PlayableClip[];
  /** Where on the Timeline the Mixdown starts and ends, in seconds from 0:00. */
  start: number;
  end: number;
  /** Each Track's gain by id, from its volume, mute and solo. */
  gains: Map<number, number>;
  /** Fetches and decodes a Clip's source, e.g. the player's, which keeps it for playback. */
  load: (source: string) => Promise<AudioBuffer>;
  /** Cancels it: it then rejects with the signal's reason. */
  signal: AbortSignal;
  onProgress: (progress: MixdownProgress) => void;
}

// How often mixing stops to say how far it's got, as a share of it, but
// never more often than every half a second of audio.
const progressSteps = 50;
const minProgressStep = 0.5;

/** Mixes a Mixdown down, resolving to its audio, stereo at mixdownRate. */
export async function mixDown(plan: MixdownPlan): Promise<AudioBuffer> {
  const { clips, start, gains, load, signal, onProgress } = plan;
  // It plays its stretch once, never going round the Loop, silent wherever
  // no Clip is; the Clips it doesn't reach aren't even loaded.
  const length = plan.end - start;
  const playing = schedule(clips, start).filter((s) => s.delay < length);
  signal.throwIfAborted();
  onProgress({ step: 'loading' });
  const sources = [...new Set(playing.map((s) => s.clip.source))];
  const loaded = await untilCancelled(Promise.all(sources.map(load)), signal);
  const buffers = new Map(sources.map((source, i) => [source, loaded[i]]));

  const context = new OfflineAudioContext({
    numberOfChannels: channels,
    length: Math.max(1, Math.ceil(length * mixdownRate)),
    sampleRate: mixdownRate,
  });
  const mix = new TrackMix(context, gains);
  for (const s of playing) {
    mix.play(buffers.get(s.clip.source)!, s.clip.trackId, s.delay, s.from, Math.min(s.duration, length - s.delay));
  }

  // It pauses at each step to say how far it's got, and only carries on if
  // it hasn't been cancelled meanwhile: left paused, it's let go of.
  const every = Math.max(length / progressSteps, minProgressStep);
  for (let t = every; t < length; t += every) {
    context
      .suspend(t)
      .then(() => {
        if (signal.aborted) return;
        onProgress({ step: 'mixing', done: t / length });
        return context.resume();
      })
      .catch(() => {});
  }
  onProgress({ step: 'mixing', done: 0 });
  return untilCancelled(context.startRendering(), signal);
}

/** Settles as work does, or rejects with the signal's reason as soon as it's cancelled. */
function untilCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    if (signal.aborted) return cancelled();
    signal.addEventListener('abort', cancelled, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
}

/** Where the whole Timeline's Mixdown ends, in seconds: where its last Clip ends, whatever Cues come after. */
export function mixdownEnd(clips: readonly Placed[]): number {
  return clips.reduce((end, c) => Math.max(end, c.start + c.length), 0);
}

/** What a Mixdown covers, in seconds: the whole Timeline, or the Loop's stretch of it. */
export interface MixdownRange {
  of: 'timeline' | 'loop';
  start: number;
  end: number;
}

/**
 * What a Song's Mixdown can cover, and which of it to offer first: the whole
 * Timeline, which ends at end, and the Loop's stretch when the Song has a
 * Loop, chosen first while the Loop is on.
 */
export function mixdownRanges(
  end: number,
  loop: { start: number; end: number; on: boolean } | null,
): { ranges: MixdownRange[]; chosen: MixdownRange } {
  const whole: MixdownRange = { of: 'timeline', start: 0, end };
  if (!loop) return { ranges: [whole], chosen: whole };
  const stretch: MixdownRange = { of: 'loop', start: loop.start, end: loop.end };
  return { ranges: [whole, stretch], chosen: loop.on ? stretch : whole };
}

/** The file a Song's Mixdown downloads as, with the Loop's times for its stretch, e.g. "(0m32s-0m48s)". */
export function mixdownName(songTitle: string, range: MixdownRange): string {
  if (range.of === 'timeline') return `${songTitle} - Mixdown.wav`;
  return `${songTitle} - Mixdown (${minutesSeconds(range.start)}-${minutesSeconds(range.end)}).wav`;
}

/** A time to the second, as a file name can hold it, e.g. "1m05s". */
function minutesSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}

/** What a Mixdown's levels come to: whether any sample reached full scale, and whether every one is silent. */
export interface MixdownLevels {
  clips: boolean;
  silent: boolean;
}

/** Checks a Mixdown's channels, from -1 to 1, for clipping in its file and for silence throughout. */
export function levelsOf(channels: readonly Float32Array[]): MixdownLevels {
  let clips = false;
  let silent = true;
  for (const samples of channels) {
    for (const s of samples) {
      if (s !== 0) silent = false;
      if (!clips && atFullScale(s)) clips = true;
    }
  }
  return { clips, silent };
}
