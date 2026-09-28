import { describe, expect, it } from 'vitest';
import type { Beat, SongSummary } from './api';
import {
  beatDrawerFilterCount,
  beatKeys,
  beatListViewFromParams,
  beatListViewToParams,
  beatProducers,
  defaultBeatListView,
  defaultSongListView,
  filterBeats,
  isBeatListFiltered,
  songBeatHint,
  sortBeats,
  songListViewFromParams,
  songListViewToParams,
  sortSongs,
  toggleSort,
  type BeatColumn,
  type BeatListView,
  type SongListView,
  type SortDirection,
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

function beat(title: string, fields: Partial<Beat> = {}): Beat {
  return {
    id: 0,
    title,
    producer: '',
    sourceLink: '',
    bpm: null,
    key: '',
    notes: '',
    fileName: '',
    contentType: '',
    size: 0,
    duration: 0,
    songs: [],
    createdAt: '',
    updatedAt: '',
    ...fields,
  };
}

// As the API sends them: most recently added first.
const beats = [
  beat('Night Shift', { producer: 'Kato', bpm: 95, key: 'Am', duration: 180, createdAt: '2026-09-05T00:00:00Z' }),
  beat('ocean', { producer: 'kato ', bpm: 85, key: 'am', duration: 150, createdAt: '2026-09-04T00:00:00Z' }),
  beat('Sunset', {
    producer: 'Lune',
    bpm: 90,
    key: 'C',
    duration: 200,
    songs: [{ id: 1, title: 'Paper Planes' }],
    createdAt: '2026-09-03T00:00:00Z',
  }),
  beat('Bare', { createdAt: '2026-09-02T00:00:00Z' }),
  beat('Échos', {
    producer: 'Mira',
    bpm: 120,
    key: 'F#m',
    duration: 95,
    songs: [{ id: 2, title: 'Álbum' }],
    createdAt: '2026-09-01T00:00:00Z',
  }),
];

const beatTitles = (list: Beat[]) => list.map((b) => b.title);
const showing = (view: Partial<BeatListView>) => beatTitles(filterBeats(beats, { ...defaultBeatListView, ...view }));

describe('filterBeats', () => {
  it('shows every Beat for the default view, in the order given', () => {
    expect(showing({})).toEqual(beatTitles(beats));
  });

  it('searches titles and producers, ignoring case and surrounding space', () => {
    expect(showing({ q: 'NIGHT' })).toEqual(['Night Shift']);
    expect(showing({ q: ' kato ' })).toEqual(['Night Shift', 'ocean']);
    expect(showing({ q: '   ' })).toEqual(beatTitles(beats));
  });

  it('keeps Beats by a producer, ignoring case and surrounding space', () => {
    expect(showing({ producer: 'Kato' })).toEqual(['Night Shift', 'ocean']);
    expect(showing({ producer: 'mira' })).toEqual(['Échos']);
  });

  it('keeps Beats within a BPM range, including its ends', () => {
    expect(showing({ bpmMin: 85, bpmMax: 95 })).toEqual(['Night Shift', 'ocean', 'Sunset']);
    expect(showing({ bpmMin: 90, bpmMax: 90 })).toEqual(['Sunset']);
  });

  it('leaves either end of the BPM range open', () => {
    expect(showing({ bpmMin: 95 })).toEqual(['Night Shift', 'Échos']);
    expect(showing({ bpmMax: 85 })).toEqual(['ocean']);
  });

  it('leaves out Beats with no BPM when filtering by BPM', () => {
    expect(showing({ bpmMin: 0 })).not.toContain('Bare');
    expect(showing({ bpmMax: 1000 })).not.toContain('Bare');
  });

  it('keeps Beats in a key, ignoring case and surrounding space, and leaves out those with none', () => {
    expect(showing({ key: 'AM' })).toEqual(['Night Shift', 'ocean']);
    expect(showing({ key: ' c ' })).toEqual(['Sunset']);
  });

  it('keeps Beats used in a Song, or those not used in any', () => {
    expect(showing({ use: 'used' })).toEqual(['Sunset', 'Échos']);
    expect(showing({ use: 'unused' })).toEqual(['Night Shift', 'ocean', 'Bare']);
  });

  it('combines filters', () => {
    expect(showing({ producer: 'kato', bpmMin: 90 })).toEqual(['Night Shift']);
    expect(showing({ q: 'oce', use: 'unused', key: 'am' })).toEqual(['ocean']);
    expect(showing({ key: 'C', use: 'unused' })).toEqual([]);
  });
});

describe('sortBeats', () => {
  const sorted = (column: BeatColumn, direction: SortDirection) => beatTitles(sortBeats(beats, { column, direction }));

  it('sorts by title, ignoring case and accents', () => {
    expect(sorted('title', 'asc')).toEqual(['Bare', 'Échos', 'Night Shift', 'ocean', 'Sunset']);
    expect(sorted('title', 'desc')).toEqual(['Sunset', 'ocean', 'Night Shift', 'Échos', 'Bare']);
  });

  it('sorts by producer, with Beats that have none last either way and ties in the order given', () => {
    expect(sorted('producer', 'asc')).toEqual(['Night Shift', 'ocean', 'Sunset', 'Échos', 'Bare']);
    expect(sorted('producer', 'desc')).toEqual(['Échos', 'Sunset', 'Night Shift', 'ocean', 'Bare']);
  });

  it('sorts by BPM as a number, with Beats that have none last either way', () => {
    expect(sorted('bpm', 'asc')).toEqual(['ocean', 'Sunset', 'Night Shift', 'Échos', 'Bare']);
    expect(sorted('bpm', 'desc')).toEqual(['Échos', 'Night Shift', 'Sunset', 'ocean', 'Bare']);
  });

  it('sorts by key, with Beats that have none last either way', () => {
    expect(sorted('key', 'asc')).toEqual(['Night Shift', 'ocean', 'Sunset', 'Échos', 'Bare']);
    expect(sorted('key', 'desc')).toEqual(['Échos', 'Sunset', 'Night Shift', 'ocean', 'Bare']);
  });

  it('sorts by duration', () => {
    expect(sorted('duration', 'asc')).toEqual(['Bare', 'Échos', 'ocean', 'Night Shift', 'Sunset']);
    expect(sorted('duration', 'desc')).toEqual(['Sunset', 'Night Shift', 'ocean', 'Échos', 'Bare']);
  });

  it('sorts by the Songs using a Beat, with unused Beats last either way', () => {
    expect(sorted('usedBy', 'asc')).toEqual(['Échos', 'Sunset', 'Night Shift', 'ocean', 'Bare']);
    expect(sorted('usedBy', 'desc')).toEqual(['Sunset', 'Échos', 'Night Shift', 'ocean', 'Bare']);
  });

  it('sorts by when a Beat was added', () => {
    expect(sorted('added', 'desc')).toEqual(beatTitles(beats));
    expect(sorted('added', 'asc')).toEqual(beatTitles(beats).reverse());
  });

  it('leaves the list it was given alone', () => {
    const given = [...beats];
    sortBeats(given, { column: 'title', direction: 'asc' });
    expect(given).toEqual(beats);
  });

  it('starts Added newest first when picked', () => {
    expect(toggleSort<BeatColumn>({ column: 'title', direction: 'asc' }, 'added')).toEqual({
      column: 'added',
      direction: 'desc',
    });
  });
});

describe('beatProducers and beatKeys', () => {
  it('are the producers and keys in the Library, once each ignoring case, sorted', () => {
    expect(beatProducers(beats)).toEqual(['Kato', 'Lune', 'Mira']);
    expect(beatKeys(beats)).toEqual(['Am', 'C', 'F#m']);
  });
});

describe('the Beat Library in the URL', () => {
  const roundTrip = (view: BeatListView) => beatListViewFromParams(beatListViewToParams(view));

  it('leaves the URL plain for the default view', () => {
    expect(beatListViewToParams(defaultBeatListView).toString()).toBe('');
    expect(beatListViewFromParams(new URLSearchParams())).toEqual(defaultBeatListView);
  });

  it('keeps each filter and sort through a round trip', () => {
    const views: BeatListView[] = [
      { ...defaultBeatListView, q: 'night shift' },
      { ...defaultBeatListView, producer: 'Kato & Lune' },
      { ...defaultBeatListView, bpmMin: 85 },
      { ...defaultBeatListView, bpmMax: 95.5 },
      { ...defaultBeatListView, key: 'F#m' },
      { ...defaultBeatListView, use: 'used' },
      { ...defaultBeatListView, use: 'unused' },
      { ...defaultBeatListView, sort: { column: 'usedBy', direction: 'asc' } },
      { ...defaultBeatListView, sort: { column: 'added', direction: 'asc' } },
      {
        q: 'canção',
        producer: 'Mira',
        bpmMin: 80,
        bpmMax: 100,
        key: 'C#m',
        use: 'unused',
        sort: { column: 'bpm', direction: 'desc' },
      },
    ];
    for (const view of views) expect(roundTrip(view)).toEqual(view);
  });

  it('writes only what differs from the default', () => {
    expect(beatListViewToParams({ ...defaultBeatListView, bpmMin: 85, bpmMax: 95, use: 'used' }).toString()).toBe(
      'bpmMin=85&bpmMax=95&use=used',
    );
    expect(beatListViewToParams({ ...defaultBeatListView, sort: { column: 'key', direction: 'asc' } }).toString()).toBe(
      'sort=key',
    );
  });

  it('leaves blank text out', () => {
    expect(beatListViewToParams({ ...defaultBeatListView, q: ' ', producer: '  ', key: '' }).toString()).toBe('');
  });

  it('falls back to the default for anything unknown or malformed', () => {
    const params = new URLSearchParams('bpmMin=fast&bpmMax=&use=sometimes&sort=-loudness&producer=&key=&page=2');
    expect(beatListViewFromParams(params)).toEqual(defaultBeatListView);
    expect(beatListViewFromParams(new URLSearchParams('bpmMin=-5&bpmMax=Infinity'))).toEqual(defaultBeatListView);
  });

  it('keeps the parameters it understands beside ones it doesn’t', () => {
    expect(beatListViewFromParams(new URLSearchParams('bpmMin=fast&bpmMax=100&sort=-bpm&use=maybe'))).toEqual({
      ...defaultBeatListView,
      bpmMax: 100,
      sort: { column: 'bpm', direction: 'desc' },
    });
  });
});

describe('isBeatListFiltered', () => {
  it('is whether any filter is set, whatever the sort', () => {
    expect(isBeatListFiltered(defaultBeatListView)).toBe(false);
    expect(isBeatListFiltered({ ...defaultBeatListView, q: '  ', sort: { column: 'bpm', direction: 'asc' } })).toBe(false);
    expect(isBeatListFiltered({ ...defaultBeatListView, bpmMin: 0 })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, use: 'unused' })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, q: 'x' })).toBe(true);
  });
});

describe('beatDrawerFilterCount', () => {
  it('counts the set filters other than the search, a BPM range as one', () => {
    expect(beatDrawerFilterCount({ ...defaultBeatListView, q: 'x' })).toBe(0);
    expect(beatDrawerFilterCount({ ...defaultBeatListView, bpmMin: 80, bpmMax: 100 })).toBe(1);
    expect(beatDrawerFilterCount({ ...defaultBeatListView, producer: 'Nox', key: 'Am', use: 'used', bpmMax: 0 })).toBe(4);
  });

  it('ignores blank text', () => {
    expect(beatDrawerFilterCount({ ...defaultBeatListView, producer: '  ', key: '' })).toBe(0);
  });
});

describe('songBeatHint', () => {
  it("shows the Song's BPM and key", () => {
    expect(songBeatHint({ bpm: 92, key: 'Am' })).toBe('92 BPM · Am');
  });

  it('shows only what is set', () => {
    expect(songBeatHint({ bpm: 92, key: ' ' })).toBe('92 BPM');
    expect(songBeatHint({ bpm: null, key: ' C#m ' })).toBe('C#m');
  });

  it('is nothing when neither is set', () => {
    expect(songBeatHint({ bpm: null, key: '' })).toBeUndefined();
  });
});
