import { describe, expect, it } from 'vitest';
import { toDraft } from './beatDraft';
import { alreadyIn, anyEdited, byFileName, canAdd, tickedState } from './beatBatch';

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

describe('alreadyIn', () => {
  const file = (name: string, size: number) => ({ name, size });
  const library = [{ title: 'Echo Room', fileName: 'echo room.wav', size: 1000 }];

  it('names the Library Beat whose file name and size match', () => {
    const row = { key: 0, file: file('echo room.wav', 1000) };
    expect(alreadyIn(row, library, [row])).toEqual({ in: 'library', title: 'Echo Room' });
  });

  it('flags a row matching one picked before it, but not the first', () => {
    const first = { key: 3, file: file('paper hours.mp3', 500) };
    const second = { key: 7, file: file('paper hours.mp3', 500) };
    const rows = [second, first];
    expect(alreadyIn(first, library, rows)).toBeNull();
    expect(alreadyIn(second, library, rows)).toEqual({ in: 'batch' });
  });

  it('does not flag a file with the same name but a different size', () => {
    const row = { key: 5, file: file('echo room.wav', 1001) };
    const other = { key: 1, file: file('echo room.wav', 999) };
    expect(alreadyIn(row, library, [other, row])).toBeNull();
  });
});
