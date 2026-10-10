// Hearing a Chord: plucked strings synthesised in the browser, with no
// samples. Each string is a Karplus–Strong pluck, a burst of noise fed round
// a delay line one period of its pitch long and softened on each pass, so it
// rings at that pitch and dies away as a string does. Its pitches come from
// the Chord Finder (sounds), so this knows nothing about a guitar.
//
// It plays on the app's one audio context, made on the first press, as
// browsers require. A new strum cuts off one still ringing: strums never
// layer.

import { audioContext } from './timelinePlayer';

/** How long a string rings, at most, in seconds. */
const ringFor = 3;
/** The gap between one string and the next in a strum, in seconds. */
const strumGap = 0.03;
/** The fixed volume of a strum, low enough that six strings together don't clip. */
const volume = 0.3;
/** How quickly a strum cut off falls silent, in seconds, so it ends without a click. */
const cutOffIn = 0.03;
/** How much of a string's sound each pass round the loop keeps: the closer to 1, the longer it rings. */
const sustain = 0.996;

/** The strum still ringing, if any: what a new one cuts off. */
let ringing: { gain: GainNode; sources: AudioBufferSourceNode[] } | null = null;

/**
 * Strums pitches once, downwards: the first pitch first, each next one a
 * short gap after. Pitches are MIDI note numbers, the lowest string's first.
 * Cuts off a strum still ringing.
 */
export function strum(pitches: readonly number[]): void {
  play(pitches, strumGap);
}

/** Plays pitches one after another, `gap` seconds apart, each left ringing, cutting off whatever still rings. */
function play(pitches: readonly number[], gap: number): void {
  const context = audioContext();
  // Resumed while the press that asked for it still counts.
  void context.resume().catch(() => {});
  cutOff(context);
  if (pitches.length === 0) return;

  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  const start = context.currentTime + 0.01;
  const sources = pitches.map((pitch, i) => {
    const source = context.createBufferSource();
    source.buffer = pluck(context, pitch);
    source.connect(gain);
    source.start(start + i * gap);
    return source;
  });
  const played = { gain, sources };
  ringing = played;
  sources[sources.length - 1].onended = () => {
    if (ringing === played) ringing = null;
    gain.disconnect();
  };
}

/** Fades out the strum still ringing, quickly enough to sound cut off, slowly enough not to click. */
function cutOff(context: AudioContext) {
  if (!ringing) return;
  const { gain, sources } = ringing;
  ringing = null;
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + cutOffIn);
  for (const source of sources) {
    try {
      source.stop(now + cutOffIn);
    } catch {
      // Already stopped.
    }
  }
}

/**
 * A pluck of a pitch at the context's sample rate. Made afresh each time, a
 * few milliseconds' work, so no two strums sound quite the same, as on a
 * real guitar.
 */
function pluck(context: BaseAudioContext, pitch: number): AudioBuffer {
  const samples = pluckSamples(440 * 2 ** ((pitch - 69) / 12), context.sampleRate);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/**
 * A plucked string at a frequency (Karplus–Strong): a burst of noise round a
 * delay line one period long, each pass averaging neighbouring samples, which
 * softens the sound as it rings and lets the high notes die sooner. An
 * all-pass filter makes up the period's fraction of a sample, so a high
 * note is in tune too.
 */
function pluckSamples(frequency: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(ringFor * sampleRate));
  // The loop's delay is the line's length, half a sample for the average,
  // and the all-pass's fraction, kept between 0.1 and 1.1 to stay stable.
  const period = sampleRate / frequency;
  const length = Math.max(2, Math.floor(period - 0.6));
  const fraction = period - 0.5 - length;
  const allPass = (1 - fraction) / (1 + fraction);

  // The pick: noise, softened a little so it doesn't hiss, with no DC.
  const line = new Float32Array(length);
  let soft = 0;
  for (let i = 0; i < length; i++) {
    soft = 0.6 * soft + 0.4 * (Math.random() * 2 - 1);
    line[i] = soft;
  }
  const mean = line.reduce((sum, s) => sum + s, 0) / length;
  for (let i = 0; i < length; i++) line[i] -= mean;

  let at = 0;
  let previous = 0;
  let allPassIn = 0;
  let allPassOut = 0;
  for (let i = 0; i < out.length; i++) {
    const sample = line[at];
    out[i] = sample;
    const averaged = sustain * 0.5 * (sample + previous);
    previous = sample;
    allPassOut = allPass * averaged + allPassIn - allPass * allPassOut;
    allPassIn = averaged;
    line[at] = allPassOut;
    at = (at + 1) % length;
  }

  // Fades the last 50 ms out, so a string still ringing at the end doesn't click.
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
