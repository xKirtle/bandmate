// The app's one navigation: the nav rail on wide windows, the bottom tab bar
// on narrow ones, with the same pages in both.

/** A top-level page the navigation leads to. */
export type LibraryPage = 'songs' | 'beats';

export const pages = [
  { id: 'songs', href: '/', label: 'Songs', icon: '♪' },
  { id: 'beats', href: '/beats', label: 'Beats', icon: '◉' },
] as const satisfies readonly { id: LibraryPage; href: string; label: string; icon: string }[];

/**
 * The page the navigation marks as current for a path: Songs for the Song
 * list and anything under /songs, Beats for the Beat Library, and neither
 * for a path that isn't the app's.
 */
export function currentPage(path: string): LibraryPage | undefined {
  if (path === '/' || path.startsWith('/songs/')) return 'songs';
  if (path === '/beats') return 'beats';
  return undefined;
}
