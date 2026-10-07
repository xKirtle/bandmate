import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { ApiError, type Folder, type SongFilter, type SongSummary, type Tag } from './api';
import { defaultSongListView, type SongListView } from './listViews';
import { SongListQuery } from './songListQuery.svelte';

function song(title: string, fields: Partial<SongSummary> = {}): SongSummary {
  return {
    id: 0,
    title,
    status: 'idea',
    key: '',
    bpm: null,
    hasMaster: false,
    coverId: null,
    folderId: null,
    tags: [],
    updatedAt: '',
    ...fields,
  };
}

const folder = (id: number, name: string): Folder => ({ id, name, songs: 0 }) as Folder;

/**
 * A server holding some Songs, Folders and Tags, filtering the Songs as the
 * real one does. It answers a Folder it doesn't hold with a 404, and, while
 * held, keeps its answers to the Song list until released.
 */
function fakeServer(songs: SongSummary[], folders: Folder[] = [], tags: Tag[] = []) {
  const asked: SongFilter[] = [];
  let held: (() => void)[] | null = null;
  const matches = (s: SongSummary, filter: SongFilter) =>
    (!filter.statuses || filter.statuses.includes(s.status)) &&
    (!filter.tags || filter.tags.every((t) => s.tags.some((c) => c.toLowerCase() === t.toLowerCase()))) &&
    (!filter.q?.trim() || s.title.toLowerCase().includes(filter.q.trim().toLowerCase())) &&
    (filter.hasMaster === undefined || s.hasMaster === filter.hasMaster) &&
    (filter.folder === undefined || s.folderId === (filter.folder === 'none' ? null : filter.folder));
  const listSongs = (filter: SongFilter) => {
    asked.push(filter);
    const answer = () => {
      if (typeof filter.folder === 'number' && !folders.some((f) => f.id === filter.folder))
        return Promise.reject(new ApiError(404, 'folder not found'));
      return Promise.resolve(songs.filter((s) => matches(s, filter)));
    };
    if (!held) return answer();
    const waiting = held;
    return new Promise<SongSummary[]>((resolve, reject) => waiting.push(() => answer().then(resolve, reject)));
  };
  return {
    source: {
      listSongs,
      listFolders: () => Promise.resolve(folders),
      listTags: () => Promise.resolve(tags),
    },
    asked,
    /** Holds the answers to the Song list from now on, until released. */
    hold() {
      held = [];
    },
    /** Answers the Song lists held, the one asked for at index i. */
    release(i: number) {
      held?.[i]();
    },
  };
}

const view = (fields: Partial<SongListView> = {}): SongListView => ({ ...defaultSongListView, ...fields });

const titles = (list: SongSummary[] | null) => list?.map((s) => s.title);

let cleanups: (() => void)[] = [];

/** A query, as the Song list makes one, for a Folder or the top level. */
function query(server: ReturnType<typeof fakeServer>, start: SongListView = view(), folderId?: number) {
  let made!: SongListQuery;
  cleanups.push(
    $effect.root(() => {
      made = new SongListQuery(server.source, start, folderId);
    }),
  );
  return made;
}

/** Lets the query load: its pause, and the server's answers. */
async function settle() {
  flushSync();
  await vi.runAllTimersAsync();
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  vi.useRealTimers();
});

