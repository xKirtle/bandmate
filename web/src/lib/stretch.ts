// Stretching a Clip's decoded audio to play at its Tempo and its Pitch,
// each without changing the other: the audio it plays, as it plays on the
// Timeline, so playback, a Merge and a Mixdown play it as they would any
// decoded audio (ADR 0006). The stretching is a transient-aware phase
// vocoder (@audio/stretch-transient), which keeps the attacks of drums and
// plucks, then a resample to exactly the length the Tempo gives: it plays
// the stretched audio faster or slower by the Pitch, which moves its frequencies,
// and corrects the vocoder rounding its hops to whole samples. It goes a
// second of audio at a time, pausing between, so the page carries on
// meanwhile.
import transient from '@audio/stretch-transient';
import type { Clip } from './api';

/** Decoded audio, one array of samples per channel. */
export interface DecodedAudio {
  channels: readonly Float32Array[];
  sampleRate: number;
}

/** What a Clip's audio is stretched by: its Tempo, as a ratio of as recorded, and its Pitch, in semitones. */
export type StretchedBy = Pick<Clip, 'tempo' | 'pitch'>;

/** Whether stretching changes audio at all. */
export function stretches({ tempo, pitch }: StretchedBy): boolean {
  return tempo !== 1 || pitch !== 0;
}

/** Lets the page carry on, e.g. with a timer, before the next second of audio is stretched. */
export type Pause = () => Promise<void>;

// A message to itself rather than a timer, which a browser slows to once a
// second in a tab that isn't shown.
const nextTask: Pause = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

/**
 * Audio played at a Tempo and moved by a Pitch: each channel as long as the
 * Tempo makes it, its frequencies moved by the Pitch; as it is at 100% and 0.
 */
export async function stretch(audio: DecodedAudio, how: StretchedBy, pause: Pause = nextTask): Promise<Float32Array[]> {
  const { channels, sampleRate } = audio;
  if (!stretches(how)) return [...channels];
  // Stretched by the Pitch's ratio too, keeping its pitch, then played that
  // much faster in the resample, which moves its frequencies and leaves its length
  // as the Tempo has it.
  const ratio = 2 ** (how.pitch / 12);
  const factor = ratio / how.tempo;
  const writers = channels.map(() => transient({ factor }));
  const parts: Float32Array[][] = channels.map(() => []);
  const length = channels[0]?.length ?? 0;
  for (let from = 0; from < length; from += sampleRate) {
    channels.forEach((c, i) => parts[i].push(writers[i](c.subarray(from, from + sampleRate))));
    await pause();
  }
  const out: Float32Array[] = [];
  for (const [i, p] of parts.entries()) {
    out.push(await resampled(joined([...p, writers[i]()]), Math.round(length / how.tempo), sampleRate, pause));
  }
  return out;
}

function joined(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// The resample's filter: a windowed sinc, reaching this many zero crossings
// either side, kept as a table of this many points to a sample.
const zeroCrossings = 8;
const tableDensity = 256;

/**
 * Samples resampled to a length, through a low-pass that keeps what's
 * squeezed in from folding back as noise when it's shortened. It pauses
 * after each `pauseEvery` samples written.
 */
async function resampled(
  samples: Float32Array,
  length: number,
  pauseEvery: number,
  pause: Pause,
): Promise<Float32Array> {
  if (samples.length === length || samples.length === 0) return samples;
  const step = samples.length / length;
  // Just under half the rate it's played at, so no frequency folds back.
  const cutoff = 0.95 * Math.min(1, 1 / step);
  const reach = zeroCrossings / cutoff;
  const table = filterTable(cutoff, reach);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const at = i * step;
    const last = Math.min(samples.length - 1, Math.floor(at + reach));
    let sum = 0;
    for (let j = Math.max(0, Math.ceil(at - reach)); j <= last; j++) {
      const x = Math.abs(j - at) * tableDensity;
      const k = Math.floor(x);
      sum += samples[j] * (table[k] + (table[k + 1] - table[k]) * (x - k));
    }
    out[i] = sum;
    if ((i + 1) % pauseEvery === 0) await pause();
  }
  return out;
}

/** A low-pass at cutoff, as a share of half the rate, from 0 to reach samples away, Blackman-windowed. */
function filterTable(cutoff: number, reach: number): Float32Array {
  const table = new Float32Array(Math.ceil(reach * tableDensity) + 2);
  for (let k = 0; k < table.length; k++) {
    const x = k / tableDensity;
    if (x >= reach) break;
    const t = Math.PI * cutoff * x;
    const sinc = t === 0 ? 1 : Math.sin(t) / t;
    const u = x / reach;
    table[k] = cutoff * sinc * (0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u));
  }
  return table;
}
