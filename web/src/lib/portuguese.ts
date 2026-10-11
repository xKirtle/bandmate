// Portuguese, a spelling-rules Language: a word's syllables are counted from
// how it's written, as a dictionary splits them, with no data. Only the
// lyrics language module (lyricsLanguage.ts) uses this.

const vowels = 'aeiouyáàâãéêíóôõúü';

function isVowel(letter: string | undefined): boolean {
  return letter !== undefined && vowels.includes(letter);
}

/**
 * A Portuguese word's syllables as written: one for each vowel that isn't a
 * glide in a diphthong, or a silent u. Null for a word with no vowel.
 */
export function portugueseSyllables(word: string): number | null {
  const letters = [...word.normalize('NFC').toLowerCase().replace(/['’‘]/g, '')];
  let count = 0;
  let afterGlide = false;
  letters.forEach((letter, i) => {
    const glide = isVowel(letter) && !afterGlide && isGlide(letters, i);
    if (isVowel(letter) && !glide) count++;
    afterGlide = glide;
  });
  return count > 0 ? count : null;
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
  // a hiatus: rainha, ainda, cair, ruim, juiz, but reino.
  const rest = letters.slice(i + 1).join('');
  return !/^nh/.test(rest) && !new RegExp(`^[lmnrz](?![${vowels}])`).test(rest);
}

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
