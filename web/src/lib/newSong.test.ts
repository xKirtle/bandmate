import { describe, expect, it } from 'vitest';
import { newSongPath, takeNewFlag } from './newSong';

describe('newSongPath', () => {
  it('opens the Song with the new flag', () => {
    expect(newSongPath(12)).toBe('/songs/12?new');
  });
});

describe('takeNewFlag', () => {
  it('is new when the query has the flag, which it takes out', () => {
    const { isNew, rest } = takeNewFlag('?new');
    expect(isNew).toBe(true);
    expect(rest.toString()).toBe('');
  });

  it('keeps the rest of the query', () => {
    const { isNew, rest } = takeNewFlag('?a=1&new&b=2');
    expect(isNew).toBe(true);
    expect(rest.toString()).toBe('a=1&b=2');
  });

  it('is not new without the flag', () => {
    expect(takeNewFlag('').isNew).toBe(false);
    expect(takeNewFlag('?newer=1').isNew).toBe(false);
  });
});
