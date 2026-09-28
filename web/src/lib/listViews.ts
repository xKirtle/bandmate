// What a list page shows: its search, filters and sort, how it sorts, and how
// that is kept in the URL so going back to the list restores it.

import { statuses, type SongSummary, type Status } from './api';

export type SortDirection = 'asc' | 'desc';

export interface Sort<Column extends string> {
  column: Column;
  direction: SortDirection;
}

/** A column of the Song list. */
export type SongColumn = 'title' | 'status' | 'key' | 'bpm' | 'master' | 'edited';

export const songColumns: readonly SongColumn[] = ['title', 'status', 'key', 'bpm', 'master', 'edited'];

/** The Song list's search, filters and sort. */
export interface SongListView {
  /** Matched against titles; blank matches every Song. */
  q: string;
  /** Only Songs with this Status, or any Status. */
  status?: Status;
  /** Only Songs with a Master. */
  hasMaster: boolean;
  sort: Sort<SongColumn>;
}

export const defaultSongListView: SongListView = {
  q: '',
  hasMaster: false,
  sort: { column: 'edited', direction: 'desc' },
};

/** A value a list sorts by; undefined means it's missing. */
type SortKey = string | number | undefined;

const compareText = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare;

/**
 * Items sorted by a key, text ignoring case and accents, with missing keys
 * last in either direction and ties kept in the order given.
 */
function sortBy<T>(items: readonly T[], key: (item: T) => SortKey, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return items
    .map((item) => ({ item, key: key(item) }))
    .sort((a, b) => {
      if (a.key === undefined || b.key === undefined) return Number(a.key === undefined) - Number(b.key === undefined);
      const order = typeof a.key === 'string' ? compareText(a.key, String(b.key)) : a.key - Number(b.key);
      return sign * order;
    })
    .map(({ item }) => item);
}

/** What each column of the Song list sorts by, ascending. */
const songSortKeys: Record<SongColumn, (song: SongSummary) => SortKey> = {
  title: (s) => s.title,
  status: (s) => statuses.indexOf(s.status),
  key: (s) => s.key || undefined,
  bpm: (s) => s.bpm ?? undefined,
  // Songs with a Master come first, as the column is about having one.
  master: (s) => (s.hasMaster ? 0 : 1),
  edited: (s) => Date.parse(s.updatedAt),
};

/** Songs sorted by a column. Doesn't change songs. */
export function sortSongs(songs: readonly SongSummary[], sort: Sort<SongColumn>): SongSummary[] {
  return sortBy(songs, songSortKeys[sort.column], sort.direction);
}

/** Columns that sort newest or biggest first when first picked. */
const descendingFirst: readonly string[] = ['edited'];

/**
 * The sort after picking a column: the same column flips direction, another
 * starts in its natural direction.
 */
export function toggleSort<C extends string>(sort: Sort<C>, column: C): Sort<C> {
  if (sort.column === column) return { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
  return { column, direction: descendingFirst.includes(column) ? 'desc' : 'asc' };
}

/** A sort as a URL parameter: the column, with a leading "-" when descending. */
function sortToParam<C extends string>(sort: Sort<C>): string {
  return (sort.direction === 'desc' ? '-' : '') + sort.column;
}

function sortFromParam<C extends string>(param: string | null, columns: readonly C[]): Sort<C> | undefined {
  if (param === null) return undefined;
  const direction = param.startsWith('-') ? 'desc' : 'asc';
  const column = direction === 'desc' ? param.slice(1) : param;
  return (columns as readonly string[]).includes(column) ? { column: column as C, direction } : undefined;
}

/** The URL parameters for a Song list view, leaving out whatever is the default. */
export function songListViewToParams(view: SongListView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.q.trim()) params.set('q', view.q);
  if (view.status) params.set('status', view.status);
  if (view.hasMaster) params.set('hasMaster', 'true');
  const sort = sortToParam(view.sort);
  if (sort !== sortToParam(defaultSongListView.sort)) params.set('sort', sort);
  return params;
}

/**
 * The Song list view the URL parameters describe. Anything unknown or
 * malformed falls back to the default rather than failing.
 */
export function songListViewFromParams(params: URLSearchParams): SongListView {
  const status = params.get('status');
  return {
    q: params.get('q') ?? defaultSongListView.q,
    status: statuses.find((s) => s === status),
    hasMaster: params.get('hasMaster') === 'true',
    sort: sortFromParam(params.get('sort'), songColumns) ?? defaultSongListView.sort,
  };
}
