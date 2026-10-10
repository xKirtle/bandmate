// Hearing a Chord: plucked strings synthesised in the browser, with no
// samples. Each string is a Karplus–Strong pluck, a burst of noise fed round
// a delay line one period of its pitch long and softened on each pass, so it
// rings at that pitch and dies away as a string does. What it plucks, each
// string's pitch and how bright it sounds, comes from the Chord Finder
// (plucks), so this knows nothing about a guitar's strings or frets.
//
// It plays on the app's one audio context, made on the first press, as
// browsers require. A new strum or arpeggio cuts off whatever still rings:
// they never layer.

import type { Pluck } from './chordFinder';
import { audioContext } from './timelinePlayer';

/** How long a string rings, at most, in seconds. */
const ringFor = 3;
/** The gap between one string and the next in a strum, in seconds. */
const strumGap = 0.03;
/** The gap between one string and the next in an arpeggio, in seconds: slow enough to hear each note. */
const arpeggioGap = 0.175;
/** The fixed volume of a strum, low enough that six strings together don't clip. */
const volume = 0.3;
/** How quickly a strum cut off falls silent, in seconds, so it ends without a click. */
const cutOffIn = 0.03;
/** How loud a pick starts, as the noise's RMS level, before the strum's volume. */
const pickLevel = 0.3;
/** How much of a string's sound each pass round the loop keeps: the closer to 1, the longer it rings. */
const sustain = 0.996;

/** The strum or arpeggio still ringing, if any: what a new one cuts off. */
let ringing: { gain: GainNode; sources: AudioBufferSourceNode[] } | null = null;

/**
 * Strums once, downwards: the first pluck first, each next one a short gap
 * after, as the Chord Finder's plucks lists them, lowest string first. Cuts
 * off whatever still rings.
 */
export function strum(plucks: readonly Pluck[]): void {
  play(plucks, strumGap);
}

/**
 * Arpeggiates: plucks each string once, lowest first, as the Chord Finder's
 * plucks lists them, far enough apart to hear each note, each left ringing.
 * Cuts off whatever still rings.
 */
export function arpeggiate(plucks: readonly Pluck[]): void {
  play(plucks, arpeggioGap);
}

/** Plays plucks one after another, `gap` seconds apart, each left ringing, cutting off whatever still rings. */
function play(plucks: readonly Pluck[], gap: number): void {
  const context = audioContext();
  // Resumed while the press that asked for it still counts.
  void context.resume().catch(() => {});
  cutOff(context);
  if (plucks.length === 0) return;

  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);
  const start = context.currentTime + 0.01;
  const sources = plucks.map((p, i) => {
    const source = context.createBufferSource();
    source.buffer = pluck(context, p);
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

/** Fades out the strum or arpeggio still ringing, quickly enough to sound cut off, slowly enough not to click. */
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
 * A pluck at the context's sample rate. Made afresh each time, a few
 * milliseconds' work, so no two strums sound quite the same, as on a real
 * guitar.
 */
function pluck(context: BaseAudioContext, { pitch, brightness }: Pluck): AudioBuffer {
  const samples = pluckSamples(440 * 2 ** ((pitch - 69) / 12), brightness, context.sampleRate);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/**
 * A plucked string at a frequency (Karplus–Strong): a burst of noise round a
 * delay line one period long, each pass blending neighbouring samples, which
 * softens the sound as it rings and lets the high notes die sooner. An
 * all-pass filter makes up the period's fraction of a sample, so a high
 * note is in tune too.
 *
 * Brightness, from 0 to 1, sets what a darker string does: a softer pick,
 * with fewer high overtones to start with; a pick further from the end of
 * the string, which takes out more of them; and more damping in the loop,
 * which takes the overtones left out sooner as it rings.
 */
function pluckSamples(frequency: number, brightness: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(ringFor * sampleRate));
  const dark = 1 - Math.min(1, Math.max(0, brightness));
  // Each pass blends a sample with the one before by this much: 0.5 damps
  // the overtones most, less leaves them ringing longer.
  const blend = 0.15 + 0.35 * dark;
  // And a low-pass in the loop, none for the brightest string, takes the
  // overtones of a darker one out sooner still.
  const damping = 0.55 * dark;
  // The loop's delay is the line's length, the blend's and the low-pass's
  // delays at the pitch, and the all-pass's fraction, kept between 0.1 and
  // 1.1 to stay stable.
  const period = sampleRate / frequency;
  const w = (2 * Math.PI) / period;
  const blendDelay = Math.atan2(blend * Math.sin(w), 1 - blend + blend * Math.cos(w)) / w;
  const dampingDelay = Math.atan2(damping * Math.sin(w), 1 - damping * Math.cos(w)) / w;
  const filtersDelay = blendDelay + dampingDelay;
  const length = Math.max(2, Math.floor(period - filtersDelay - 0.1));
  const fraction = period - filtersDelay - length;
  const allPass = (1 - fraction) / (1 + fraction);

  // The pick: noise through two low-passes, whose cut-off falls from above
  // hearing, for the brightest string, to a couple of kHz, for the darkest.
  const pickCutOff = 800 * 2 ** (4.5 * (1 - dark));
  const softening = Math.exp((-2 * Math.PI * pickCutOff) / sampleRate);
  const noise = new Float32Array(length);
  let soft = 0;
  let softer = 0;
  for (let i = 0; i < length; i++) {
    soft = softening * soft + (1 - softening) * (Math.random() * 2 - 1);
    softer = softening * softer + (1 - softening) * soft;
    noise[i] = softer;
  }
  // Picked a share of the way along the string: the overtones with a node
  // there don't sound, and the further along, the fewer high ones do.
  const pickedAt = Math.max(1, Math.round((0.1 + 0.25 * dark) * length));
  const line = noise.map((s, i) => s - (i >= pickedAt ? noise[i - pickedAt] : 0));
  const mean = line.reduce((sum, s) => sum + s, 0) / length;
  for (let i = 0; i < length; i++) line[i] -= mean;
  // Every string starts as loud, however bright.
  const rms = Math.sqrt(line.reduce((sum, s) => sum + s * s, 0) / length) || 1;
  for (let i = 0; i < length; i++) line[i] *= pickLevel / rms;

  let at = 0;
  let previous = 0;
  let damped = 0;
  let allPassIn = 0;
  let allPassOut = 0;
  for (let i = 0; i < out.length; i++) {
    const sample = line[at];
    out[i] = sample;
    const blended = sustain * ((1 - blend) * sample + blend * previous);
    previous = sample;
    damped = (1 - damping) * blended + damping * damped;
    allPassOut = allPass * damped + allPassIn - allPass * allPassOut;
    allPassIn = damped;
    line[at] = allPassOut;
    at = (at + 1) % length;
  }

  // Fades the last 50 ms out, so a string still ringing at the end doesn't click.
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
