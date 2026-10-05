// The app's one navigation: the nav rail on wide windows, the bottom tab bar
// on narrow ones, with the same pages in both. Settings has tabs of its own.

import Disc3 from '@lucide/svelte/icons/disc-3';
import Guitar from '@lucide/svelte/icons/guitar';
import Music from '@lucide/svelte/icons/music';
import Settings from '@lucide/svelte/icons/settings';
import type { Icon } from './icons';

/** The top-level lists the navigation leads to. */
const lists = ['songs', 'beats'] as const;
export type LibraryPage = (typeof lists)[number];

/** A top-level page the navigation leads to: the lists and the Chord Finder. */
export type MainPage = LibraryPage | 'chords';

/** Any page the navigation leads to: the main pages, and Settings apart from them. */
export type NavPage = MainPage | 'settings';

interface NavLink<Id extends NavPage> {
  id: Id;
  href: string;
  label: string;
  icon: Icon;
}

export const pages = [
  { id: 'songs', href: '/', label: 'Songs', icon: Music },
  { id: 'beats', href: '/beats', label: 'Beats', icon: Disc3 },
  { id: 'chords', href: '/chords', label: 'Chords', icon: Guitar },
] as const satisfies readonly NavLink<MainPage>[];

/** Whether a main page is a list, which the navigation returns to as it was left. */
const isList = (page: MainPage): page is LibraryPage => (lists as readonly MainPage[]).includes(page);

/** Settings, pinned to the bottom of the nav rail, and the last tab of the tab bar. */
export const pinned = [
  { id: 'settings', href: '/settings', label: 'Settings', icon: Settings },
] as const satisfies readonly NavLink<'settings'>[];

/** Settings' tabs, each at its own address: Appearance at Settings' own. */
export const settingsTabs = [
  { id: 'appearance', href: '/settings', label: 'Appearance' },
  { id: 'backups', href: '/settings/backups', label: 'Backups' },
  { id: 'about', href: '/settings/about', label: 'About' },
] as const;
export type SettingsTab = (typeof settingsTabs)[number]['id'];

/** The Settings tab at a path, or none outside Settings. */
export function settingsTabAt(path: string): SettingsTab | undefined {
  return settingsTabs.find((tab) => tab.href === path)?.id;
}

/** Where Backups and About were pages of their own, before they were Settings' tabs. */
const moved = new Map([
  ['/backups', '/settings/backups'],
  ['/about', '/settings/about'],
]);

/** Where an old address now lives, e.g. /about's Settings tab, or none if it never moved. */
export function movedTo(path: string): string | undefined {
  return moved.get(path);
}

/**
 * The page the navigation marks as current for a path: Songs for the Song
 * list, a Folder and anything under /songs, Beats for the Beat Library, the Chord
 * Finder for its page, Settings for every one of its tabs, and none for a
 * path that isn't the app's.
 */
export function currentPage(path: string): NavPage | undefined {
  if (path === '/' || path.startsWith('/songs/') || path.startsWith('/folders/')) return 'songs';
  if (settingsTabAt(movedTo(path) ?? path)) return 'settings';
  return pages.find((page) => page.href === path)?.id;
}

/**
 * The page whose list is at a path, e.g. Songs for the Song list but not for
 * a Song. The navigation returns to a list as it was left there.
 */
export function listAt(path: string): LibraryPage | undefined {
  const page = pages.find((page) => page.href === path)?.id;
  return page && isList(page) ? page : undefined;
}
