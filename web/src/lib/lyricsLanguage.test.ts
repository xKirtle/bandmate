import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { lyricsLanguage, readLanguageData } from './lyricsLanguage';

const built = (file: string) =>
  gunzipSync(readFileSync(new URL(`../../../internal/languagedata/${file}`, import.meta.url))).toString('utf8');
// Each Language's data as the binary serves it: its dictionary (for
// English, the CMU Pronouncing Dictionary; for Portuguese, a word list),
// then its ranks, its words most common first.
const served = (code: string) =>
  readLanguageData(code, `${built(`${code}.txt.gz`)}#ranks\n${built(`${code}.ranks.txt.gz`)}`);
// As a device kept it before the ranks shipped: the dictionary alone.
const unranked = (code: string) => readLanguageData(code, built(`${code}.txt.gz`));
const english = served('en');
const portugueseWords = served('pt');
const lyrics = lyricsLanguage([english]);

describe('the order of Rhymes', () => {
  const words = (list: { word: string }[]) => list.map((r) => r.word);
  // A dictionary of a few words, "long" the most common and "strong" the least of those ranked.
  const dictionary = (lines: string[]) =>
    lyricsLanguage([
      readLanguageData(
        'en',
        [
          'wrong R AO1 NG',
          'long L AO1 NG',
          'song S AO1 NG',
          'strong S T R AO1 NG',
          'belong B IH0 L AO1 NG',
          'prolong P R OW0 L AO1 NG',
          'aung AO1 NG',
          'cong K AO1 NG',
          'gone G AO1 N',
          'dog D AO1 G',
          'boss B AO1 S',
          ...lines,
        ].join('\n'),
      ),
    ]);
  const ranked = dictionary(['#ranks', 'long', 'gone', 'song', 'belong', 'dog', 'strong']);

  it('lists common words first, perfect and near Rhymes alike', () => {
    const { perfect, near } = ranked.rhymes('wrong', 'en')!;
    expect(words(perfect).slice(0, 4)).toEqual(['long', 'song', 'belong', 'strong']);
    expect(words(near).slice(0, 2)).toEqual(['gone', 'dog']);
  });

  it('lists words it has no rank for after every ranked one, nearest in syllables, then alphabetically', () => {
    const { perfect, near } = ranked.rhymes('wrong', 'en')!;
    expect(words(perfect).slice(4)).toEqual(['aung', 'cong', 'prolong']);
    expect(words(near).slice(2)).toEqual(['boss']);
  });

  it('orders by syllables, then alphabetically, without ranks, as a dictionary kept before they shipped is', () => {
    const { perfect } = dictionary([]).rhymes('wrong', 'en')!;
    expect(words(perfect)).toEqual(['aung', 'cong', 'long', 'song', 'strong', 'belong', 'prolong']);
  });

  it('lists the common Rhymes of “wrong” before names and rare words', () => {
    const first = words(lyrics.rhymes('wrong', 'en')!.perfect.slice(0, 5));
    expect(first).toEqual(expect.arrayContaining(['long', 'song', 'strong']));
    expect(first).not.toContain('aung');
    expect(first).not.toContain('cong');
  });

  it('ranks Portuguese words spelt as before the spelling reform by their new spelling', () => {
    const both = lyricsLanguage([english, portugueseWords]);
    const first = words(both.rhymes('coração', 'pt')!.perfect.slice(0, 10));
    expect(first).toEqual(expect.arrayContaining(['não', 'então', 'mão']));
    // "ação" is said mostly as "acção" in the subtitles, and outranks rarer words once that counts.
    const perfect = words(both.rhymes('canção', 'pt')!.perfect);
    expect(perfect.indexOf('ação')).toBeLessThan(perfect.indexOf('aldeão'));
  });
});

