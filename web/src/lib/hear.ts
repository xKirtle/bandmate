// Hearing a Chord: a Voicing's notes, played in the browser on the app's one
// audio context, made on the first press, as browsers require, as hearing's
// rules (hearing.ts) say. Each Instrument plays its recorded samples
// (ADR 0030), each note from the nearest one, faster or slower to sound at
// the note. What it hears, each note's MIDI note number, and the
// Instrument's sound come from the Chord Finder (heardNotes, sound), so this
// knows nothing about a guitar's strings or a piano's keys.
//
// A new Hear or Arpeggiate cuts off whatever still rings: they never layer.

import { hearing, type Played } from './hearing';
import type { HeardNote, InstrumentSound } from './instrument';
import { fromOnset, sampleFor } from './samples';
import { audioContext } from './timelinePlayer';
import { unheard } from './unheard.svelte';

/** How quickly a Hear or Arpeggiate cut off falls silent, in seconds, so it ends without a click. */
const cutOffIn = 0.03;

/** The Hear or Arpeggiate still ringing, if any: what a new one cuts off. */
let ringing: { gain: GainNode; sources: AudioBufferSourceNode[] } | null = null;

/**
 * Where samples are decoded, at the rate they're encoded at: offline, so
 * loading them before any press doesn't make the app's audio context before
 * a gesture lets it play. Playing resamples them to the context's rate.
 */
let decoder: OfflineAudioContext | undefined;

const player = hearing<AudioBuffer>({
  loadSample: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    const decoded = await decoder.decodeAudioData(await response.arrayBuffer());
    const from = fromOnset(decoded.getChannelData(0), decoded.sampleRate);
    const sample = new AudioBuffer({ length: from.length, sampleRate: decoded.sampleRate });
    sample.copyToChannel(from as Float32Array<ArrayBuffer>, 0);
    return sample;
  },
  play,
  cutOff: () => cutOff(audioContext()),
  unheard: (set) => unheard.show(set),
  heard: (set) => unheard.heard(set),
});

/**
 * Loads an Instrument's samples, if they aren't loaded yet,
 * so a press plays at once: when the Chord Finder or a Chord's popover
 * opens, and when the Instrument is picked.
 */
export function prepareToHear(sound: InstrumentSound): void {
  player.prepare(sound);
}

/**
 * Hears a Voicing once, as its Instrument sounds it: strummed downwards, the
 * first note first, each next one a short gap after, as the Chord Finder's
 * heardNotes lists them, lowest first, or its notes together, as a Chord's
 * keys pressed on a piano. Cuts off whatever still rings.
 */
export function hear(notes: readonly HeardNote[], sound: InstrumentSound): void {
  resume();
  player.hear(notes, sound);
}

/**
 * Arpeggiates: sounds each note once, lowest first, as the Chord Finder's
 * heardNotes lists them, far enough apart to hear each one, each left
 * ringing. Cuts off whatever still rings.
 */
export function arpeggiate(notes: readonly HeardNote[], sound: InstrumentSound): void {
  resume();
  player.arpeggiate(notes, sound);
}

/** Resumes the audio context while the press that asked for it still counts, as browsers require. */
function resume() {
  void audioContext()
    .resume()
    .catch(() => {});
}

/** Plays notes one after another, `gap` seconds apart, each left ringing, from their samples. */
function play({ notes, gap, sound }: Played<AudioBuffer>): void {
  const context = audioContext();
  cutOff(context);
  const gain = context.createGain();
  gain.gain.value = sound.set.gain;
  gain.connect(context.destination);
  const start = context.currentTime + 0.01;
  const sources = notes.map((note, i) => {
    const source = context.createBufferSource();
    const { sample, rate } = sampleFor(sound.set, note);
    source.buffer = sound.samples.get(sample) ?? null;
    source.playbackRate.value = rate;
    source.connect(gain);
    source.start(start + i * gap);
    return source;
  });
  const played = { gain, sources };
  ringing = played;
  // Notes pitched down ring longer than those after them, so it's done once every one has ended.
  let ringingNotes = sources.length;
  for (const source of sources) {
    source.onended = () => {
      if (--ringingNotes > 0) return;
      if (ringing === played) ringing = null;
      gain.disconnect();
    };
  }
}

/** Fades out the Hear or Arpeggiate still ringing, quickly enough to sound cut off, slowly enough not to click. */
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
