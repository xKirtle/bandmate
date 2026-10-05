// The app's one navigation: the nav rail on wide windows, the bottom tab bar
// on narrow ones, with the same pages in both.

import Archive from '@lucide/svelte/icons/archive';
import Disc3 from '@lucide/svelte/icons/disc-3';
import Guitar from '@lucide/svelte/icons/guitar';
import Info from '@lucide/svelte/icons/info';
import Music from '@lucide/svelte/icons/music';
import type { Icon } from './icons';

/** The top-level lists the navigation leads to. */
const lists = ['songs', 'beats'] as const;
export type LibraryPage = (typeof lists)[number];

/** A top-level page the navigation leads to: the lists, the Chord Finder and the Backups. */
export type MainPage = LibraryPage | 'chords' | 'backups';

/** Any page the navigation leads to: the main pages, and About apart from them. */
export type NavPage = MainPage | 'about';

interface NavLink<Id extends NavPage> {
  id: Id;
  href: string;
  label: string;
  icon: Icon;
}

export const pages = [
  { id: 'songs', href: '/', label: 'Songs', icon: Music },
  { id: 'beats', href: '/beats', label: 'Beats', icon: Disc3 },
  { id: 'chords', href: '/chords', label: 'Chord Finder', icon: Guitar },
  { id: 'backups', href: '/backups', label: 'Backups', icon: Archive },
] as const satisfies readonly NavLink<MainPage>[];

/** Whether a main page is a list, which the navigation returns to as it was left. */
const isList = (page: MainPage): page is LibraryPage => (lists as readonly MainPage[]).includes(page);

/** About, pinned to the bottom of the nav rail, and the last tab of the tab bar. */
export const about = { id: 'about', href: '/about', label: 'About', icon: Info } as const satisfies NavLink<'about'>;

/**
 * The page the navigation marks as current for a path: Songs for the Song
 * list and anything under /songs, Beats for the Beat Library, the Chord
 * Finder and the Backups for their pages, About for the About page, and none
 * for a path that isn't the app's.
 */
export function currentPage(path: string): NavPage | undefined {
  if (path === '/' || path.startsWith('/songs/')) return 'songs';
  if (path === '/beats') return 'beats';
  if (path === '/chords') return 'chords';
  if (path === '/backups') return 'backups';
  if (path === about.href) return 'about';
  return undefined;
}

/**
 * The page whose list is at a path, e.g. Songs for the Song list but not for
 * a Song. The navigation returns to a list as it was left there.
 */
export function listAt(path: string): LibraryPage | undefined {
  const page = pages.find((page) => page.href === path)?.id;
  return page && isList(page) ? page : undefined;
}
