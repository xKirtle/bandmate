import { describe, expect, it } from 'vitest';
import { automaticName, backupName, backupSize, replaceConfirmation } from './backups';

// 18:30 on 4 Oct 2026, in the time zone the tests run in.
const made = new Date(2026, 9, 4, 18, 30).toISOString();

describe('backupName', () => {
  it('is the name of its own a Backup was given', () => {
    expect(backupName({ createdAt: made, songs: 3, name: 'Before the big rewrite' })).toBe('Before the big rewrite');
  });

  it('is the automatic one while it has none', () => {
    expect(backupName({ createdAt: made, songs: 3, name: '' })).toBe('4 Oct 2026 · 3 Songs');
  });
});

describe('automaticName', () => {
  it('names a Backup after the day it was made and how many Songs it holds', () => {
    expect(automaticName({ createdAt: made, songs: 3 })).toBe('4 Oct 2026 · 3 Songs');
  });

  it('says Song for one', () => {
    expect(automaticName({ createdAt: made, songs: 1 })).toBe('4 Oct 2026 · 1 Song');
  });

  it('names a Backup of every Song as one of that many Songs', () => {
    expect(automaticName({ createdAt: made, songs: 3, allSongs: true })).toBe('4 Oct 2026 · 3 Songs');
  });

  it('names a Backup of only the Beat Library after it', () => {
    expect(automaticName({ createdAt: made, songs: 0, beatLibrary: true })).toBe('4 Oct 2026 · Beat Library');
  });

  it('names a Backup of chosen Songs and the Beat Library after both', () => {
    expect(automaticName({ createdAt: made, songs: 2, beatLibrary: true })).toBe('4 Oct 2026 · 2 Songs + Beat Library');
  });

  it('names a Backup of every Song and the Beat Library Everything', () => {
    expect(automaticName({ createdAt: made, songs: 3, allSongs: true, beatLibrary: true })).toBe(
      '4 Oct 2026 · Everything',
    );
    expect(automaticName({ createdAt: made, songs: 0, allSongs: true, beatLibrary: true })).toBe(
      '4 Oct 2026 · Everything',
    );
  });

  it('gives every month its three-letter name', () => {
    const months = Array.from(
      { length: 12 },
      (_, m) => automaticName({ createdAt: new Date(2026, m, 15).toISOString(), songs: 2 }).split(' ')[1],
    );
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('takes the day where the Backup is shown, not where it was made', () => {
    // Just after midnight here can still be the day before in UTC.
    const justAfterMidnight = new Date(2026, 9, 5, 0, 10).toISOString();
    expect(automaticName({ createdAt: justAfterMidnight, songs: 2 })).toBe('5 Oct 2026 · 2 Songs');
  });
});

describe('backupSize', () => {
  it('gives a Backup under a megabyte in kilobytes, rounded up', () => {
    expect(backupSize(7828)).toBe('8 KB');
    expect(backupSize(1)).toBe('1 KB');
    expect(backupSize(1023 * 1024)).toBe('1023 KB');
  });

  it('gives a larger one in megabytes, as uploads are', () => {
    expect(backupSize(1 << 20)).toBe('1.0 MB');
    expect(backupSize(4.2 * (1 << 20))).toBe('4.2 MB');
    expect(backupSize(612 * (1 << 20))).toBe('612 MB');
  });
});

describe('replaceConfirmation', () => {
  it('names each Song and Beat to be replaced, as it is in Bandmate', () => {
    const song = { id: 4, title: 'Night Drive', inBandmate: { id: 7, title: 'Night Drive II' } };
    const beat = { id: 6, title: 'Used', inBandmate: { id: 2, title: 'Used Again' } };
    expect(replaceConfirmation([song], [beat])).toBe(
      'Replace 1 Song and 1 Beat with the Backup’s versions?\n\n' +
        'Song: Night Drive II\nBeat: Used Again\n\n' +
        'A Song replaced loses whatever it has now that the Backup’s version doesn’t. ' +
        'A Beat replaced takes the Backup’s title and credit in every Song using it. This can’t be undone.',
    );
  });

  it('says what replacing loses only for the kinds replaced', () => {
    const beat = { id: 6, title: 'Used', inBandmate: { id: 2, title: 'Used' } };
    expect(replaceConfirmation([], [beat]).split('\n\n')[2]).toBe(
      'A Beat replaced takes the Backup’s title and credit in every Song using it. This can’t be undone.',
    );
  });

  it('counts only what is replaced', () => {
    const songs = [1, 2].map((id) => ({ id, title: `S${id}`, inBandmate: { id, title: `S${id}` } }));
    expect(replaceConfirmation(songs, []).split('\n')[0]).toBe('Replace 2 Songs with the Backup’s versions?');
    expect(replaceConfirmation([], [songs[0]]).split('\n')[0]).toBe('Replace 1 Beat with the Backup’s version?');
  });
});
