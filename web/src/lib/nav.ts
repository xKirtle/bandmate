// The app's one navigation: the nav rail on wide windows, the bottom tab bar
// on narrow ones, with the same pages in both.

/** A top-level list the navigation leads to. */
export type LibraryPage = 'songs' | 'beats';

/** A top-level page the navigation leads to: the lists and the Chord Finder. */
export type MainPage = LibraryPage | 'chords';

/** Any page the navigation leads to: the main pages, and About apart from them. */
export type NavPage = MainPage | 'about';

interface NavLink<Id extends NavPage> {
  id: Id;
  href: string;
  label: string;
  icon: string;
}

export const pages = [
  { id: 'songs', href: '/', label: 'Songs', icon: '♪' },
  { id: 'beats', href: '/beats', label: 'Beats', icon: '◉' },
  { id: 'chords', href: '/chords', label: 'Chord Finder', icon: '♯' },
] as const satisfies readonly NavLink<MainPage>[];

/** Whether a main page is a list, which the navigation returns to as it was left. */
const isList = (page: MainPage): page is LibraryPage => page === 'songs' || page === 'beats';

/**
 * About, pinned to the bottom of the nav rail, and the last tab of the tab
 * bar. Its icon, an "i" in a circle, is drawn by the navigation, since the
 * app's font draws ⓘ as a tall capsule.
 */
export const about = { id: 'about', href: '/about', label: 'About' } as const satisfies Omit<NavLink<'about'>, 'icon'>;

/**
 * The page the navigation marks as current for a path: Songs for the Song
 * list and anything under /songs, Beats for the Beat Library, the Chord
 * Finder for its page, About for the About page, and none for a path that
 * isn't the app's.
 */
export function currentPage(path: string): NavPage | undefined {
  if (path === '/' || path.startsWith('/songs/')) return 'songs';
  if (path === '/beats') return 'beats';
  if (path === '/chords') return 'chords';
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
