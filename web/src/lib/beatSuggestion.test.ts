import { describe, expect, it } from 'vitest';
import { suggestBeatDetails } from './beatSuggestion';

describe('suggestBeatDetails from a filename', () => {
  it.each([
    ['dark_trap_140bpm_Am.wav', 140, 'Am'],
    ['Sunset 92 BPM F#m.mp3', 92, 'F#m'],
    ['sunset - BPM 92 - Ebmin.flac', 92, 'Ebm'],
    ['sunset-128-Cmaj.wav', 128, 'C'],
    ['sunset (A minor, 85bpm).ogg', 85, 'Am'],
    ['sunset_Bb_major_100.wav', 100, 'Bb'],
    ['sunset [C♯m] [140 bpm].mp3', 140, 'C#m'],
    ['sunset 140.5bpm Gm.wav', 141, 'Gm'],
    ['sunset_D.wav', null, ''],
    ['sunset.mp3', null, ''],
    ['I am the beat.mp3', null, ''],
    ['A Day Away.mp3', null, ''],
    ['Track 01.mp3', null, ''],
    ['sunset 2024.mp3', null, ''],
    ['Emotions.mp3', null, ''],
    ['sunset_Dm7.wav', null, ''],
    ['sunset Dm 140.wav', 140, 'Dm'],
    ['Nights 120bpm F# m.wav', 120, 'F#m'],
    ['Who Am I.mp3', null, ''],
    ['I Am Legend 140bpm.mp3', 140, ''],
    ['Ab-Soul Type Beat.mp3', null, ''],
    ['Blink 182.mp3', null, ''],
    ['Room 101.mp3', null, ''],
  ])('%s gives BPM %s and key %s', (fileName, bpm, key) => {
    const suggestion = suggestBeatDetails(fileName);

    expect(suggestion.bpm).toBe(bpm);
    expect(suggestion.key).toBe(key);
  });
});

describe('suggestBeatDetails title from a filename', () => {
  it.each([
    ['dark_trap_140bpm_Am.wav', 'Dark Trap'],
    ['Sunset 92 BPM F#m.mp3', 'Sunset'],
    ['sunset - BPM 92 - Ebmin.flac', 'Sunset'],
    ['sunset (A minor, 85bpm).ogg', 'Sunset'],
    ['sunset [C♯m] [140 bpm].mp3', 'Sunset'],
    ['Late Night in LA.mp3', 'Late Night in LA'],
    ['my_beat.final.v2.wav', 'My Beat.final.v2'],
    ['I am the beat.mp3', 'I am the beat'],
    ['iPhone_ringtone_Am.m4a', 'iPhone ringtone'],
    ['140bpm_Am.wav', '140bpm_Am'],
    ['beat', 'Beat'],
    ['Who Am I.mp3', 'Who Am I'],
    ['Nights 100 Days.mp3', 'Nights 100 Days'],
    ['[FREE] Drake Type Beat - "Nights" | 140 BPM.mp3', 'Drake Type Beat - "Nights"'],
    ['Nights (prod. Kofi) 140bpm.mp3', 'Nights'],
    ['Nights prod by Kofi.mp3', 'Nights'],
  ])('%s gives “%s”', (fileName, title) => {
    expect(suggestBeatDetails(fileName).title).toBe(title);
  });
});

describe('suggestBeatDetails producer from a filename', () => {
  it.each([
    ['Nights (prod. Kofi) 140bpm.mp3', 'Kofi'],
    ['Nights [Prod. By Kofi].mp3', 'Kofi'],
    ['Nights prod by Kofi.mp3', 'Kofi'],
    ['Nights - produced by Kofi & Ana | 92 BPM.wav', 'Kofi & Ana'],
    ['Nights.mp3', ''],
    ['Product Launch.mp3', ''],
  ])('%s gives “%s”', (fileName, producer) => {
    expect(suggestBeatDetails(fileName).producer).toBe(producer);
  });
});

describe('suggestBeatDetails from tags', () => {
  const fileName = 'dark_trap_140bpm_Am.wav';

  it.each([
    ['nothing', {}, { title: 'Dark Trap', producer: '', bpm: 140, key: 'Am' }],
    [
      'every field',
      { title: 'Midnight', artist: 'Kofi', bpm: 92, key: 'F#m' },
      { title: 'Midnight', producer: 'Kofi', bpm: 92, key: 'F#m' },
    ],
    ['only an artist', { artist: 'Kofi' }, { title: 'Dark Trap', producer: 'Kofi', bpm: 140, key: 'Am' }],
    ['blank text', { title: '  ', artist: ' ', key: '' }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'Am' }],
    ['text with spaces around it', { title: ' Midnight ' }, { title: 'Midnight', producer: '', bpm: 140, key: 'Am' }],
    ['a fractional BPM', { bpm: 91.6 }, { title: 'Dark Trap', producer: '', bpm: 92, key: 'Am' }],
    ['a BPM of 0', { bpm: 0 }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'Am' }],
    ['a spelled-out key', { key: 'E minor' }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'Em' }],
    ['a major key', { key: 'Dbmaj' }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'Db' }],
    ['a plain major key', { key: 'G' }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'G' }],
    ['a lowercase key', { key: 'f#m' }, { title: 'Dark Trap', producer: '', bpm: 140, key: 'F#m' }],
    [
      'a producer in the filename',
      { artist: 'Ana' },
      { title: 'Nights', producer: 'Ana', bpm: null, key: '' },
      'Nights (prod. Kofi).mp3',
    ],
    ['a key in another notation', { key: '8A' }, { title: 'Dark Trap', producer: '', bpm: 140, key: '8A' }],
  ])('with %s', (_, tags, suggestion, name = fileName) => {
    expect(suggestBeatDetails(name, tags)).toEqual(suggestion);
  });
});
