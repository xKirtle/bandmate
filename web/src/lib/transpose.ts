// Transpose: reading a Chord name's root, and a slash chord's bass note, and
// moving them by semitones. Everything else in the name is kept as written,
// and a name that can't be read stays as written.

const notes = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const naturals: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const accidentals: Record<string, number> = { '#': 1, '♯': 1, b: -1, '♭': -1, '': 0 };

/** A readable note at the start of text: a capital A–G, optionally followed by #, b, ♯ or ♭. */
const note = /^([A-G])([#b♯♭]?)/u;

/** The note at the start of text moved by semitones, with the rest of text as written. */
function moveNote(m: RegExpExecArray, text: string, by: number): string {
  const at = naturals[m[1]] + accidentals[m[2]];
  return notes[(((at + by) % 12) + 12) % 12] + text.slice(m[0].length);
}

/** A Chord name moved by semitones. */
export function transposeChord(name: string, by: number): string {
  const root = note.exec(name);
  if (!root || by % 12 === 0) return name;
  const slash = name.lastIndexOf('/');
  const bass = slash > 0 ? note.exec(name.slice(slash + 1)) : null;
  if (!bass) return moveNote(root, name, by);
  return moveNote(root, name.slice(0, slash), by) + '/' + moveNote(bass, name.slice(slash + 1), by);
}
