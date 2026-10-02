import { describe as group, expect, it } from 'vitest';
import type { Clip, Take } from './api';
import { clipActions, selectionActions } from './clipMenu';

group('clipActions', () => {
  const take = (id: number, number: number): Take => ({
    id,
    number,
    size: 0,
    duration: 4,
    sampleRate: 48000,
    latencyOffset: 0,
    position: 0,
    nudge: 0,
    recordedAt: '',
  });
  const clip = (over: Partial<Clip>): Clip => ({
    id: 1,
    beatId: null,
    soundId: null,
    name: null,
    takes: [],
    activeTakeId: null,
    start: 0,
    offset: 0,
    length: 4,
    ...over,
  });
  const beatClip = clip({ beatId: 7 });
  const soundClip = clip({ soundId: 3 });
  const oneTake = clip({ takes: [take(10, 1)], activeTakeId: 10 });
  const twoTakes = clip({ takes: [take(10, 1), take(11, 2)], activeTakeId: 11 });
  const state = { canRecord: true, soundName: 'Riff', nudgeKeys: 'Alt+←/→' };
  const run = {
    retake: () => {},
    chooseTake: () => {},
    deleteTake: () => {},
    nudgeTake: () => {},
    clearInactiveTakes: () => {},
    downloadTake: () => {},
    rename: () => {},
    duplicate: () => {},
    downloadSound: () => {},
    deleteClip: () => {},
  };
  const labels = (c: Clip, s = state) => clipActions(c, s, run).map((a) => a.label);

  it('names its delete “Delete Clip”, whatever the Clip plays', () => {
    expect(labels(beatClip)).toEqual(['Rename', 'Duplicate', 'Delete Clip']);
    expect(labels(soundClip)).toEqual(['Rename', 'Duplicate', 'Download Sound', 'Delete Clip']);
    expect(labels(oneTake).at(-1)).toBe('Delete Clip');
  });

  it('offers no Take choices on a Clip of one Take', () => {
    expect(labels(oneTake)).toEqual(['Retake', 'Nudge', 'Download Take', 'Rename', 'Duplicate', 'Delete Clip']);
  });

  it('offers Takes, Delete Take and Clear inactive Takes on a Clip of several Takes', () => {
    expect(labels(twoTakes)).toEqual([
      'Retake',
      'Takes',
      'Delete Take',
      'Nudge',
      'Clear inactive Takes',
      'Download Take',
      'Rename',
      'Duplicate',
      'Delete Clip',
    ]);
  });

  it('runs what each entry and choice names', () => {
    const ran: string[] = [];
    const entries = clipActions(twoTakes, state, {
      retake: () => ran.push('retake'),
      chooseTake: (id) => ran.push(`choose ${id}`),
      deleteTake: (id) => ran.push(`delete take ${id}`),
      nudgeTake: (id, ms) => ran.push(`nudge ${id} ${ms}`),
      clearInactiveTakes: () => ran.push('clear'),
      downloadTake: (id) => ran.push(`download take ${id}`),
      rename: () => ran.push('rename'),
      duplicate: () => ran.push('duplicate'),
      downloadSound: (id) => ran.push(`download sound ${id}`),
      deleteClip: () => ran.push('delete clip'),
    });
    for (const entry of entries) {
      if ('run' in entry) entry.run();
      else if ('choices' in entry) for (const choice of entry.choices) choice.run();
      else entry.field.set(5);
    }
    expect(ran).toEqual([
      'retake',
      'choose 10',
      'delete take 10',
      'delete take 11',
      'nudge 11 5',
      'clear',
      'download take 11',
      'rename',
      'duplicate',
      'delete clip',
    ]);
  });

  it('offers no Retake while a Take couldn’t start', () => {
    expect(labels(oneTake)).toContain('Retake');
    expect(labels(oneTake, { ...state, canRecord: false })).not.toContain('Retake');
  });

  it('downloads the Sound a Clip of a Sound plays, named in its title', () => {
    const downloaded: number[] = [];
    const entry = clipActions(soundClip, state, { ...run, downloadSound: (id) => downloaded.push(id) }).find(
      (a) => a.label === 'Download Sound',
    )!;
    expect(entry.title).toBe('Save “Riff” as it was imported');
    if ('run' in entry) entry.run();
    expect(downloaded).toEqual([3]);
  });
});

group('selectionActions', () => {
  it('offers deleting every selected Clip, naming how many', () => {
    expect(selectionActions(3, { deleteClips: () => {} }).map((a) => a.label)).toEqual(['Delete 3 Clips']);
  });

  it('names one Clip as one, e.g. when the other is being retaken', () => {
    expect(selectionActions(1, { deleteClips: () => {} }).map((a) => a.label)).toEqual(['Delete 1 Clip']);
  });

  it('deletes them when picked', () => {
    let deleted = 0;
    const [entry] = selectionActions(2, { deleteClips: () => deleted++ });
    if ('run' in entry) entry.run();
    expect(deleted).toBe(1);
  });
});
