import { describe, expect, it } from 'vitest';
import { currentPage, listAt } from './nav';

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

describe('listAt', () => {
  it('is the page whose list is at the path', () => {
    expect(listAt('/')).toBe('songs');
    expect(listAt('/beats')).toBe('beats');
  });

  it('is neither on a page within one, or outside them', () => {
    expect(listAt('/songs/12')).toBeUndefined();
    expect(listAt('/songs/new')).toBeUndefined();
    expect(listAt('/nowhere')).toBeUndefined();
  });
});
