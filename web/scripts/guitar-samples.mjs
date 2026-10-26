// Makes the guitar's recorded samples (ADR 0030, #1209) from the University
// of Iowa Musical Instrument Samples' guitar, a Raimundo 118 nylon-string
// classical recorded string by string: frets 0, 3, 6, 9 and 12 of each
// standard string, 30 files, written to <out>/<string's open note>/<note>.mp3.
//
// Iowa records each string as chromatic scales, one note after another with
// silence between, so this downloads them, checks each against the checksum
// it had when the set was picked (Iowa's URLs carry no version, so a changed
// file stops it rather than changing the samples), splits them into notes,
// and names each note by its pitch. Each note is cut from its pluck, retuned
// to A440 (the recordings run about 20 cents flat), levelled, and encoded as
// the piano's are (#1205): 4.5 s with a 0.3 s fade out, mono, 44.1 kHz, MP3
// at 96 kb/s.
//
// samples.sh runs it: node web/scripts/guitar-samples.mjs <out folder>. It
// needs network access, curl and an ffmpeg with libmp3lame.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rate = 44100;
const iowa = 'https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/guitar/';

/** Each string Iowa recorded, by the name its files use, and its open note: standardTuning's in guitarTuning.ts, thickest first. */
const strings = [
  { sul: 'sulE', open: 40 },
  { sul: 'sulA', open: 45 },
  { sul: 'sulD', open: 50 },
  { sul: 'sulG', open: 55 },
  { sul: 'sulB', open: 59 },
  { sul: 'sul_E', open: 64 },
];
/** The frets recorded on each string: every 3, so no note is pitch-shifted more than a semitone. guitar.ts plays these. */
const frets = [0, 3, 6, 9, 12];

/** The files taken, mono, and each one's SHA-256 when the set was picked. */
const originals = {
  'Guitar.mf.sulE.E2B2.mono.aif': 'faef0e44dff6fcf99b2bd1cb50ab1ed519980e6c70951069cdbce38597c58b23',
  'Guitar.mf.sulE.C3B3.mono.aif': '1d379b581a6cc899c36d436fd776dee5ff634c7e11ba237e2bed0ec1e43b79c3',
  'Guitar.mf.sulA.A2B2.mono.aif': 'a298fddd7cc2d5e83eb63852360040dc87b63caa1638cf82589f8614e158525c',
  'Guitar.mf.sulA.C3B3.mono.aif': 'df38afee2f363a8a4262384e496e7de0720318be10851f10b18f7285464ae985',
  'Guitar.ff.sulA.C3B3.mono.aif': '39904825e7dff5570cb19157f345e0af3be9bad0741cc60cf35cd2b7763731ba',
  'Guitar.mf.sulD.D3B3.mono.aif': '464a66a5fbd4c8f835bcddfeb9c875ee2d75e81e156cfe80a362473681c9ffa7',
  'Guitar.mf.sulD.C4Ab4.mono.aif': '0d57284a40691bd79582694d0b0234cd89356e8cbaf3b5efb3b7aef001d02932',
  'Guitar.mf.sulG.G3B3.mono.aif': '6e9bcd0b29470ba131aa43d08e51f94b9daaf00a16fff07f52be95196d48bece',
  'Guitar.mf.sulG.C4B4.mono.aif': 'fcf0e48ce128c8703219cea324a33842bdf5100aa35429100834fe67f8930704',
  'Guitar.mf.sulB.B3.mono.aif': '5afbcddce7bb8a2135232872984a6d2403ff3da1c1daaf03dacb17f29b454489',
  'Guitar.mf.sulB.C4B4.mono.aif': '2a78d4e9e2126ac802d1382d9fe8b90cb98a200f7c4d39d7f69b3f12a6fc7879',
  'Guitar.mf.sul_E.E4B4.mono.aif': '3c04d367aa3cdf9fa4c9cd6ba3591704de6da5917a714057b307699d1ed6128b',
  'Guitar.mf.sul_E.C5B5.mono.aif': 'eb107a42ac344d186c52ab82d4d668697045a23c48972728d3fd31f0f85ed1ec',
};

