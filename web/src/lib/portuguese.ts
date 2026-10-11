// Portuguese, a spelling-rules Language: a word's syllables, and how it ends
// for its Rhymes, are worked out from how it's written, as a dictionary
// splits it, with no data. Only the lyrics language module
// (lyricsLanguage.ts) uses this.

import type { Sound } from './lyricsLanguage';

const vowels = 'aeiouyáàâãéêíóôõúü';

function isVowel(letter: string | undefined): boolean {
  return letter !== undefined && vowels.includes(letter);
}

/**
 * A Portuguese word's syllables as written: one for each vowel that isn't a
 * glide in a diphthong, or a silent u. The word comes as the lyrics language
 * module looks words up: composed, in lower case. Null for one with no vowel.
 */
export function portugueseSyllables(word: string): number | null {
  const count = syllableVowels([...word.replace(/'/g, '')]).length;
  return count > 0 ? count : null;
}

/**
 * How a Portuguese word sounds, as its Rhymes are found: its syllables, as
 * portugueseSyllables counts them, and how it ends, from the vowel of its
 * stressed syllable. The spelling rules find that syllable: an acute or
 * circumflex accent marks it, or else a tilde; or else a word ending in a,
 * e or o, alone or before s, or in am, em or ens, is stressed on its next
 * to last syllable, and any other on its last. The word comes as for
 * portugueseSyllables. Null for one with no vowel.
 */
export function portugueseSound(word: string): Sound | null {
  const letters = [...word.replace(/'/g, '')];
  const nuclei = syllableVowels(letters);
  if (nuclei.length === 0) return null;
  const stressed = stressedSyllable(letters.join(''), letters, nuclei);
  const ending = letters.slice(nuclei[stressed]).join('');
  return {
    count: nuclei.length,
    ending: {
      sounds: soundsOf(ending),
      vowels: nuclei
        .slice(stressed)
        .map((i) => plain(letters[i]))
        .join(' '),
      length: ending.length,
    },
  };
}

/** Where each syllable's vowel is in a word's letters: each vowel that isn't a glide in a diphthong, or a silent u. */
function syllableVowels(letters: readonly string[]): number[] {
  const nuclei: number[] = [];
  let afterGlide = false;
  letters.forEach((letter, i) => {
    const glide = isVowel(letter) && !afterGlide && isGlide(letters, i);
    if (isVowel(letter) && !glide) nuclei.push(i);
    afterGlide = glide;
  });
  return nuclei;
}

/** Which of a word's syllables, counted from 0, is stressed. */
function stressedSyllable(word: string, letters: readonly string[], nuclei: readonly number[]): number {
  const lastWhere = <T>(list: readonly T[], test: (item: T) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
    return -1;
  };
  const marked = (accents: string) => {
    const at = lastWhere(letters, (letter) => accents.includes(letter));
    // An accent on a glide, as in a word written oddly, marks the syllable it's in.
    return at < 0 ? -1 : lastWhere(nuclei, (i) => i <= at);
  };
  const accented = marked('áéíóúâêô');
  if (accented >= 0) return accented;
  const nasal = marked('ãõ');
  if (nasal >= 0) return nasal;
  const last = nuclei.length - 1;
  return /([aeo]s?|am|em|ens)$/.test(word) ? Math.max(0, last - 1) : last;
}

/** A vowel without its acute, grave or circumflex accent, which make it open or closed; a tilde, nasal, stays. */
function plain(letter: string): string {
  return plainVowels[letter] ?? letter;
}

const plainVowels: Record<string, string> = {
  á: 'a',
  à: 'a',
  â: 'a',
  é: 'e',
  ê: 'e',
  í: 'i',
  ó: 'o',
  ô: 'o',
  ú: 'u',
  ü: 'u',
};

/**
 * An ending's letters as they sound, so endings spelt apart but said alike
 * match: dança and cansa, beleza and mesa, praça and massa. Vowels lose
 * their open or closed accents; the s sound, however it's spelt, is S;
 * and z, said like s between vowels or at the end, is s.
 */
function soundsOf(ending: string): string {
  return [...ending]
    .map(plain)
    .join('')
    .replace(/s?c(?=[ei])|ç|ss|(?<=[^aeiouãõ])s(?=.)/g, 'S')
    .replace(/z/g, 's')
    .replace(/g(?=[ei])/g, 'j');
}

/**
 * Whether the vowel at i shares the syllable of the vowel next to it, the
 * one before it not being a glide itself.
 */
function isGlide(letters: readonly string[], i: number): boolean {
  const [before, letter, after] = [letters[i - 1], letters[i], letters[i + 1]];
  // A u after q or g, before a vowel, is silent or a glide: que, quando, guitarra, água.
  if ((letter === 'u' || letter === 'ü') && (before === 'q' || before === 'g') && isVowel(after)) return true;
  if (!isVowel(before)) return false;
  // The nasal diphthongs: pão, mãe, corações.
  if ((before === 'ã' || before === 'õ') && (letter === 'o' || letter === 'e')) return true;
  // Only an unaccented i or u after another vowel makes a diphthong with it,
  // and not after itself: noite, pais, saudade, but voo, xiita.
  if (!'iuy'.includes(letter) || before === letter) return false;
  // Before nh, or a consonant of l, m, n, r or z that ends the syllable, it's
  // a hiatus: rainha, ainda, cair, ruim, juiz, but reino. So it is before ç
  // after an a or u, as in traição and intuição, but not eleição; and in
  // words starting as some do, such as reunião and proibido.
  const rest = letters.slice(i + 1).join('');
  if (/^nh/.test(rest) || closingConsonant.test(rest)) return false;
  if (rest.startsWith('ç') && (before === 'a' || before === 'u')) return false;
  const word = letters.join('');
  return !hiatusStarts.some((start) => i < start.length && word.startsWith(start));
}

/** An l, m, n, r or z that ends a syllable, as it's followed by no vowel. */
const closingConsonant = new RegExp(`^[lmnrz](?![${vowels}])`);

/** Starts of words whose last two vowels make a hiatus that no other rule finds. */
const hiatusStarts = ['reun', 'proib', 'suic', 'druid', 'miud', 'cair', 'sair'];

const ones = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quinze',
  'dezasseis',
  'dezassete',
  'dezoito',
  'dezanove',
];
const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const hundreds = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

function belowHundred(n: number): string[] {
  if (n < 20) return [ones[n]];
  return n % 10 === 0 ? [tens[Math.floor(n / 10)]] : [tens[Math.floor(n / 10)], 'e', ones[n % 10]];
}

function belowThousand(n: number): string[] {
  if (n < 100) return belowHundred(n);
  if (n === 100) return ['cem'];
  const rest = n % 100;
  return [hundreds[Math.floor(n / 100)], ...(rest ? ['e', ...belowHundred(rest)] : [])];
}

/** A number in Portuguese words ("mil novecentos e noventa e nove"); a long one, digit by digit. */
export function portugueseNumber(digits: string): string[] {
  const n = Number(digits);
  if ((digits.length > 1 && digits.startsWith('0')) || n >= 1_000_000) return [...digits].map((d) => ones[Number(d)]);
  if (n < 1000) return belowThousand(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? ['mil'] : [...belowThousand(thousands), 'mil'];
  if (rest === 0) return head;
  return rest < 100 || rest % 100 === 0 ? [...head, 'e', ...belowThousand(rest)] : [...head, ...belowThousand(rest)];
}
