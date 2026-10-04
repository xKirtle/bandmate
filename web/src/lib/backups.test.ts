import { describe, expect, it } from 'vitest';
import {
  automaticName,
  backupName,
  backupSize,
  beatsBrought,
  broughtNote,
  newBackup,
  replaceConfirmation,
  restoredName,
  restorePicks,
} from './backups';

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

  it('counts every Beat a Backup holds without the Beat Library, with those its Songs bring', () => {
    expect(automaticName({ createdAt: made, songs: 2, beats: 4 })).toBe('4 Oct 2026 · 2 Songs + 4 Beats');
    expect(automaticName({ createdAt: made, songs: 3, allSongs: true, beats: 1 })).toBe(
      '4 Oct 2026 · 3 Songs + 1 Beat',
    );
    expect(automaticName({ createdAt: made, songs: 0, beats: 5 })).toBe('4 Oct 2026 · 5 Beats');
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
        'A Beat replaced takes the Backup’s title, credit, BPM, Key and Notes in every Song using it, and keeps its audio. ' +
        'This can’t be undone.',
    );
  });

  it('says what replacing loses only for the kinds replaced', () => {
    const beat = { id: 6, title: 'Used', inBandmate: { id: 2, title: 'Used' } };
    expect(replaceConfirmation([], [beat]).split('\n\n')[2]).toBe(
      'A Beat replaced takes the Backup’s title, credit, BPM, Key and Notes in every Song using it, and keeps its audio. ' +
        'This can’t be undone.',
    );
  });

  it('counts only what is replaced', () => {
    const songs = [1, 2].map((id) => ({ id, title: `S${id}`, inBandmate: { id, title: `S${id}` } }));
    expect(replaceConfirmation(songs, []).split('\n')[0]).toBe('Replace 2 Songs with the Backup’s versions?');
    expect(replaceConfirmation([], [songs[0]]).split('\n')[0]).toBe('Replace 1 Beat with the Backup’s version?');
  });
});

describe('restoredName', () => {
  it('names the Songs restored, and the Beats only when there were any', () => {
    expect(restoredName(2, 0)).toBe('2 Songs');
    expect(restoredName(1, 1)).toBe('1 Song and 1 Beat');
    expect(restoredName(0, 14)).toBe('14 Beats');
    expect(restoredName(3, 2)).toBe('3 Songs and 2 Beats');
  });
});

describe('beatsBrought', () => {
  const beats = [
    { id: 10, songs: [{ id: 1 }] },
    { id: 11, songs: [{ id: 1 }, { id: 2 }] },
    { id: 12, songs: [] },
  ];

  it('is the Beats the picked Songs use', () => {
    expect(beatsBrought([2], beats)).toEqual(new Set([11]));
    expect(beatsBrought([1, 3], beats)).toEqual(new Set([10, 11]));
    expect(beatsBrought([], beats)).toEqual(new Set());
  });
});

describe('broughtNote', () => {
  it('says how many Beats the picked Songs bring', () => {
    expect(broughtNote(3, 3)).toBe('Brings the 3 Beats they use');
    expect(broughtNote(2, 1)).toBe('Brings the 1 Beat they use');
    expect(broughtNote(1, 2)).toBe('Brings the 2 Beats it uses');
    expect(broughtNote(1, 0)).toBe('Brings no Beats');
  });
});

