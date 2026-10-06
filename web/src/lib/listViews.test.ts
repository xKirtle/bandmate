import { describe, expect, it } from 'vitest';
import type { Beat, SongFilter, SongSummary } from './api';
import {
  beatKeys,
  beatListViewFromParams,
  beatListViewToParams,
  beatProducers,
  bpmFilterLabel,
  defaultBeatListView,
  defaultSongListView,
  filterBeats,
  isBeatListFiltered,
  isPicked,
  isSongListFiltered,
  keyFilterLabel,
  loadSongList,
  matchingChoices,
  pickChoices,
  producerFilterLabel,
  renamePick,
  songListFilter,
  songBeatHint,
  sortBeats,
  sortFolders,
  songCount,
  songListViewFromParams,
  songListViewToParams,
  sortSongs,
  statusFilterLabel,
  tagFilterLabel,
  togglePick,
  toggleSort,
  useFilterLabel,
  type BeatColumn,
  type BeatListView,
  type SongListView,
  type SortDirection,
} from './listViews';

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

describe('loadSongList', () => {
  // Lists Songs as the server would, from a fixed set, recording each filter asked for.
  function server(all: SongSummary[]) {
    const asked: SongFilter[] = [];
    const list = async (filter: SongFilter) => {
      asked.push(filter);
      return all.filter(
        (s) =>
          (!filter.statuses || filter.statuses.includes(s.status)) &&
          (!filter.q || s.title.includes(filter.q)) &&
          (filter.folder === undefined || s.folderId === (filter.folder === 'none' ? null : filter.folder)),
      );
    };
    return { asked, list };
  }

  it('tells there are no Songs when the unfiltered list is empty', async () => {
    const { asked, list } = server([]);
    expect(await loadSongList({}, list)).toEqual({ songs: [], anySongs: false });
    expect(asked).toEqual([{}]);
  });

  it('asks for every Song when none match, to tell no matches from no Songs', async () => {
    const { list } = server([song('Night Drive', { status: 'drafting' })]);
    expect(await loadSongList({ statuses: ['finished'] }, list)).toEqual({ songs: [], anySongs: true });
  });

  it('tells there are no Songs when filters are set but there are none to match', async () => {
    const { list } = server([]);
    expect(await loadSongList({ statuses: ['finished'], q: 'night', hasMaster: true }, list)).toEqual({
      songs: [],
      anySongs: false,
    });
  });

  it('asks only once when some Songs match', async () => {
    const nightDrive = song('Night Drive', { status: 'drafting' });
    const { asked, list } = server([nightDrive, song('Daylight')]);
    expect(await loadSongList({ statuses: ['drafting', 'finished'] }, list)).toEqual({
      songs: [nightDrive],
      anySongs: true,
    });
    expect(asked).toEqual([{ statuses: ['drafting', 'finished'] }]);
  });

  it('inside a Folder, tells whether it holds any Songs, whatever the filters', async () => {
    const { asked, list } = server([song('Night Drive', { folderId: 3 }), song('Elsewhere', { folderId: 4 })]);
    expect(await loadSongList({ folder: 3, statuses: ['finished'] }, list)).toEqual({ songs: [], anySongs: true });
    expect(asked).toEqual([{ folder: 3, statuses: ['finished'] }, { folder: 3 }]);
    asked.length = 0;
    expect(await loadSongList({ folder: 5 }, list)).toEqual({ songs: [], anySongs: false });
    expect(asked).toEqual([{ folder: 5 }]);
  });

  it('at the top level, tells there are Songs when every one is in a Folder', async () => {
    const { asked, list } = server([song('Night Drive', { folderId: 3 })]);
    expect(await loadSongList({ folder: 'none' }, list)).toEqual({ songs: [], anySongs: true });
    expect(asked).toEqual([{ folder: 'none' }, {}]);
  });
});

describe('songListFilter', () => {
  const view = (fields: Partial<SongListView> = {}): SongListView => ({ ...defaultSongListView, ...fields });

  it('at the top level, unfiltered, asks for the Songs in no Folder', () => {
    expect(songListFilter(view())).toEqual({ folder: 'none' });
    expect(songListFilter(view({ q: '   ' }))).toEqual({ folder: 'none' });
  });

  it('at the top level, a search or any filter asks for every Song, whatever its Folder', () => {
    expect(songListFilter(view({ q: 'night' }))).toEqual({ q: 'night' });
    expect(songListFilter(view({ statuses: ['drafting'] }))).toEqual({ statuses: ['drafting'] });
    expect(songListFilter(view({ statuses: ['idea', 'drafting'] }))).toEqual({ statuses: ['idea', 'drafting'] });
    expect(songListFilter(view({ hasMaster: true }))).toEqual({ hasMaster: true });
    expect(songListFilter(view({ tags: ['Live', 'Album 2023'] }))).toEqual({ tags: ['Live', 'Album 2023'] });
  });

  it('inside a Folder, asks only for its Songs, filtered or not', () => {
    expect(songListFilter(view(), 3)).toEqual({ folder: 3 });
    expect(
      songListFilter(view({ q: 'night', statuses: ['idea', 'finished'], tags: ['Live'], hasMaster: true }), 3),
    ).toEqual({
      q: 'night',
      statuses: ['idea', 'finished'],
      tags: ['Live'],
      hasMaster: true,
      folder: 3,
    });
  });
});

