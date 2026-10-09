// Stretching a Clip's decoded audio to play at its Tempo, without changing
// its pitch: the audio it plays, as it plays on the Timeline, so playback,
// a Merge and a Mixdown play it as they would any decoded audio (ADR 0006).
// The stretching is a transient-aware phase vocoder (@audio/stretch-transient),
// which keeps the attacks of drums and plucks, then a resample to exactly
// the length the Tempo gives, as the vocoder rounds its hops to whole
// samples. It goes a second of audio at a time, pausing between, so the page
// carries on meanwhile.
import transient from '@audio/stretch-transient';

/** Decoded audio, one array of samples per channel. */
export interface DecodedAudio {
  channels: readonly Float32Array[];
  sampleRate: number;
}

/** How a Clip's audio is stretched: its Tempo, as a ratio of as recorded. */
export interface Stretch {
  tempo: number;
}

/** Whether stretching changes audio at all. */
export function stretches({ tempo }: Stretch): boolean {
  return tempo !== 1;
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

/** Audio played at a Tempo, each channel as long as the Tempo makes it; as it is at 100%. */
export async function stretch(audio: DecodedAudio, how: Stretch, pause: Pause = nextTask): Promise<Float32Array[]> {
  const { channels, sampleRate } = audio;
  if (!stretches(how)) return [...channels];
  const factor = 1 / how.tempo;
  const writers = channels.map(() => transient({ factor }));
  const parts: Float32Array[][] = channels.map(() => []);
  const length = channels[0]?.length ?? 0;
  for (let from = 0; from < length; from += sampleRate) {
    channels.forEach((c, i) => parts[i].push(writers[i](c.subarray(from, from + sampleRate))));
    await pause();
  }
  return parts.map((p, i) => resampled(joined([...p, writers[i]()]), Math.round(length * factor)));
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

/** Samples resampled to a length, linearly: only ever by a hair, to correct the vocoder's rounding. */
function resampled(samples: Float32Array, length: number): Float32Array {
  if (samples.length === length || samples.length === 0) return samples;
  const out = new Float32Array(length);
  const step = (samples.length - 1) / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const at = i * step;
    const j = Math.floor(at);
    const next = samples[Math.min(j + 1, samples.length - 1)];
    out[i] = samples[j] + (next - samples[j]) * (at - j);
  }
  return out;
}