describe('newBackup', () => {
  // Song 1 uses Beats 10 and 11, Song 2 uses 11, Song 3 none; 12 and 13 no Song.
  const there = {
    songIds: [1, 2, 3],
    beats: [
      { id: 10, songs: [{ id: 1 }] },
      { id: 11, songs: [{ id: 1 }, { id: 2 }] },
      { id: 12, songs: [] },
      { id: 13, songs: [] },
    ],
  };
  const everySong = new Set(there.songIds);
  const everyBeat = new Set([10, 11, 12, 13]);
  const opened = { songsTicked: true, picked: everySong, beatsTicked: true, pickedBeats: everyBeat };

  it('is Everything with every Song and every Beat, as the dialog opens', () => {
    expect(newBackup(opened, there)).toEqual({
      contents: { allSongs: true, beatLibrary: true },
      name: 'Everything',
    });
  });

  it('is Everything whether the Songs and Beats were ticked one by one or left at the default', () => {
    expect(newBackup({ ...opened, picked: new Set([3, 1, 2]), pickedBeats: new Set([13, 12, 11, 10]) }, there)).toEqual(
      { contents: { allSongs: true, beatLibrary: true }, name: 'Everything' },
    );
  });

  it('asks for the Songs picked when only some are', () => {
    expect(newBackup({ ...opened, picked: new Set([2]) }, there)).toEqual({
      contents: { songs: [2], beatLibrary: true },
      name: '1 Song + Beat Library',
    });
  });

  it('asks for the Beats picked when only some are, counting those the Songs bring', () => {
    expect(newBackup({ ...opened, picked: new Set([2]), pickedBeats: new Set([12]) }, there)).toEqual({
      contents: { songs: [2], beats: [11, 12] },
      name: '1 Song + 2 Beats',
    });
  });

  it('asks for chosen Beats alone while Songs is unticked', () => {
    expect(newBackup({ ...opened, songsTicked: false, pickedBeats: new Set([10, 13]) }, there)).toEqual({
      contents: { songs: [], beats: [10, 13] },
      name: '2 Beats',
    });
  });

  it('is the Beat Library when every Beat is ticked, some because the picked Songs use them', () => {
    expect(newBackup({ ...opened, picked: new Set([1]), pickedBeats: new Set([12, 13]) }, there)).toEqual({
      contents: { songs: [1], beatLibrary: true },
      name: '1 Song + Beat Library',
    });
  });

  it('counts the Beats the picked Songs bring while the Beat Library is unticked', () => {
    expect(newBackup({ ...opened, beatsTicked: false }, there)).toEqual({
      contents: { allSongs: true, beats: [] },
      name: '3 Songs + 2 Beats',
    });
    expect(newBackup({ ...opened, picked: new Set([3]), beatsTicked: false }, there)).toEqual({
      contents: { songs: [3], beats: [] },
      name: '1 Song',
    });
  });

  it('leaves the Song picks out while Songs is unticked', () => {
    expect(newBackup({ ...opened, songsTicked: false, picked: new Set([1]) }, there)).toEqual({
      contents: { songs: [], beatLibrary: true },
      name: 'Beat Library',
    });
  });

  it('says what is missing when nothing is ticked, naming only what can be', () => {
    const none = { ...opened, songsTicked: false, beatsTicked: false };
    expect(newBackup(none, there)).toEqual({ missing: 'Tick Songs or the Beat Library.' });
    expect(newBackup(none, { ...there, beats: [] })).toEqual({ missing: 'Tick Songs.' });
    expect(newBackup(none, { ...there, songIds: [] })).toEqual({ missing: 'Tick the Beat Library.' });
  });

  it('says what is missing when Songs is ticked with none picked, even with the Beat Library', () => {
    expect(newBackup({ ...opened, picked: new Set() }, there)).toEqual({ missing: 'Pick a Song, or untick Songs.' });
    expect(newBackup({ ...opened, picked: new Set(), beatsTicked: false }, there)).toEqual({ missing: 'Pick a Song.' });
  });

  it('says what is missing when the Beat Library is ticked with no Beat picked', () => {
    expect(newBackup({ ...opened, picked: new Set([3]), pickedBeats: new Set() }, there)).toEqual({
      missing: 'Pick a Beat, or untick the Beat Library.',
    });
    expect(newBackup({ ...opened, songsTicked: false, pickedBeats: new Set() }, there)).toEqual({
      missing: 'Pick a Beat.',
    });
  });

  it('takes a Beat the picked Songs use as picked, even with none of your own', () => {
    expect(newBackup({ ...opened, picked: new Set([2]), pickedBeats: new Set() }, there)).toEqual({
      contents: { songs: [2], beats: [11] },
      name: '1 Song + 1 Beat',
    });
  });
});

describe('restorePicks', () => {
  // Song 1 uses Beats 10 and 11, Song 2 uses 11, Song 3 none; 12 and 13 no Song.
  const held = {
    songIds: [1, 2, 3],
    beats: [
      { id: 10, songs: [{ id: 1 }] },
      { id: 11, songs: [{ id: 1 }, { id: 2 }] },
      { id: 12, songs: [] },
      { id: 13, songs: [] },
    ],
    beatLibrary: true,
  };
  const opened = {
    songsTicked: true,
    picked: new Set(held.songIds),
    beatsTicked: true,
    pickedBeats: new Set([10, 11, 12, 13]),
  };

  it('is everything the Backup holds as the dialog opens', () => {
    expect(restorePicks(opened, held)).toEqual({
      picks: { songs: [1, 2, 3], beats: [10, 11, 12, 13] },
      name: 'Everything',
    });
  });

  it('names every Beat of a Backup of chosen Beats by how many there are', () => {
    expect(restorePicks(opened, { ...held, beatLibrary: false })).toEqual({
      picks: { songs: [1, 2, 3], beats: [10, 11, 12, 13] },
      name: '3 Songs + 4 Beats',
    });
  });

  it('asks for the Songs and Beats picked, with those the picked Songs use', () => {
    expect(restorePicks({ ...opened, picked: new Set([2]), pickedBeats: new Set([12]) }, held)).toEqual({
      picks: { songs: [2], beats: [11, 12] },
      name: '1 Song + 2 Beats',
    });
  });

  it('takes a Beat the picked Songs use as picked, even with none of your own', () => {
    expect(restorePicks({ ...opened, picked: new Set([1]), pickedBeats: new Set() }, held)).toEqual({
      picks: { songs: [1], beats: [10, 11] },
      name: '1 Song + 2 Beats',
    });
  });

  it('picks no Beats of your own while the Beat Library is unticked, counting those the Songs bring', () => {
    expect(restorePicks({ ...opened, beatsTicked: false }, held)).toEqual({
      picks: { songs: [1, 2, 3], beats: [] },
      name: '3 Songs + 2 Beats',
    });
  });

  it('picks no Songs while Songs is unticked', () => {
    expect(restorePicks({ ...opened, songsTicked: false, pickedBeats: new Set([12, 13]) }, held)).toEqual({
      picks: { songs: [], beats: [12, 13] },
      name: '2 Beats',
    });
  });

  it('says what is missing when nothing is ticked, or a ticked section has nothing picked', () => {
    expect(restorePicks({ ...opened, songsTicked: false, beatsTicked: false }, held)).toEqual({
      missing: 'Tick Songs or the Beat Library.',
    });
    expect(restorePicks({ ...opened, picked: new Set() }, held)).toEqual({ missing: 'Pick a Song, or untick Songs.' });
    expect(restorePicks({ ...opened, picked: new Set([3]), pickedBeats: new Set() }, held)).toEqual({
      missing: 'Pick a Beat, or untick the Beat Library.',
    });
  });
});
