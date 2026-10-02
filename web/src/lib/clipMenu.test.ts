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
  const state = {
    canRecord: true,
    soundName: 'Riff',
    nudgeKeys: 'Alt+←/→',
    copyKeys: 'Ctrl+C',
    cutKeys: 'Ctrl+X',
    selected: 0,
    recording: false,
  };
  const run = {
    retake: () => {},
    chooseTake: () => {},
    deleteTake: () => {},
    nudgeTake: () => {},
    clearInactiveTakes: () => {},
    downloadTake: () => {},
    rename: () => {},
    copy: () => {},
    cut: () => {},
    duplicate: () => {},
    downloadSound: () => {},
    deleteClip: () => {},
  };
  const labels = (c: Clip, s = state) => clipActions(c, s, run).map((a) => a.label);

  it('names its delete “Delete Clip”, whatever the Clip plays', () => {
    expect(labels(beatClip)).toEqual(['Rename', 'Copy', 'Cut', 'Duplicate', 'Delete Clip']);
    expect(labels(soundClip)).toEqual(['Rename', 'Copy', 'Cut', 'Duplicate', 'Download Sound', 'Delete Clip']);
    expect(labels(oneTake).at(-1)).toBe('Delete Clip');
  });

  it('offers no Take choices on a Clip of one Take', () => {
    expect(labels(oneTake)).toEqual([
      'Retake',
      'Nudge',
      'Download Take',
      'Rename',
      'Copy',
      'Cut',
      'Duplicate',
      'Delete Clip',
    ]);
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
      'Copy',
      'Cut',
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
      copy: () => ran.push('copy'),
      cut: () => ran.push('cut'),
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
      'copy',
      'cut',
      'duplicate',
      'delete clip',
    ]);
  });

  it('offers no Retake while a Take couldn’t start', () => {
    expect(labels(oneTake)).toContain('Retake');
    expect(labels(oneTake, { ...state, canRecord: false })).not.toContain('Retake');
  });

  it('offers no Retake while several Clips are selected', () => {
    expect(labels(oneTake, { ...state, selected: 1 })).toContain('Retake');
    expect(labels(oneTake, { ...state, selected: 2 })).not.toContain('Retake');
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

  it('turns off every edit while recording, saying why, but still downloads', () => {
    const recording = { ...state, canRecord: false, recording: true };
    const shown = [...clipActions(twoTakes, recording, run), ...clipActions(soundClip, recording, run)];
    const off = shown.filter((a) => a.disabled).map((a) => [a.label, a.title]);
    const on = shown.filter((a) => !a.disabled).map((a) => a.label);
    const hint = 'Stop recording to edit';
    expect(off).toEqual([
      ['Takes', hint],
      ['Delete Take', hint],
      ['Nudge', hint],
      ['Clear inactive Takes', hint],
      ['Rename', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Delete Clip', hint],
      ['Rename', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Delete Clip', hint],
    ]);
    expect(on).toEqual(['Download Take', 'Download Sound']);
  });

  it('names the keys that copy and cut, where there are keys to name', () => {
    expect(clipActions(beatClip, state, run)).toMatchObject([
      { label: 'Rename' },
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate' },
      { label: 'Delete Clip' },
    ]);
    const noKeys = clipActions(beatClip, { ...state, copyKeys: null, cutKeys: null }, run);
    expect(noKeys.filter((a) => a.label === 'Copy' || a.label === 'Cut').map((a) => a.title)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('leaves every entry on while not recording', () => {
    expect(clipActions(twoTakes, state, run).some((a) => a.disabled)).toBe(false);
  });
});

group('selectionActions', () => {
  const run = { copyClips: () => {}, cutClips: () => {}, duplicateClips: () => {}, deleteClips: () => {} };
  const state = { recording: false, copyKeys: 'Ctrl+C', cutKeys: 'Ctrl+X' };
  const labels = (count: number) => selectionActions(count, run, state).map((a) => a.label);

  it('offers copying, cutting, duplicating and deleting every selected Clip, naming how many', () => {
    expect(labels(3)).toEqual(['Copy', 'Cut', 'Duplicate 3 Clips', 'Delete 3 Clips']);
  });

  it('names one Clip as one', () => {
    expect(labels(1)).toEqual(['Copy', 'Cut', 'Duplicate 1 Clip', 'Delete 1 Clip']);
  });

  it('copies, cuts, duplicates or deletes them when picked', () => {
    const picked: string[] = [];
    const entries = selectionActions(
      2,
      {
        copyClips: () => picked.push('copy'),
        cutClips: () => picked.push('cut'),
        duplicateClips: () => picked.push('duplicate'),
        deleteClips: () => picked.push('delete'),
      },
      state,
    );
    for (const entry of entries) if ('run' in entry) entry.run();
    expect(picked).toEqual(['copy', 'cut', 'duplicate', 'delete']);
  });

  it('names the keys that copy and cut, where there are keys to name', () => {
    expect(selectionActions(2, run, state)).toMatchObject([
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate 2 Clips' },
      { label: 'Delete 2 Clips' },
    ]);
    const noKeys = selectionActions(2, run, { ...state, copyKeys: null, cutKeys: null });
    expect(noKeys.map((a) => a.title)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('turns every entry off while recording, saying why', () => {
    const hint = 'Stop recording to edit';
    expect(selectionActions(2, run, { ...state, recording: true })).toMatchObject([
      { label: 'Copy', disabled: true, title: hint },
      { label: 'Cut', disabled: true, title: hint },
      { label: 'Duplicate 2 Clips', disabled: true, title: hint },
      { label: 'Delete 2 Clips', disabled: true, title: hint },
    ]);
    expect(selectionActions(2, run, state).some((a) => a.disabled)).toBe(false);
  });
});
