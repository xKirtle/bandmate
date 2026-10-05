import { describe, expect, it } from 'vitest';
import { currentPage, listAt, movedTo, pages, pinned, settingsTabAt, settingsTabs } from './nav';

describe('currentPage', () => {
  it('marks Songs on the Song list, inside a Folder, and on every page of a Song', () => {
    expect(currentPage('/')).toBe('songs');
    expect(currentPage('/folders/3')).toBe('songs');
    expect(currentPage('/songs/import')).toBe('songs');
    expect(currentPage('/songs/12')).toBe('songs');
  });

  it('marks Beats on the Beat Library', () => {
    expect(currentPage('/beats')).toBe('beats');
  });

  it('marks the Chord Finder on its page', () => {
    expect(currentPage('/chords')).toBe('chords');
  });

  it('marks Settings on every one of its tabs', () => {
    expect(currentPage('/settings')).toBe('settings');
    expect(currentPage('/settings/backups')).toBe('settings');
    expect(currentPage('/settings/about')).toBe('settings');
  });

  it('marks Settings on the old Backups and About addresses, which open its tabs', () => {
    expect(currentPage('/backups')).toBe('settings');
    expect(currentPage('/about')).toBe('settings');
  });

  it('marks none on a page that has no place in them', () => {
    expect(currentPage('/nowhere')).toBeUndefined();
    expect(currentPage('/aboutx')).toBeUndefined();
    expect(currentPage('/beatsx')).toBeUndefined();
    expect(currentPage('/songsx')).toBeUndefined();
    expect(currentPage('/chordsx')).toBeUndefined();
    expect(currentPage('/backupsx')).toBeUndefined();
    expect(currentPage('/settingsx')).toBeUndefined();
    expect(currentPage('/settings/nowhere')).toBeUndefined();
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
  });

  it('is none on the Chord Finder or Settings, which keep no search', () => {
    expect(listAt('/chords')).toBeUndefined();
    expect(listAt('/settings')).toBeUndefined();
    expect(listAt('/settings/backups')).toBeUndefined();
    expect(listAt('/settings/about')).toBeUndefined();
  });
});

describe('pages', () => {
  it('leads to the Songs, the Beats and the Chord Finder, in that order', () => {
    expect(pages.map((p) => [p.label, p.href])).toEqual([
      ['Songs', '/'],
      ['Beats', '/beats'],
      ['Chords', '/chords'],
    ]);
  });
});

describe('pinned', () => {
  it('leads to Settings alone, apart from the main pages', () => {
    expect(pinned.map((p) => [p.label, p.href])).toEqual([['Settings', '/settings']]);
  });
});

describe('settingsTabs', () => {
  it('are Appearance, Backups and About, in that order, each at its own address', () => {
    expect(settingsTabs.map((t) => [t.label, t.href])).toEqual([
      ['Appearance', '/settings'],
      ['Backups', '/settings/backups'],
      ['About', '/settings/about'],
    ]);
  });
});

describe('settingsTabAt', () => {
  it('is the Settings tab at a path', () => {
    expect(settingsTabAt('/settings')).toBe('appearance');
    expect(settingsTabAt('/settings/backups')).toBe('backups');
    expect(settingsTabAt('/settings/about')).toBe('about');
  });

  it('is none outside Settings, or at an address in it that has no tab', () => {
    expect(settingsTabAt('/')).toBeUndefined();
    expect(settingsTabAt('/backups')).toBeUndefined();
    expect(settingsTabAt('/settings/nowhere')).toBeUndefined();
  });
});

describe('movedTo', () => {
  it('sends the old Backups and About addresses to their Settings tabs', () => {
    expect(movedTo('/backups')).toBe('/settings/backups');
    expect(movedTo('/about')).toBe('/settings/about');
  });

  it('is none for an address that never moved', () => {
    expect(movedTo('/')).toBeUndefined();
    expect(movedTo('/settings')).toBeUndefined();
    expect(movedTo('/settings/about')).toBeUndefined();
    expect(movedTo('/backupsx')).toBeUndefined();
  });
});
