import { describe, expect, it } from 'vitest';
import { currentPage, listAt, pages, pinned } from './nav';

describe('currentPage', () => {
  it('marks Songs on the Song list and every page of a Song', () => {
    expect(currentPage('/')).toBe('songs');
    expect(currentPage('/songs/import')).toBe('songs');
    expect(currentPage('/songs/12')).toBe('songs');
  });

  it('marks Beats on the Beat Library', () => {
    expect(currentPage('/beats')).toBe('beats');
  });

  it('marks the Chord Finder on its page', () => {
    expect(currentPage('/chords')).toBe('chords');
  });

  it('marks Backups on the Backups page', () => {
    expect(currentPage('/backups')).toBe('backups');
  });

  it('marks About on the About page', () => {
    expect(currentPage('/about')).toBe('about');
  });

  it('marks Settings on the Settings page', () => {
    expect(currentPage('/settings')).toBe('settings');
  });

  it('marks none on a page that has no place in them', () => {
    expect(currentPage('/nowhere')).toBeUndefined();
    expect(currentPage('/aboutx')).toBeUndefined();
    expect(currentPage('/beatsx')).toBeUndefined();
    expect(currentPage('/songsx')).toBeUndefined();
    expect(currentPage('/chordsx')).toBeUndefined();
    expect(currentPage('/backupsx')).toBeUndefined();
    expect(currentPage('/settingsx')).toBeUndefined();
  });
});

describe('listAt', () => {
  it('is the page whose list is at the path', () => {
    expect(listAt('/')).toBe('songs');
    expect(listAt('/beats')).toBe('beats');
  });

  it('is none on a page within a list, such as a Song, or outside them', () => {
    expect(listAt('/songs/12')).toBeUndefined();
    expect(listAt('/songs/import')).toBeUndefined();
    expect(listAt('/nowhere')).toBeUndefined();
    expect(listAt('/about')).toBeUndefined();
  });

  it('is none on the Chord Finder or the Backups, which keep no search', () => {
    expect(listAt('/chords')).toBeUndefined();
    expect(listAt('/backups')).toBeUndefined();
  });
});

describe('pages', () => {
  it('leads to the Songs, the Beats, the Chord Finder and the Backups, in that order', () => {
    expect(pages.map((p) => [p.label, p.href])).toEqual([
      ['Songs', '/'],
      ['Beats', '/beats'],
      ['Chord Finder', '/chords'],
      ['Backups', '/backups'],
    ]);
  });
});

describe('pinned', () => {
  it('leads to Settings, then About, apart from the main pages', () => {
    expect(pinned.map((p) => [p.label, p.href])).toEqual([
      ['Settings', '/settings'],
      ['About', '/about'],
    ]);
  });
});
