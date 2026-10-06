// What a list page shows: its search, filters and sort, how it sorts, and how
// that is kept in the URL so going back to the list restores it.

import { statuses, type Beat, type Folder, type Song, type SongFilter, type SongSummary, type Status } from './api';

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
  /** Only Songs with any of these Statuses, in lifecycle order; none keeps every Status. */
  statuses: Status[];
  /** Only Songs with a Master. */
  hasMaster: boolean;
  sort: Sort<SongColumn>;
}

export const defaultSongListView: SongListView = {
  q: '',
  statuses: [],
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

/** Folders by name, whatever the Songs are sorted by. Doesn't change folders. */
export function sortFolders(folders: readonly Folder[]): Folder[] {
  return sortBy(folders, (f) => f.name, 'asc');
}

/** How many Songs there are, e.g. in a Folder: "1 Song", "3 Songs". */
export const songCount = (n: number) => (n === 1 ? '1 Song' : `${n} Songs`);

/** Columns that sort newest or biggest first when first picked. */
const descendingFirst: readonly string[] = ['edited', 'added'];

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
  for (const status of view.statuses) params.append('status', status);
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
  // Several, or, from before several could be picked, one.
  const picked = params.getAll('status');
  return {
    q: params.get('q') ?? defaultSongListView.q,
    statuses: statuses.filter((s) => picked.includes(s)),
    hasMaster: params.get('hasMaster') === 'true',
    sort: sortFromParam(params.get('sort'), songColumns) ?? defaultSongListView.sort,
  };
}

/**
 * What a filter button says: the filter's name, and, once some are picked,
 * what's picked, e.g. "Status: Idea, Drafting".
 */