describe('isSongListFiltered', () => {
  it('is on for a search or any filter, not for a sort or a blank search', () => {
    expect(isSongListFiltered(defaultSongListView)).toBe(false);
    expect(isSongListFiltered({ ...defaultSongListView, q: '  ', sort: { column: 'title', direction: 'asc' } })).toBe(
      false,
    );
    expect(isSongListFiltered({ ...defaultSongListView, q: 'night' })).toBe(true);
    expect(isSongListFiltered({ ...defaultSongListView, statuses: ['finished'] })).toBe(true);
    expect(isSongListFiltered({ ...defaultSongListView, statuses: ['idea', 'drafting', 'finished'] })).toBe(true);
    expect(isSongListFiltered({ ...defaultSongListView, hasMaster: true })).toBe(true);
    expect(isSongListFiltered({ ...defaultSongListView, tags: ['Live'] })).toBe(true);
  });
});

describe('sortFolders', () => {
  it('sorts Folders by name, ignoring case and accents, numbers in order', () => {
    const folder = (id: number, name: string) => ({ id, name, songs: 0 });
    const sorted = sortFolders([folder(1, 'ep 10'), folder(2, 'Demos'), folder(3, 'EP 9'), folder(4, 'Ábaco')]);
    expect(sorted.map((f) => f.name)).toEqual(['Ábaco', 'Demos', 'EP 9', 'ep 10']);
  });
});