describe('SongListQuery', () => {
  it('at the top level, unfiltered, lists the Songs in no Folder, with the Folders and Tags', async () => {
    const server = fakeServer(
      [song('Loose'), song('Filed', { folderId: 3 })],
      [folder(3, 'Demos')],
      [{ id: 1, name: 'Live', songs: 0 }],
    );
    const songs = query(server);
    await settle();
    expect(titles(songs.songs)).toEqual(['Loose']);
    expect(songs.folders?.map((f) => f.name)).toEqual(['Demos']);
    expect(songs.tags.map((t) => t.name)).toEqual(['Live']);
    expect(songs.acrossFolders).toBe(false);
    expect(songs.anySongs).toBe(true);
    expect(songs.error).toBeNull();
  });

  it('at the top level, a search lists every Song it matches, across Folders', async () => {
    const server = fakeServer(
      [song('Night Drive'), song('Night Owl', { folderId: 3 }), song('Daylight', { folderId: 3 })],
      [folder(3, 'Demos')],
    );
    const songs = query(server, view({ q: 'night' }));
    await settle();
    expect(titles(songs.songs)).toEqual(['Night Drive', 'Night Owl']);
    expect(songs.acrossFolders).toBe(true);
    expect(songs.anySongs).toBe(true);
  });

  it('inside a Folder, lists only its Songs, searched or not', async () => {
    const server = fakeServer(
      [song('Night Drive', { folderId: 3 }), song('Daylight', { folderId: 3 }), song('Night Owl', { folderId: 4 })],
      [folder(3, 'Demos'), folder(4, 'Live')],
    );
    const songs = query(server, view(), 3);
    await settle();
    expect(titles(songs.songs)).toEqual(['Night Drive', 'Daylight']);
    expect(songs.acrossFolders).toBe(false);
    songs.view.q = 'night';
    await settle();
    expect(titles(songs.songs)).toEqual(['Night Drive']);
    expect(songs.acrossFolders).toBe(false);
  });

  describe('tells no matches from no Songs', () => {
    it('at the top level, a filter matching nothing, with Songs elsewhere', async () => {
      const server = fakeServer([song('Night Drive', { folderId: 3 })], [folder(3, 'Demos')]);
      const songs = query(server, view({ statuses: ['finished'] }));
      await settle();
      expect(songs.songs).toEqual([]);
      expect(songs.anySongs).toBe(true);
    });

    it('at the top level, unfiltered, with every Song in a Folder', async () => {
      const server = fakeServer([song('Night Drive', { folderId: 3 })], [folder(3, 'Demos')]);
      const songs = query(server);
      await settle();
      expect(songs.songs).toEqual([]);
      expect(songs.anySongs).toBe(true);
    });

    it('at the top level, with no Songs anywhere', async () => {
      const songs = query(fakeServer([], [folder(3, 'Demos')]));
      await settle();
      expect(songs.songs).toEqual([]);
      expect(songs.anySongs).toBe(false);
    });

    it('in a Folder, a filter matching nothing among its Songs', async () => {
      const server = fakeServer([song('Night Drive', { folderId: 3 })], [folder(3, 'Demos')]);
      const songs = query(server, view({ statuses: ['finished'] }), 3);
      await settle();
      expect(songs.songs).toEqual([]);
      expect(songs.anySongs).toBe(true);
    });

    it('in a Folder holding no Songs, whatever is elsewhere', async () => {
      const server = fakeServer([song('Night Drive')], [folder(3, 'Demos')]);
      const songs = query(server, view({ statuses: ['finished'] }), 3);
      await settle();
      expect(songs.anySongs).toBe(false);
    });

    it('asks only once when some Songs match', async () => {
      const server = fakeServer([song('Night Drive')]);
      query(server, view({ q: 'night' }));
      await settle();
      expect(server.asked).toEqual([{ q: 'night' }]);
    });
  });

  it("lists no Songs in a Folder that doesn't exist, without failing", async () => {
    const songs = query(fakeServer([song('Night Drive')], [folder(3, 'Demos')]), view(), 9);
    await settle();
    expect(songs.songs).toEqual([]);
    expect(songs.anySongs).toBe(false);
    expect(songs.folders?.map((f) => f.id)).toEqual([3]);
    expect(songs.error).toBeNull();
  });

  it('shows only the latest answer, dropping an older one that comes after it', async () => {
    const server = fakeServer([song('Night Drive'), song('Daylight')]);
    server.hold();
    const songs = query(server, view({ q: 'night' }));
    await settle();
    songs.view.q = 'day';
    await settle();
    server.release(1);
    await settle();
    expect(titles(songs.songs)).toEqual(['Daylight']);
    server.release(0);
    await settle();
    expect(titles(songs.songs)).toEqual(['Daylight']);
  });

  it('loads straight away at first, then waits for a pause in typing', async () => {
    const server = fakeServer([song('Night Drive'), song('Daylight')]);
    const songs = query(server);
    flushSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.asked).toHaveLength(1);
    songs.view.q = 'n';
    flushSync();
    await vi.advanceTimersByTimeAsync(150);
    songs.view.q = 'ni';
    flushSync();
    await vi.advanceTimersByTimeAsync(150);
    expect(server.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(server.asked.slice(1)).toEqual([{ q: 'ni' }]);
    flushSync();
    expect(titles(songs.songs)).toEqual(['Night Drive']);
  });

  it('clears the filters, keeping the sort, once there turn out to be no Songs', async () => {
    const sort = { column: 'title', direction: 'asc' } as const;
    const songs = query(fakeServer([]), view({ q: 'night', statuses: ['finished'], tags: ['Live'], sort }));
    await settle();
    expect(songs.view).toEqual(view({ sort }));
  });

  it('keeps the filters when only nothing matches them', async () => {
    const songs = query(fakeServer([song('Daylight')]), view({ q: 'night' }));
    await settle();
    expect(songs.view.q).toBe('night');
  });

  it('loads again when asked, e.g. once a Song has moved', async () => {
    const all = [song('Night Drive')];
    const songs = query(fakeServer(all, [folder(3, 'Demos')]));
    await settle();
    all[0] = song('Night Drive', { folderId: 3 });
    songs.reload();
    await settle();
    expect(songs.songs).toEqual([]);
  });

  it("says why it couldn't load, until it can", async () => {
    const server = fakeServer([song('Night Drive')]);
    let down = true;
    const listTags = server.source.listTags;
    server.source.listTags = () => (down ? Promise.reject(new Error('Bandmate is offline')) : listTags());
    const songs = query(server);
    await settle();
    expect(songs.error).toBe('Bandmate is offline');
    down = false;
    songs.reload();
    await settle();
    expect(songs.error).toBeNull();
    expect(titles(songs.songs)).toEqual(['Night Drive']);
  });
});
