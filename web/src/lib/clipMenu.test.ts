import { describe as group, expect, it } from 'vitest';
import type { Clip, Take } from './api';
import { clipActions } from './clipMenu';

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
  const state = { canRecord: true, soundTitle: 'Riff', nudgeKeys: 'Alt+←/→' };
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
  const labels = (c: Clip) => clipActions(c, state, run).map((a) => a.label);

  it('labels a Beat Clip’s delete Delete Clip', () => {
    expect(labels(beatClip)).toEqual(['Rename', 'Duplicate', 'Delete Clip']);
  });

  it('labels a Sound Clip’s delete Delete Clip', () => {
    expect(labels(soundClip)).toEqual(['Rename', 'Duplicate', 'Download Sound', 'Delete Clip']);
  });

  it('offers a Clip with one Take no Takes, Delete Take or Clear inactive Takes', () => {
    expect(labels(oneTake)).toEqual(['Retake', 'Nudge', 'Download Take', 'Rename', 'Duplicate', 'Delete Clip']);
  });

  it('offers a Clip with two Takes Takes, Delete Take and Clear inactive Takes', () => {
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
      nudgeTake: (ms) => ran.push(`nudge ${ms}`),
      clearInactiveTakes: () => ran.push('clear'),
      downloadTake: () => ran.push('download take'),
      rename: () => ran.push('rename'),
      duplicate: () => ran.push('duplicate'),
      downloadSound: () => ran.push('download sound'),
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
      'nudge 5',
      'clear',
      'download take',
      'rename',
      'duplicate',
      'delete clip',
    ]);
  });

  it('offers no Retake while a Take couldn’t start', () => {
    expect(labels(oneTake)).toContain('Retake');
    expect(clipActions(oneTake, { ...state, canRecord: false }, run).map((a) => a.label)).not.toContain('Retake');
  });
});
