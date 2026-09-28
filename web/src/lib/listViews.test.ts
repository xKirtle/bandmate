import { describe, expect, it } from 'vitest';
import type { SongSummary } from './api';
import {
  defaultSongListView,
  songListViewFromParams,
  songListViewToParams,
  sortSongs,
  toggleSort,
  type SongListView,
} from './listViews';

function song(title: string, fields: Partial<SongSummary> = {}): SongSummary {
  return { id: 0, title, status: 'idea', key: '', bpm: null, hasMaster: false, updatedAt: '', ...fields };
}

// As the API sends them: most recently edited first.
const songs = [
  song('Paper Planes', { status: 'finished', key: 'G', bpm: 120, hasMaster: true, updatedAt: '2026-09-04T00:00:00Z' }),
  song('midnight drive', { status: 'drafting', key: 'Am', bpm: 92, updatedAt: '2026-09-03T00:00:00Z' }),
  song('Bare', { updatedAt: '2026-09-02T00:00:00Z' }),
  song('Álbum', { status: 'drafting', key: 'C#m', bpm: 92, hasMaster: true, updatedAt: '2026-09-01T00:00:00Z' }),
];

const titles = (list: SongSummary[]) => list.map((s) => s.title);

describe('sortSongs', () => {
  it('sorts by title, ignoring case and accents', () => {
    expect(titles(sortSongs(songs, { column: 'title', direction: 'asc' }))).toEqual([
      'Álbum',
      'Bare',
      'midnight drive',
      'Paper Planes',
    ]);
    expect(titles(sortSongs(songs, { column: 'title', direction: 'desc' }))).toEqual([
      'Paper Planes',
      'midnight drive',
      'Bare',
      'Álbum',
    ]);
  });

  it('sorts by Status in lifecycle order, keeping ties in the order given', () => {
    expect(titles(sortSongs(songs, { column: 'status', direction: 'asc' }))).toEqual([
      'Bare',
      'midnight drive',
      'Álbum',
      'Paper Planes',
    ]);
    expect(titles(sortSongs(songs, { column: 'status', direction: 'desc' }))).toEqual([
      'Paper Planes',
      'midnight drive',
      'Álbum',
      'Bare',
    ]);
  });

  it('sorts by key, with Songs that have none last either way', () => {
    expect(titles(sortSongs(songs, { column: 'key', direction: 'asc' }))).toEqual([
      'midnight drive',
      'Álbum',
      'Paper Planes',
      'Bare',
    ]);
    expect(titles(sortSongs(songs, { column: 'key', direction: 'desc' }))).toEqual([
      'Paper Planes',
      'Álbum',
      'midnight drive',
      'Bare',
    ]);
  });

  it('sorts by BPM as a number, with Songs that have none last either way', () => {
    const withSlow = [...songs, song('Slow', { bpm: 70 })];
    expect(titles(sortSongs(withSlow, { column: 'bpm', direction: 'asc' }))).toEqual([
      'Slow',
      'midnight drive',
      'Álbum',
      'Paper Planes',
      'Bare',
    ]);
    expect(titles(sortSongs(withSlow, { column: 'bpm', direction: 'desc' }))).toEqual([
      'Paper Planes',
      'midnight drive',
      'Álbum',
      'Slow',
      'Bare',
    ]);
  });

  it('sorts by whether a Song has a Master, those with one first', () => {
    expect(titles(sortSongs(songs, { column: 'master', direction: 'asc' }))).toEqual([
      'Paper Planes',
      'Álbum',
      'midnight drive',
      'Bare',
    ]);
    expect(titles(sortSongs(songs, { column: 'master', direction: 'desc' }))).toEqual([
      'midnight drive',
      'Bare',
      'Paper Planes',
      'Álbum',
    ]);
  });

  it('sorts by when a Song was last edited', () => {
    expect(titles(sortSongs(songs, { column: 'edited', direction: 'desc' }))).toEqual(titles(songs));
    expect(titles(sortSongs(songs, { column: 'edited', direction: 'asc' }))).toEqual(titles(songs).reverse());
  });

  it('leaves the list it was given alone', () => {
    const given = [...songs];
    sortSongs(given, { column: 'title', direction: 'asc' });
    expect(given).toEqual(songs);
  });
});

describe('toggleSort', () => {
  it('sorts a new column in its natural direction', () => {
    expect(toggleSort({ column: 'edited', direction: 'desc' }, 'title')).toEqual({ column: 'title', direction: 'asc' });
    expect(toggleSort({ column: 'title', direction: 'asc' }, 'edited')).toEqual({
      column: 'edited',
      direction: 'desc',
    });
  });

  it('flips the direction of the column already sorted by', () => {
    expect(toggleSort({ column: 'bpm', direction: 'asc' }, 'bpm')).toEqual({ column: 'bpm', direction: 'desc' });
    expect(toggleSort({ column: 'bpm', direction: 'desc' }, 'bpm')).toEqual({ column: 'bpm', direction: 'asc' });
  });
});

describe('the Song list in the URL', () => {
  const roundTrip = (view: SongListView) => songListViewFromParams(songListViewToParams(view));

  it('leaves the URL plain for the default view', () => {
    expect(songListViewToParams(defaultSongListView).toString()).toBe('');
    expect(songListViewFromParams(new URLSearchParams())).toEqual(defaultSongListView);
  });

  it('keeps each filter and sort through a round trip', () => {
    const views: SongListView[] = [
      { ...defaultSongListView, q: 'night drive' },
      { ...defaultSongListView, status: 'drafting' },
      { ...defaultSongListView, hasMaster: true },
      { ...defaultSongListView, sort: { column: 'bpm', direction: 'asc' } },
      { ...defaultSongListView, sort: { column: 'edited', direction: 'asc' } },
      { q: 'canção & 100%', status: 'finished', hasMaster: true, sort: { column: 'title', direction: 'desc' } },
    ];
    for (const view of views) expect(roundTrip(view)).toEqual(view);
  });

  it('writes only what differs from the default', () => {
    expect(songListViewToParams({ ...defaultSongListView, status: 'idea', hasMaster: true }).toString()).toBe(
      'status=idea&hasMaster=true',
    );
    expect(songListViewToParams({ ...defaultSongListView, sort: { column: 'bpm', direction: 'desc' } }).toString()).toBe(
      'sort=-bpm',
    );
  });

  it('leaves a blank search out', () => {
    expect(songListViewToParams({ ...defaultSongListView, q: '   ' }).toString()).toBe('');
  });

  it('falls back to the default for anything unknown or malformed', () => {
    const params = new URLSearchParams('status=released&hasMaster=maybe&sort=-loudness&page=2');
    expect(songListViewFromParams(params)).toEqual(defaultSongListView);
    expect(songListViewFromParams(new URLSearchParams('sort=--bpm'))).toEqual(defaultSongListView);
    expect(songListViewFromParams(new URLSearchParams('sort='))).toEqual(defaultSongListView);
  });

  it('keeps the parameters it understands beside ones it doesn’t', () => {
    expect(songListViewFromParams(new URLSearchParams('status=released&sort=key&q=drive'))).toEqual({
      ...defaultSongListView,
      q: 'drive',
      sort: { column: 'key', direction: 'asc' },
    });
  });
});
