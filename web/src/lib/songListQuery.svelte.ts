// Loading the Songs page: the Songs its search and filters keep, with the
// Folders and Tags beside them.
import { ApiError, type Folder, type SongFilter, type SongSummary, type Tag } from './api';
import { defaultSongListView, isSongListFiltered, type SongListView } from './listViews';

/** The calls the Songs page loads through: the api, or a fake of it. */
export interface SongListSource {
  listSongs: (filter: SongFilter) => Promise<SongSummary[]>;
  listFolders: () => Promise<Folder[]>;
  listTags: () => Promise<Tag[]>;
}

/** What to ask the server for to show a view, and what the answer will be. */
interface Request {
  filter: SongFilter;
  /** Whether the answer is every Song, whatever Folder it's in. */
  acrossFolders: boolean;
  /**
   * What to ask for when nothing matches, to tell no matches from no Songs:
   * every Song in the Folder, or anywhere at the top level. Unset when the
   * answer already tells, as it holds every Song in the Folder.
   */
  everySong?: SongFilter;
}

/**
 * The Folder rule: inside a Folder, its Songs; at the top level, the Songs in
 * no Folder, but for while a search or filter is on, which looks at every
 * Song, whatever Folder it's in.
 */
function request(view: SongListView, folderId: number | undefined): Request {
  const filter: SongFilter = {};
  if (view.q.trim()) filter.q = view.q;
  if (view.statuses.length > 0) filter.statuses = [...view.statuses];
  if (view.tags.length > 0) filter.tags = [...view.tags];
  if (view.hasMaster) filter.hasMaster = true;
  const filtered = isSongListFiltered(view);
  if (folderId !== undefined) {
    filter.folder = folderId;
    return { filter, acrossFolders: false, everySong: filtered ? { folder: folderId } : undefined };
  }
  if (!filtered) filter.folder = 'none';
  return { filter, acrossFolders: filtered, everySong: {} };
}

/**
 * The Songs a request keeps, and whether there are any Songs at all. A
 * Folder that doesn't exist holds none.
 */
async function load(source: SongListSource, asked: Request) {
  try {
    const songs = await source.listSongs(asked.filter);
    if (songs.length > 0 || !asked.everySong) return { songs, anySongs: songs.length > 0 };
    return { songs, anySongs: (await source.listSongs(asked.everySong)).length > 0 };
  } catch (e) {
    if (typeof asked.filter.folder === 'number' && e instanceof ApiError && e.status === 404)
      return { songs: [], anySongs: false };
    throw e;
  }
}

/** How long to wait for a pause in typing before loading again, in ms. */
const pause = 200;

/**
 * Loads the Songs page, for the Folder open or the top level, and holds its
 * view: the search, filters and sort, which the page binds to and keeps in
 * the URL. It loads again whenever the view's search or filters change, or
 * when asked. Made while a component sets up, it stops with it.
 */
export class SongListQuery {
  /** The search, filters and sort. */
  view: SongListView = $state()!;
  /** The Songs the search and filters keep, as the server orders them; null until first loaded. */
  songs = $state<SongSummary[] | null>(null);
  /** Every Folder; null until first loaded. */
  folders = $state<Folder[] | null>(null);
  /** Every Tag, wherever the Songs carrying it are, to filter by. */
  tags = $state<Tag[]>([]);
  /**
   * Whether there are any Songs at all, whatever the search and filters: in
   * the Folder open, or anywhere at the top level.
   */
  anySongs = $state(true);
  /**
   * Whether the Songs are every Song, whatever Folder it's in, as at the top
   * level while a search or filter is on. Taken from the list as last loaded,
   * not the view as typed, so the two never show out of step.
   */
  acrossFolders = $state(false);
  /** Why the last load failed, until one doesn't. */
  error = $state<string | null>(null);

  /** Bumped to load again. */
  #changes = $state(0);

  constructor(source: SongListSource, view: SongListView, folderId?: number) {
    this.view = view;
    // Not reactive: the first load shouldn't wait.
    let loaded = false;
    $effect(() => {
      const asked = request(this.view, folderId);
      void this.#changes;
      // Only the latest load's answer is shown.
      let current = true;
      const timer = setTimeout(
        () => {
          Promise.all([load(source, asked), source.listFolders(), source.listTags()]).then(
            ([{ songs, anySongs }, folders, tags]) => {
              if (!current) return;
              this.songs = songs;
              this.anySongs = anySongs;
              this.acrossFolders = asked.acrossFolders;
              this.folders = folders;
              this.tags = tags;
              this.error = null;
              loaded = true;
              // With no Songs, the search and filters have nothing to act
              // on, and ones from the URL would hide the first Song made.
              if (!anySongs && isSongListFiltered(this.view)) this.clearFilters();
            },
            (e: Error) => current && (this.error = e.message),
          );
        },
        loaded ? pause : 0,
      );
      return () => {
        current = false;
        clearTimeout(timer);
      };
    });
  }

  /** Loads again, e.g. once a Song has moved. */
  reload() {
    this.#changes++;
  }

  /** Clears the search and filters, keeping the sort. */
  clearFilters() {
    this.view = { ...defaultSongListView, sort: this.view.sort };
  }
}
