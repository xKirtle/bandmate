import { describe, expect, it } from 'vitest';
import { addTags, finishedTags } from './tagsTyped';

describe('finishedTags', () => {
  it('finishes nothing until a comma is typed', () => {
    expect(finishedTags('Album 2023')).toEqual({ names: [], rest: 'Album 2023' });
  });

  it('keeps what is typed from its first letter, as after the space following a comma', () => {
    expect(finishedTags(' ')).toEqual({ names: [], rest: '' });
    expect(finishedTags(' li')).toEqual({ names: [], rest: 'li' });
  });

  it('finishes what comes before a comma, keeping what comes after typed, from its first letter', () => {
    expect(finishedTags('demo,')).toEqual({ names: ['demo'], rest: '' });
    expect(finishedTags('demo, li')).toEqual({ names: ['demo'], rest: 'li' });
  });

  it('finishes every piece when told to, as when names are pasted', () => {
    expect(finishedTags('demo, live, Album 2023', true)).toEqual({
      names: ['demo', 'live', 'Album 2023'],
      rest: '',
    });
  });

  it('trims each name and ignores blank pieces', () => {
    expect(finishedTags(' demo ,, ,live  ,', true)).toEqual({ names: ['demo', 'live'], rest: '' });
  });
});

describe('addTags', () => {
  it('adds the names to the Tags carried', () => {
    expect(addTags(['Covers'], [], ['demo', 'Album 2023'])).toEqual(['Covers', 'demo', 'Album 2023']);
  });

  it('adds nothing for a name carried already, ignoring case, or named twice', () => {
    expect(addTags(['Live'], [], ['live', 'demo', 'DEMO'])).toEqual(['Live', 'demo']);
  });

  it("gives a name a Tag has that Tag's spelling", () => {
    expect(addTags([], ['Album 2023'], ['album 2023'])).toEqual(['Album 2023']);
  });
});