describe('rhymes', () => {
  const rhymes = (word: string) => lyrics.rhymes(word, 'en');

  it('gives perfect Rhymes, each with its Syllable Count', () => {
    const { perfect, guess } = rhymes('night')!;
    expect(guess).toBe(false);
    expect(perfect).toContainEqual({ word: 'bright', count: 1 });
    expect(perfect).toContainEqual({ word: 'tonight', count: 2 });
    expect(perfect).toContainEqual({ word: 'satellite', count: 3 });
  });

  it('gives near Rhymes, matching only the vowels, apart from the perfect ones', () => {
    const { perfect, near } = rhymes('night')!;
    expect(near).toContainEqual({ word: 'life', count: 1 });
    expect(near).toContainEqual({ word: 'surprise', count: 2 });
    expect(near.map((r) => r.word)).not.toContain('bright');
    expect(perfect.map((r) => r.word)).not.toContain('life');
  });

  it('matches from the last stressed vowel', () => {
    const { perfect, near } = rhymes('happy')!;
    expect(perfect).toContainEqual({ word: 'snappy', count: 2 });
    expect(perfect.map((r) => r.word)).not.toContain('sunny');
    expect(near).toContainEqual({ word: 'sadly', count: 2 });
  });

  it('lists the Rhymes nearest the word in syllables first, among words it has no rank for', () => {
    const counts = lyricsLanguage([unranked('en')])
      .rhymes('night', 'en')!
      .perfect.map((r) => r.count);
    expect(counts.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('leaves out the word itself', () => {
    const { perfect, near } = rhymes('Night')!;
    expect([...perfect, ...near].map((r) => r.word)).not.toContain('night');
  });

  it('gives no Rhymes for a word the dictionary does not have, or when it is not set up', () => {
    expect(rhymes('skrrt')).toBeNull();
    expect(lyricsLanguage([]).rhymes('night', 'en')).toBeNull();
  });
});

describe('rhymes in Portuguese', () => {
  const both = lyricsLanguage([english, portugueseWords]);
  const rhymes = (word: string) => both.rhymes(word, 'pt');
  const words = (list: { word: string }[]) => list.map((r) => r.word);

  it('gives perfect Rhymes from the word list, each with its Syllable Count', () => {
    const { perfect } = rhymes('coração')!;
    expect(perfect).toContainEqual({ word: 'canção', count: 2 });
    expect(perfect).toContainEqual({ word: 'paixão', count: 2 });
    expect(perfect).toContainEqual({ word: 'mão', count: 1 });
    expect(perfect).toContainEqual({ word: 'solidão', count: 3 });
  });

  it('gives near Rhymes, matching only the vowels, apart from the perfect ones', () => {
    const { perfect, near } = rhymes('amor')!;
    expect(perfect).toContainEqual({ word: 'flor', count: 1 });
    expect(near).toContainEqual({ word: 'sol', count: 1 });
    expect(near).toContainEqual({ word: 'voz', count: 1 });
    expect(words(near)).not.toContain('flor');
    expect(words(perfect)).not.toContain('sol');
  });

  it('matches from the stressed syllable, as the spelling rules find it', () => {
    // On the next to last syllable: a word ending in a, e or o, or in am, em or ens.
    expect(words(rhymes('saudade')!.perfect)).toContain('cidade');
    expect(words(rhymes('noite')!.perfect)).toContain('afoite');
    // On the last: any other ending.
    expect(words(rhymes('cantar')!.perfect)).toContain('mar');
    expect(words(rhymes('aqui')!.perfect)).toContain('ali');
    // Where an accent marks it.
    expect(words(rhymes('história')!.perfect)).toContain('glória');
    expect(words(rhymes('café')!.perfect)).toContain('pé');
    expect(words(rhymes('história')!.perfect)).not.toContain('ria');
  });

  it('matches endings spelt apart but said alike', () => {
    expect(words(rhymes('dança')!.perfect)).toContain('cansa');
    expect(words(rhymes('beleza')!.perfect)).toContain('mesa');
    expect(words(rhymes('praça')!.perfect)).toContain('massa');
    expect(words(rhymes('você')!.perfect)).toContain('porquê');
  });

  it('reads a word the list lacks by the rules, however its accents were typed, as a guess', () => {
    expect(words(rhymes('saudadezinha')!.perfect)).toContain('rainha');
    expect(rhymes('saudadezinha')!.guess).toBe(true);
    expect(rhymes('coração')!.guess).toBe(false);
    expect(rhymes('coração'.normalize('NFD'))).toEqual(rhymes('coração'));
  });

  it('lists the Rhymes nearest the word in syllables first among words it has no rank for, and leaves out the word itself', () => {
    const counts = lyricsLanguage([unranked('pt')])
      .rhymes('coração', 'pt')!
      .perfect.map((r) => r.count);
    expect(counts.slice(0, 5)).toEqual([3, 3, 3, 3, 3]);
    const { perfect, near } = rhymes('Coração')!;
    expect([...perfect, ...near].map((r) => r.word)).not.toContain('coração');
  });

  it('gives no Rhymes for a word with no vowel to read, or when the word list is not set up', () => {
    expect(rhymes('hmm')).toBeNull();
    expect(rhymes('24')).toBeNull();
    expect(lyrics.rhymes('coração', 'pt')).toBeNull();
  });
});

describe("each Portuguese Rhyme's Syllable Count", () => {
  const both = lyricsLanguage([english, portugueseWords]);
  // A word's count as it shows beside it among the Rhymes of a word it rhymes with.
  const countAsRhyme = (word: string) => {
    const { perfect, near } = both.rhymes(word, 'pt')!;
    const partner = [...perfect, ...near][0].word;
    const rhymes = both.rhymes(partner, 'pt')!;
    return [...rhymes.perfect, ...rhymes.near].find((r) => r.word === word)?.count;
  };

  // Each word's written syllables, as a Portuguese dictionary splits them.
  const words: [string, number][] = [
    ['amor', 2], // a-mor
    ['casa', 2], // ca-sa
    ['coração', 3], // co-ra-ção: a nasal diphthong
    ['corações', 3], // co-ra-ções
    ['mãe', 1], // mãe
    ['pão', 1], // pão
    ['cantam', 2], // can-tam
    ['também', 2], // tam-bém
    ['noite', 2], // noi-te: a diphthong
    ['saudade', 3], // sau-da-de
    ['europeu', 3], // eu-ro-peu
    ['chapéu', 2], // cha-péu
    ['herói', 2], // he-rói
    ['muito', 2], // mui-to
    ['praia', 2], // prai-a
    ['areia', 3], // a-rei-a
    ['dia', 2], // di-a: a hiatus
    ['rua', 2], // ru-a
    ['história', 4], // his-tó-ri-a
    ['poeta', 3], // po-e-ta
    ['coelho', 3], // co-e-lho
    ['teatro', 3], // te-a-tro
    ['voo', 2], // vo-o
    ['saúde', 3], // sa-ú-de: an accent makes a hiatus
    ['país', 2], // pa-ís
    ['pais', 1], // pais
    ['ruído', 3], // ru-í-do
    ['rainha', 3], // ra-i-nha: before nh
    ['ainda', 3], // a-in-da: before a closing n
    ['cair', 2], // ca-ir: before a closing r
    ['ruim', 2], // ru-im
    ['juiz', 2], // ju-iz
    ['reino', 2], // rei-no: an n that opens the next syllable
    ['quero', 2], // que-ro: a silent u
    ['guitarra', 3], // gui-tar-ra
    ['quando', 2], // quan-do
    ['água', 2], // á-gua
    ['iguais', 2], // i-guais
    ['averiguai', 4], // a-ve-ri-guai
    ['frequente', 3], // fre-quen-te
    ['partiu', 2], // par-tiu
    ['traição', 3], // tra-i-ção: before ç
    ['intuição', 4], // in-tu-i-ção
    ['instituição', 5], // ins-ti-tu-i-ção
    ['eleição', 3], // e-lei-ção: but a diphthong after e
    ['reunião', 4], // re-u-ni-ão: a hiatus some words start with
    ['proibido', 4], // pro-i-bi-do
    ['suicídio', 5], // su-i-cí-di-o
    ['miudinho', 4], // mi-u-di-nho
    ['cairá', 3], // ca-i-rá
  ];

  it.each(words)('counts “%s” as %i, by Portuguese spelling rules', (word, syllables) => {
    expect(countAsRhyme(word)).toBe(syllables);
  });
});

describe('languageOf', () => {
  const both = lyricsLanguage([english, portugueseWords]);

  it("gives the first of the Song's Languages whose dictionary has the word, in the Song's order", () => {
    expect(both.languageOf('night', ['pt', 'en'])).toBe('en');
    expect(both.languageOf('Saudade', ['en', 'pt'])).toBe('pt');
    expect(both.languageOf('coração', ['pt'])).toBe('pt');
  });

  it("settles a word in both dictionaries by the Song's order", () => {
    expect(both.languageOf('eu', ['pt', 'en'])).toBe('pt');
    expect(both.languageOf('eu', ['en', 'pt'])).toBe('en');
    expect(both.languageOf('mar', ['pt', 'en'])).toBe('pt');
  });

  it("gives the first Language with spelling rules for a word in no dictionary, once all of the Song's are set up", () => {
    expect(both.languageOf('saudadezinha', ['en', 'pt'])).toBe('pt');
    expect(both.languageOf('24', ['en', 'pt'])).toBe('pt');
  });

  it("gives the Song's first Language for a word in no dictionary when none of its Languages has spelling rules", () => {
    expect(both.languageOf('skrrt', ['en'])).toBe('en');
  });

  it("never guesses at a Language that isn't set up", () => {
    const englishOnly = lyricsLanguage([english]);
    expect(englishOnly.languageOf('night', ['pt', 'en'])).toBe('en');
    expect(englishOnly.languageOf('saudade', ['en', 'pt'])).toBeNull();
    expect(englishOnly.languageOf('saudadezinha', ['pt'])).toBeNull();
    expect(lyricsLanguage([portugueseWords]).languageOf('night', ['en', 'pt'])).toBeNull();
    expect(lyricsLanguage([portugueseWords]).languageOf('saudade', ['en', 'pt'])).toBe('pt');
  });

  it('gives none for a Song without Languages', () => {
    expect(both.languageOf('night', [])).toBeNull();
  });
});

describe('isSetUp', () => {
  it('tells the Languages whose dictionaries it was given', () => {
    const portugueseOnly = lyricsLanguage([portugueseWords]);
    expect(portugueseOnly.isSetUp('pt')).toBe(true);
    expect(portugueseOnly.isSetUp('en')).toBe(false);
  });
});

describe('wordAt', () => {
  const at = (marked: string) => lyrics.wordAt(marked.replace('|', ''), marked.indexOf('|'));

  it('gives the word at the caret', () => {
    expect(at('Hello dark|ness my old friend')).toBe('darkness');
    expect(at('Hello |darkness')).toBe('darkness');
    expect(at('Hello darkness|')).toBe('darkness');
  });

  it("gives the Line's last word when the caret is past it", () => {
    expect(at('Hello darkness, my old friend. |')).toBe('friend');
  });

  it('reads only the Line the caret is on', () => {
    expect(at('Hello darkness\nmy old fr|iend\nagain')).toBe('friend');
    expect(at('Hello darkness\n|')).toBeNull();
  });

  it('leaves Chords out, and parts hyphenated words', () => {
    expect(at('Hello [Am]|')).toBe('hello');
    expect(at('[Am]|')).toBeNull();
    expect(at('Hel[Am]lo dark[C]ness|')).toBe('darkness');
    expect(at('Hel[A|m]lo')).toBe('hello');
    expect(at('ooh-a|ah')).toBe('aah');
  });
});