describe('songCount', () => {
  it('counts Songs, one in the singular', () => {
    expect([0, 1, 2].map(songCount)).toEqual(['0 Songs', '1 Song', '2 Songs']);
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

describe('statusFilterLabel', () => {
  it('names the filter alone while no Status is picked', () => {
    expect(statusFilterLabel([])).toBe('Status');
  });

  it('names the Statuses picked, capitalised, in lifecycle order', () => {
    expect(statusFilterLabel(['drafting'])).toBe('Status: Drafting');
    expect(statusFilterLabel(['finished', 'idea', 'drafting'])).toBe('Status: Idea, Drafting, Finished');
  });
});

describe('tagFilterLabel', () => {
  it('names the filter alone while no Tag is picked', () => {
    expect(tagFilterLabel([])).toBe('Tags');
  });

  it('names the Tags picked, sorted ignoring case', () => {
    expect(tagFilterLabel(['Album 2023'])).toBe('Tags: Album 2023');
    expect(tagFilterLabel(['live', 'Covers', 'Album 2023'])).toBe('Tags: Album 2023, Covers, live');
  });
});

describe('matchingChoices', () => {
  const tags = ['Album 2023', 'Canção', 'Covers', 'Live'];

  it('keeps every choice for a blank find', () => {
    expect(matchingChoices(tags, '')).toEqual(tags);
    expect(matchingChoices(tags, '   ')).toEqual(tags);
  });

  it('keeps the choices containing what is typed, ignoring case and surrounding space', () => {
    expect(matchingChoices(tags, 'CO')).toEqual(['Covers']);
    expect(matchingChoices(tags, ' ção ')).toEqual(['Canção']);
    expect(matchingChoices(tags, 'v')).toEqual(['Covers', 'Live']);
    expect(matchingChoices(tags, 'nothing')).toEqual([]);
  });
});

describe('renamePick', () => {
  it('renames a pick in place, matched ignoring case', () => {
    expect(renamePick(['Covers', 'live', 'Album 2023'], 'Live', 'Live shows')).toEqual([
      'Covers',
      'Live shows',
      'Album 2023',
    ]);
  });

  it('keeps one pick when renamed onto another picked, as Tags merge', () => {
    expect(renamePick(['live', 'Live shows'], 'live', 'LIVE SHOWS')).toEqual(['LIVE SHOWS']);
    expect(renamePick(['Live shows', 'live'], 'live', 'live shows')).toEqual(['live shows']);
  });

  it('leaves the picks as they are when the one renamed is not picked', () => {
    expect(renamePick(['Covers'], 'live', 'Live shows')).toEqual(['Covers']);
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
      { ...defaultSongListView, statuses: ['drafting'] },
      { ...defaultSongListView, statuses: ['idea', 'drafting'] },
      { ...defaultSongListView, hasMaster: true },
      { ...defaultSongListView, tags: ['Live'] },
      { ...defaultSongListView, tags: ['Album 2023', 'canção & 100%'] },
      { ...defaultSongListView, sort: { column: 'bpm', direction: 'asc' } },
      { ...defaultSongListView, sort: { column: 'edited', direction: 'asc' } },
      {
        q: 'canção & 100%',
        statuses: ['drafting', 'finished'],
        tags: ['Live', 'Covers'],
        hasMaster: true,
        sort: { column: 'title', direction: 'desc' },
      },
    ];
    for (const view of views) expect(roundTrip(view)).toEqual(view);
  });

  it('writes only what differs from the default', () => {
    expect(songListViewToParams({ ...defaultSongListView, statuses: ['idea'], hasMaster: true }).toString()).toBe(
      'status=idea&hasMaster=true',
    );
    expect(songListViewToParams({ ...defaultSongListView, statuses: ['idea', 'finished'] }).toString()).toBe(
      'status=idea&status=finished',
    );
    expect(songListViewToParams({ ...defaultSongListView, tags: ['Live', 'Album 2023'] }).toString()).toBe(
      'tag=Live&tag=Album+2023',
    );
    expect(
      songListViewToParams({ ...defaultSongListView, sort: { column: 'bpm', direction: 'desc' } }).toString(),
    ).toBe('sort=-bpm');
  });

  it('reads an old URL with a single Status', () => {
    expect(songListViewFromParams(new URLSearchParams('status=drafting'))).toEqual({
      ...defaultSongListView,
      statuses: ['drafting'],
    });
  });

  it('reads several Statuses in lifecycle order, each once, leaving out unknown ones', () => {
    expect(
      songListViewFromParams(new URLSearchParams('status=finished&status=released&status=idea&status=finished')),
    ).toEqual({ ...defaultSongListView, statuses: ['idea', 'finished'] });
  });

  it('reads several Tags, each once ignoring case, leaving out blank ones', () => {
    expect(songListViewFromParams(new URLSearchParams('tag=Live&tag=&tag=LIVE&tag=Covers'))).toEqual({
      ...defaultSongListView,
      tags: ['Live', 'Covers'],
    });
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
    expect(showing({ producers: ['Kato'] })).toEqual(['Night Shift', 'ocean']);
    expect(showing({ producers: ['mira'] })).toEqual(['Échos']);
  });

  it('keeps Beats by any of several producers', () => {
    expect(showing({ producers: ['Kato', 'Mira'] })).toEqual(['Night Shift', 'ocean', 'Échos']);
    expect(showing({ producers: ['lune', 'Nobody'] })).toEqual(['Sunset']);
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
    expect(showing({ keys: ['AM'] })).toEqual(['Night Shift', 'ocean']);
    expect(showing({ keys: [' c '] })).toEqual(['Sunset']);
  });

  it('keeps Beats in any of several keys, each matched as written', () => {
    expect(showing({ keys: ['C', 'F#m'] })).toEqual(['Sunset', 'Échos']);
    expect(showing({ keys: ['Gbm'] })).toEqual([]);
  });

  it('keeps Beats used in a Song, or those not used in any', () => {
    expect(showing({ use: 'used' })).toEqual(['Sunset', 'Échos']);
    expect(showing({ use: 'unused' })).toEqual(['Night Shift', 'ocean', 'Bare']);
  });

  it('combines filters', () => {
    expect(showing({ producers: ['kato'], bpmMin: 90 })).toEqual(['Night Shift']);
    expect(showing({ q: 'oce', use: 'unused', keys: ['am'] })).toEqual(['ocean']);
    expect(showing({ keys: ['C'], use: 'unused' })).toEqual([]);
    expect(showing({ producers: ['Kato', 'Lune'], keys: ['C', 'F#m'] })).toEqual(['Sunset']);
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

describe('picking producers and keys', () => {
  it('offers those picked that no Beat has, before the Library’s, once each', () => {
    expect(pickChoices(['Kato', 'Lune'], [])).toEqual(['Kato', 'Lune']);
    expect(pickChoices(['Kato', 'Lune'], [' kato', 'Ghost'])).toEqual(['Ghost', 'Kato', 'Lune']);
  });

  it('ticks a choice on once, or off, ignoring case and surrounding space', () => {
    expect(togglePick(['Kato'], 'Mira', true)).toEqual(['Kato', 'Mira']);
    expect(togglePick(['Kato'], ' kato', true)).toEqual([' kato']);
    expect(togglePick(['Kato', 'Mira'], 'KATO', false)).toEqual(['Mira']);
  });

  it('tells whether a choice is picked, ignoring case and surrounding space', () => {
    expect(isPicked(['Kato '], 'kato')).toBe(true);
    expect(isPicked(['Kato'], 'Mira')).toBe(false);
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
      { ...defaultBeatListView, producers: ['Kato & Lune'] },
      { ...defaultBeatListView, producers: ['Kato', 'Mira'] },
      { ...defaultBeatListView, bpmMin: 85 },
      { ...defaultBeatListView, bpmMax: 95.5 },
      { ...defaultBeatListView, keys: ['F#m'] },
      { ...defaultBeatListView, keys: ['C#m', 'Dbm'] },
      { ...defaultBeatListView, use: 'used' },
      { ...defaultBeatListView, use: 'unused' },
      { ...defaultBeatListView, sort: { column: 'usedBy', direction: 'asc' } },
      { ...defaultBeatListView, sort: { column: 'added', direction: 'asc' } },
      {
        q: 'canção',
        producers: ['Mira', 'Lune'],
        bpmMin: 80,
        bpmMax: 100,
        keys: ['C#m'],
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

  it('writes each producer and key picked as a parameter of its own', () => {
    expect(
      beatListViewToParams({ ...defaultBeatListView, producers: ['Kato', 'Mira'], keys: ['Am', 'C'] }).toString(),
    ).toBe('producer=Kato&producer=Mira&key=Am&key=C');
  });

  it('reads an old URL with a single producer or key', () => {
    expect(beatListViewFromParams(new URLSearchParams('producer=Kato&key=F%23m'))).toEqual({
      ...defaultBeatListView,
      producers: ['Kato'],
      keys: ['F#m'],
    });
  });

  it('reads each producer and key once, ignoring case', () => {
    expect(beatListViewFromParams(new URLSearchParams('producer=Ghost&producer=ghost&key=Am&key=Am'))).toEqual({
      ...defaultBeatListView,
      producers: ['Ghost'],
      keys: ['Am'],
    });
  });

  it('leaves blank text out', () => {
    expect(beatListViewToParams({ ...defaultBeatListView, q: ' ', producers: ['  '], keys: [''] }).toString()).toBe('');
    expect(beatListViewFromParams(new URLSearchParams('producer=&producer=Kato&key=+'))).toEqual({
      ...defaultBeatListView,
      producers: ['Kato'],
    });
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

describe('the Beat filter buttons', () => {
  it('name the filter alone while nothing is picked', () => {
    expect(producerFilterLabel([])).toBe('Producer');
    expect(keyFilterLabel([])).toBe('Key');
    expect(bpmFilterLabel({})).toBe('BPM');
    expect(useFilterLabel(undefined)).toBe('Used');
  });

  it('name the producers and keys picked, sorted ignoring case', () => {
    expect(producerFilterLabel(['Mira', 'kato'])).toBe('Producer: kato, Mira');
    expect(keyFilterLabel(['F#m', 'Am', 'C'])).toBe('Key: Am, C, F#m');
  });

  it('name the BPM range, or the end of it that is set', () => {
    expect(bpmFilterLabel({ bpmMin: 80, bpmMax: 95 })).toBe('BPM: 80–95');
    expect(bpmFilterLabel({ bpmMin: 90, bpmMax: 90 })).toBe('BPM: 90');
    expect(bpmFilterLabel({ bpmMin: 80 })).toBe('BPM: from 80');
    expect(bpmFilterLabel({ bpmMax: 95.5 })).toBe('BPM: up to 95.5');
    expect(bpmFilterLabel({ bpmMin: 0 })).toBe('BPM: from 0');
  });

  it('name whether the Beats shown are used', () => {
    expect(useFilterLabel('used')).toBe('Used: Yes');
    expect(useFilterLabel('unused')).toBe('Used: No');
  });
});

describe('isBeatListFiltered', () => {
  it('is whether any filter is set, whatever the sort', () => {
    expect(isBeatListFiltered(defaultBeatListView)).toBe(false);
    expect(isBeatListFiltered({ ...defaultBeatListView, q: '  ', sort: { column: 'bpm', direction: 'asc' } })).toBe(
      false,
    );
    expect(isBeatListFiltered({ ...defaultBeatListView, bpmMin: 0 })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, use: 'unused' })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, q: 'x' })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, producers: ['Kato'] })).toBe(true);
    expect(isBeatListFiltered({ ...defaultBeatListView, keys: ['Am'] })).toBe(true);
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
