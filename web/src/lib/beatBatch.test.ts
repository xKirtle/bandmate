import { describe, expect, it } from 'vitest';
import { toDraft } from './beatDraft';
import { anyEdited, byFileName, canAdd, invalidFields, tickedState } from './beatBatch';

describe('invalidFields', () => {
  const valid = toDraft({
    title: 'Echo Room',
    producer: 'Pryme',
    bpm: 140,
    key: 'Am',
    sourceLink: 'https://example.com/b',
  });

  it('finds nothing wrong with a Beat that can be added', () => {
    expect(invalidFields(valid)).toEqual([]);
    expect(invalidFields({ ...valid, bpm: '', sourceLink: '', producer: '', key: '' })).toEqual([]);
  });

  it('needs a Title', () => {
    expect(invalidFields({ ...valid, title: '  ' })).toEqual(['title']);
  });

  it('needs a BPM to be a whole number the server takes', () => {
    expect(invalidFields({ ...valid, bpm: '92.5' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: 'fast' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: '0' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: '1000' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: ' 999 ' })).toEqual([]);
  });

  it('needs a Source link to be a web address', () => {
    expect(invalidFields({ ...valid, sourceLink: 'example.com' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: 'ftp://example.com/b' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: 'https://' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: ' http://example.com ' })).toEqual([]);
  });

  it('lists every invalid field', () => {
    expect(invalidFields({ ...valid, title: '', bpm: 'x', sourceLink: 'y' })).toEqual(['title', 'bpm', 'sourceLink']);
  });
});

describe('canAdd', () => {
  const draft = toDraft({ title: 'Echo Room' });
  const ready = { status: 'ready' as const, ticked: true, draft };

  it('adds once every ticked row is read and valid', () => {
    expect(canAdd([ready, { ...ready, draft: toDraft({ title: 'Paper Hours', bpm: 92 }) }])).toBe(true);
  });

  it('needs a ticked row', () => {
    expect(canAdd([])).toBe(false);
    expect(canAdd([{ ...ready, ticked: false }])).toBe(false);
  });

  it('waits for ticked rows still being read', () => {
    expect(canAdd([ready, { ...ready, status: 'reading' }])).toBe(false);
    expect(canAdd([ready, { ...ready, status: 'reading', ticked: false }])).toBe(true);
  });

  it('is held back by a ticked row with an invalid field, but not an unticked one', () => {
    const invalid = { ...ready, draft: { ...draft, bpm: 'fast' } };
    expect(canAdd([ready, invalid])).toBe(false);
    expect(canAdd([ready, { ...invalid, ticked: false }])).toBe(true);
  });

  it('leaves out a file that cannot be added', () => {
    expect(canAdd([ready, { ...ready, status: 'unreadable', ticked: false }])).toBe(true);
  });
});

describe('tickedState', () => {
  const row = (ticked: boolean, status: 'reading' | 'ready' | 'unreadable' = 'ready') => ({ ticked, status });

  it('is all when every row that can be added is ticked', () => {
    expect(tickedState([row(true), row(true, 'reading'), row(false, 'unreadable')])).toBe('all');
  });

  it('is none when no row is ticked', () => {
    expect(tickedState([row(false), row(false, 'reading'), row(false, 'unreadable')])).toBe('none');
    expect(tickedState([row(false, 'unreadable')])).toBe('none');
  });

  it('is some when only some are', () => {
    expect(tickedState([row(true), row(false, 'reading')])).toBe('some');
  });
});

describe('anyEdited', () => {
  const suggested = toDraft({ title: 'Echo Room', bpm: 140 });

  it('tells whether any row has details typed over the suggested ones', () => {
    expect(anyEdited([{ suggested, draft: { ...suggested } }])).toBe(false);
    expect(
      anyEdited([
        { suggested, draft: { ...suggested } },
        { suggested, draft: { ...suggested, key: 'Am' } },
      ]),
    ).toBe(true);
  });
});

describe('byFileName', () => {
  const named = (...names: string[]) => names.map((name) => ({ file: { name } }));

  it('orders rows by file name, numbers by their value and ignoring case', () => {
    const sorted = named('beat 10.wav', 'Beat 2.wav', 'alpha.mp3', 'beat 1.wav').sort(byFileName);
    expect(sorted.map((r) => r.file.name)).toEqual(['alpha.mp3', 'beat 1.wav', 'Beat 2.wav', 'beat 10.wav']);
  });
});
