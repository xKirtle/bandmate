import { describe, expect, it } from 'vitest';
import { currentPage } from './nav';

describe('currentPage', () => {
  it('marks Songs on the Song list and every page of a Song', () => {
    expect(currentPage('/')).toBe('songs');
    expect(currentPage('/songs/new')).toBe('songs');
    expect(currentPage('/songs/import')).toBe('songs');
    expect(currentPage('/songs/12')).toBe('songs');
  });

  it('marks Beats on the Beat Library', () => {
    expect(currentPage('/beats')).toBe('beats');
  });

  it('marks neither on a page that has no place in them', () => {
    expect(currentPage('/nowhere')).toBeUndefined();
    expect(currentPage('/beatsx')).toBeUndefined();
    expect(currentPage('/songsx')).toBeUndefined();
  });
});