/**
 * Takes that need a hand, by string and note:
 * - the A string's F#3 is plucked twice in mf, so it's taken from ff;
 * - the low E's C#3 and the top E's F4 have no silence before them, so
 *   they're cut from the note before, from their pluck after the time given.
 */
const fixes = {
  'sulA 54': { dynamic: 'ff' },
  'sulE 49': { after: { note: 48, seconds: 9.5 } },
  'sul_E 65': { after: { note: 64, seconds: 7 } },
};

/**
 * How loud each note's first second is, in dB RMS, by MIDI note: the level
 * of the guitar samples these replaced (#1207), fitted to a line, so a strum
 * sits where it did, 8 dB down for headroom, which the set's gain makes up.
 */
const levelAt = (midi) => -14.515 - 0.2004 * (midi - 40) - 8;

// Files are named as samples.ts's sampleFileName names them.
const sharpNames = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const noteName = (midi) => sharpNames[midi % 12] + (Math.floor(midi / 12) - 1);
const flatNames = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const readNote = (name) => flatNames[name.slice(0, -1)] + 12 * (Number(name.slice(-1)) + 1);

const dB = (x) => 20 * Math.log10(x + 1e-12);
function rms(x, from = 0, to = x.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** A file decoded to mono at 44.1 kHz. */
function decode(path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', `${rate}`, '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** Each 10 ms frame's level, in dB. */
function frames(x, count = Math.floor(x.length / 441)) {
  return Array.from({ length: Math.min(count, Math.floor(x.length / 441)) }, (_, i) =>
    dB(rms(x, i * 441, (i + 1) * 441)),
  );
}

/**
 * A scale file's notes: each run of sound at least 2 s long between digital
 * silence (under -80 dB, more than 50 ms of it), from where it comes within
 * 30 dB of its loudest.
 */
function split(x) {
  const level = frames(x);
  const sounding = level.map((l) => l > -80);
  const notes = [];
  for (let i = 0; i < level.length;) {
    if (!sounding[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < level.length && sounding.slice(j, j + 5).some(Boolean)) j++;
    if (j - i > 200) {
      const loudest = Math.max(...level.slice(i, j));
      let k = i;
      while (level[k] < loudest - 30) k++;
      notes.push(x.subarray(k * 441, j * 441));
    }
    i = j;
  }
  return notes;
}

/** A note from its pluck: back from its loudest 10 ms in the first second to 25 dB below it, less 5 ms. */
function fromPluck(x) {
  const level = frames(x, 100);
  const loudest = Math.max(...level);
  let k = level.indexOf(loudest);
  while (k > 0 && level[k - 1] > loudest - 25) k--;
  return x.subarray(Math.max(0, k * 441 - 220));
}

/** Where a note starts after `seconds`: the first 10 ms 20 dB louder than the quietest of the 50 ms before. */
function pluckAfter(x, seconds) {
  const level = frames(x);
  for (let i = Math.floor((seconds * rate) / 441) + 5; i < level.length; i++) {
    if (level[i] > Math.min(...level.slice(i - 5, i)) + 20) return x.subarray((i - 5) * 441);
  }
  throw new Error(`no note after ${seconds} s`);
}

/** A note's pitch as a fractional MIDI note number: its period, by autocorrelation over 0.3–1.3 s, the peak interpolated. */
function pitch(x) {
  const from = Math.round(0.3 * rate);
  const length = rate - 1;
  // Differenced, so low rumble doesn't read as the note.
  const seg = new Float64Array(length);
  for (let i = 0; i < length; i++) seg[i] = x[from + i + 1] - x[from + i];
  const longest = Math.floor(rate / 60);
  const ac = new Float64Array(longest + 2);
  for (let lag = 0; lag < ac.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < length; i++) sum += seg[i] * seg[i + lag];
    ac[lag] = sum;
  }
  // Past the main lobe, the first peak near the highest is the period, not a multiple of it.
  let lag = ac.findIndex((a) => a < 0.2 * ac[0]);
  const highest = Math.max(...ac.subarray(lag, longest));
  while (!(ac[lag] > 0.85 * highest && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1])) lag++;
  const [a, b, c] = [ac[lag - 1], ac[lag], ac[lag + 1]];
  const curve = a - 2 * b + c;
  const period = lag + (curve === 0 ? 0 : (0.5 * (a - c)) / curve);
  return 69 + 12 * Math.log2(rate / period / 440);
}

/** How far a pitch is from a note, in cents, an octave out read as none: a note's 2nd harmonic can read as it. */
function centsOff(measured, midi) {
  const off = measured - midi;
  return (off - 12 * Math.round(off / 12)) * 100;
}

/** A scale file's notes, by MIDI note: each named by its pitch, an octave out moved into the file's range. */
function notesOf(path, name) {
  const [, , , range] = name.split('.');
  const [first, last = first] = range.match(/[A-G]b?\d/g).map(readNote);
  const found = new Map();
  for (const note of split(decode(path))) {
    let midi = Math.round(pitch(note));
    while (midi > last) midi -= 12;
    while (midi < first) midi += 12;
    found.set(midi, note);
  }
  return found;
}

const out = process.argv[2];
if (!out) throw new Error('usage: node guitar-samples.mjs <out folder>');
const src = mkdtempSync(join(tmpdir(), 'iowa-guitar-'));
try {
  const scales = {};
  for (const [name, sum] of Object.entries(originals)) {
    const path = join(src, name);
    execFileSync('curl', ['-sSf', '-o', path, iowa + name]);
    const got = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (got !== sum) throw new Error(`${name} has changed upstream: sha256 ${got}, picked as ${sum}`);
    scales[name] = notesOf(path, name);
  }
  const take = (dynamic, sul, midi) => {
    for (const [name, notes] of Object.entries(scales)) {
      if (name.startsWith(`Guitar.${dynamic}.${sul}.`) && notes.has(midi)) return notes.get(midi);
    }
    throw new Error(`no ${dynamic} ${noteName(midi)} on ${sul}`);
  };

  for (const { sul, open } of strings) {
    const folder = join(out, noteName(open));
    mkdirSync(folder, { recursive: true });
    for (const fret of frets) {
      const midi = open + fret;
      const fix = fixes[`${sul} ${midi}`] ?? {};
      const note = fromPluck(
        fix.after
          ? pluckAfter(take('mf', sul, fix.after.note), fix.after.seconds)
          : take(fix.dynamic ?? 'mf', sul, midi),
      );
      const cents = centsOff(pitch(note), midi);
      if (Math.abs(cents) > 50) throw new Error(`${sul} ${noteName(midi)} is ${cents.toFixed(0)} cents out`);
      const raw = join(src, 'note.f32');
      writeFileSync(raw, note);
      const path = join(folder, `${noteName(midi)}.mp3`);
      // Retuned by resampling: a note 20 cents flat plays 20 cents faster.
      const retuned = rate * 2 ** (-cents / 1200);
      const gain = levelAt(midi) - dB(rms(note, 0, rate));
      execFileSync('ffmpeg', [
        ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', `${rate}`, '-ac', '1', '-i', raw],
        '-af',
        `asetrate=${retuned.toFixed(3)},aresample=${rate},volume=${gain.toFixed(2)}dB,` +
          'silenceremove=start_periods=1:start_threshold=-50dB,atrim=0:4.5,afade=t=out:st=4.2:d=0.3',
        ...['-ac', '1', '-ar', `${rate}`, '-c:a', 'libmp3lame', '-b:a', '96k', path],
      ]);
      // Skips the encoder's delay before measuring.
      const now = centsOff(pitch(decode(path).subarray(1200)), midi);
      if (Math.abs(now) > 5) throw new Error(`${path} came out ${now.toFixed(0)} cents out`);
      console.log(`${noteName(open)}/${noteName(midi)}: was ${cents.toFixed(0)} cents, now ${now.toFixed(0)}`);
    }
  }
} finally {
  rmSync(src, { recursive: true, force: true });
}