function filterLabel(name: string, picked: readonly string[]): string {
  return picked.length > 0 ? `${name}: ${picked.join(', ')}` : name;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the Status filter's button says, naming the Statuses picked in lifecycle order. */
export function statusFilterLabel(picked: readonly Status[]): string {
  return filterLabel('Status', statuses.filter((s) => picked.includes(s)).map(capitalised));
}

/** Whether a Song list view searches or filters, rather than only sorting. */
export function isSongListFiltered(view: SongListView): boolean {
  return !!(view.q.trim() || view.statuses.length > 0 || view.hasMaster);
}

/**
 * What to ask the server for to show a Song list view: inside a Folder, its
 * Songs; at the top level, the Songs in no Folder, but for while a search or
 * filter is on, which looks at every Song, whatever Folder it's in.
 */
export function songListFilter(view: SongListView, folderId?: number): SongFilter {
  const filter: SongFilter = {};
  if (view.q.trim()) filter.q = view.q;
  if (view.statuses.length > 0) filter.statuses = [...view.statuses];
  if (view.hasMaster) filter.hasMaster = true;
  if (folderId !== undefined) filter.folder = folderId;
  else if (!isSongListFiltered(view)) filter.folder = 'none';
  return filter;
}

/** The Songs a filter keeps, and whether there are any Songs at all. */
export interface LoadedSongList {
  songs: SongSummary[];
  anySongs: boolean;
}

/**
 * Lists the Songs a filter keeps, and whether there are any Songs at all:
 * inside a Folder, any in it, and at the top level, any anywhere, whether
 * the list is the Songs in no Folder or every Song. The server filters the
 * list, so when nothing matches it asks again for every Song there, to tell
 * no matches from no Songs.
 */
export async function loadSongList(
  filter: SongFilter,
  list: (filter: SongFilter) => Promise<SongSummary[]>,
): Promise<LoadedSongList> {
  const songs = await list(filter);
  const { folder, ...narrowing } = filter;
  const filtered = Object.values(narrowing).some((value) => value !== undefined && value !== '');
  const topLevel = folder === undefined || folder === 'none';
  if (songs.length > 0 || (!filtered && folder !== 'none')) return { songs, anySongs: songs.length > 0 };
  return { songs, anySongs: (await list(topLevel ? {} : { folder })).length > 0 };
}

/** A column of the Beat Library. */
export type BeatColumn = 'title' | 'producer' | 'bpm' | 'key' | 'duration' | 'usedBy' | 'added';

export const beatColumns: readonly BeatColumn[] = ['title', 'producer', 'bpm', 'key', 'duration', 'usedBy', 'added'];

/** Beats used in a Song, or not used in any. */
export type BeatUse = 'used' | 'unused';

const beatUses: readonly BeatUse[] = ['used', 'unused'];

/**
 * The Beat Library's search, filters and sort. The filters combine, and one
 * on BPM or key leaves out Beats with none set.
 */
export interface BeatListView {
  /** Matched against titles and producers; blank matches every Beat. */
  q: string;
  /** Only Beats by any of these producers; none keeps every Beat. */
  producers: string[];
  /** The lowest BPM kept, inclusive; unset leaves the range open. */
  bpmMin?: number;
  /** The highest BPM kept, inclusive; unset leaves the range open. */
  bpmMax?: number;
  /**
   * Only Beats in any of these keys; none keeps every Beat. Matched as
   * written, so C# and Db are different keys.
   */
  keys: string[];
  use?: BeatUse;
  sort: Sort<BeatColumn>;
}

export const defaultBeatListView: BeatListView = {
  q: '',
  producers: [],
  keys: [],
  sort: { column: 'added', direction: 'desc' },
};

/** Text as a filter compares it: ignoring case and surrounding space. */
const folded = (text: string) => text.trim().toLowerCase();

/** Whether a producer or key is among those picked, ignoring case and surrounding space. */
export const isPicked = (picked: readonly string[], choice: string) => picked.some((p) => folded(p) === folded(choice));

/** The picks with a producer or key ticked on, once, or off. */
export function togglePick(picked: readonly string[], choice: string, on: boolean): string[] {
  const rest = picked.filter((p) => folded(p) !== folded(choice));
  return on ? [...rest, choice] : rest;
}

/**
 * The producers or keys a filter offers: those picked that no Beat has now,
 * so they can be unticked, then the Library's.
 */
export function pickChoices(library: readonly string[], picked: readonly string[]): string[] {
  const missing = picked.filter((p, i) => !isPicked(library, p) && !isPicked(picked.slice(0, i), p));
  return [...missing, ...library];
}

/** Whether the view narrows the Beats down, rather than only sorting them. */
export function isBeatListFiltered(view: BeatListView): boolean {
  return (
    view.q.trim() !== '' ||
    view.producers.length > 0 ||
    view.bpmMin !== undefined ||
    view.bpmMax !== undefined ||
    view.keys.length > 0 ||
    view.use !== undefined
  );
}

/** What the Producer filter's button says, naming the producers picked, sorted. */
export function producerFilterLabel(picked: readonly string[]): string {
  return filterLabel('Producer', [...picked].sort(compareText));
}

/** What the Key filter's button says, naming the keys picked, sorted. */
export function keyFilterLabel(picked: readonly string[]): string {
  return filterLabel('Key', [...picked].sort(compareText));
}

/** What the BPM filter's button says: the range, e.g. "BPM: 80–95", or the end of it that's set. */
export function bpmFilterLabel({ bpmMin, bpmMax }: Pick<BeatListView, 'bpmMin' | 'bpmMax'>): string {
  if (bpmMin !== undefined && bpmMax !== undefined)
    return filterLabel('BPM', [bpmMin === bpmMax ? `${bpmMin}` : `${bpmMin}–${bpmMax}`]);
  if (bpmMin !== undefined) return filterLabel('BPM', [`from ${bpmMin}`]);
  if (bpmMax !== undefined) return filterLabel('BPM', [`up to ${bpmMax}`]);
  return filterLabel('BPM', []);
}

/** What the Used filter's button says: whether the Beats shown are used in a Song. */
export function useFilterLabel(use: BeatUse | undefined): string {
  return filterLabel('Used', use ? [use === 'used' ? 'Yes' : 'No'] : []);
}

/**
 * A Song's BPM and key, whichever are set, shown beside the Beat picker's
 * filters as a hint; undefined when neither is.
 */
export function songBeatHint(song: Pick<Song, 'bpm' | 'key'>): string | undefined {
  const hint = [song.bpm !== null ? `${song.bpm} BPM` : '', song.key.trim()].filter(Boolean).join(' · ');
  return hint || undefined;
}

/** The Beats the view's search and filters keep, in the order given. */
export function filterBeats(beats: readonly Beat[], view: BeatListView): Beat[] {
  const q = folded(view.q);
  const producers = view.producers.map(folded);
  const keys = view.keys.map(folded);
  return beats.filter((b) => {
    if (q && !b.title.toLowerCase().includes(q) && !b.producer.toLowerCase().includes(q)) return false;
    if (producers.length > 0 && !producers.includes(folded(b.producer))) return false;
    if (view.bpmMin !== undefined && (b.bpm === null || b.bpm < view.bpmMin)) return false;
    if (view.bpmMax !== undefined && (b.bpm === null || b.bpm > view.bpmMax)) return false;
    if (keys.length > 0 && !keys.includes(folded(b.key))) return false;
    if (view.use && b.songs.length > 0 !== (view.use === 'used')) return false;
    return true;
  });
}

/** What each column of the Beat Library sorts by, ascending. */
const beatSortKeys: Record<BeatColumn, (beat: Beat) => SortKey> = {
  title: (b) => b.title,
  producer: (b) => b.producer.trim() || undefined,
  bpm: (b) => b.bpm ?? undefined,
  key: (b) => b.key.trim() || undefined,
  duration: (b) => b.duration,
  // As the column shows it: the titles of the Songs using the Beat.
  usedBy: (b) => b.songs.map((s) => s.title).join(', ') || undefined,
  added: (b) => Date.parse(b.createdAt),
};

/** Beats sorted by a column. Doesn't change beats. */
export function sortBeats(beats: readonly Beat[], sort: Sort<BeatColumn>): Beat[] {
  return sortBy(beats, beatSortKeys[sort.column], sort.direction);
}

/** The values of a Beat field in the Library, once each ignoring case, sorted. */
function distinct(beats: readonly Beat[], field: (beat: Beat) => string): string[] {
  const seen = new Map<string, string>();
  for (const b of beats) {
    const value = field(b).trim();
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()].sort(compareText);
}

/** The producers in the Library, to pick one to filter by. */
export const beatProducers = (beats: readonly Beat[]) => distinct(beats, (b) => b.producer);

/** The keys in the Library, to pick one to filter by. */
export const beatKeys = (beats: readonly Beat[]) => distinct(beats, (b) => b.key);

/**
 * Several values of a parameter, or, from before several could be picked,
 * one; each once ignoring case, and blank ones left out.
 */
function textsFromParams(params: URLSearchParams, name: string): string[] {
  return params.getAll(name).reduce((picked: string[], value) => {
    if (value.trim() && !isPicked(picked, value)) picked.push(value);
    return picked;
  }, []);
}

function bpmFromParam(param: string | null): number | undefined {
  if (param === null || param.trim() === '') return undefined;
  const bpm = Number(param);
  return Number.isFinite(bpm) && bpm >= 0 ? bpm : undefined;
}

/** The URL parameters for a Beat Library view, leaving out whatever is the default. */
export function beatListViewToParams(view: BeatListView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.q.trim()) params.set('q', view.q);
  for (const producer of view.producers) if (producer.trim()) params.append('producer', producer);
  if (view.bpmMin !== undefined) params.set('bpmMin', String(view.bpmMin));
  if (view.bpmMax !== undefined) params.set('bpmMax', String(view.bpmMax));
  for (const key of view.keys) if (key.trim()) params.append('key', key);
  if (view.use) params.set('use', view.use);
  const sort = sortToParam(view.sort);
  if (sort !== sortToParam(defaultBeatListView.sort)) params.set('sort', sort);
  return params;
}

/**
 * The Beat Library view the URL parameters describe. Anything unknown or
 * malformed falls back to the default rather than failing.
 */
export function beatListViewFromParams(params: URLSearchParams): BeatListView {
  const use = params.get('use');
  return {
    q: params.get('q') ?? defaultBeatListView.q,
    producers: textsFromParams(params, 'producer'),
    bpmMin: bpmFromParam(params.get('bpmMin')),
    bpmMax: bpmFromParam(params.get('bpmMax')),
    keys: textsFromParams(params, 'key'),
    use: beatUses.find((u) => u === use),
    sort: sortFromParam(params.get('sort'), beatColumns) ?? defaultBeatListView.sort,
  };
}
