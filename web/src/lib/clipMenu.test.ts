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
    gain: 0,
    tempo: 1,
    fadeIn: 0,
    fadeOut: 0,
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
    canSplit: true,
    splitKeys: 'S',
    selected: 0,
    frozen: null,
  };
  const run = {
    retake: () => {},
    chooseTake: () => {},
    deleteTake: () => {},
    nudgeTake: () => {},
    clearInactiveTakes: () => {},
    downloadTake: () => {},
    rename: () => {},
    setGain: () => {},
    setTempo: () => {},
    copy: () => {},
    cut: () => {},
    duplicate: () => {},
    split: () => {},
    downloadSound: () => {},
    deleteClip: () => {},
  };
  const labels = (c: Clip, s = state) => clipActions(c, s, run).map((a) => a.label);

  it('names its delete “Delete Clip”, whatever the Clip plays', () => {
    expect(labels(beatClip)).toEqual([
      'Rename',
      'Gain',
      'Tempo',
      'Copy',
      'Cut',
      'Duplicate',
      'Split at playhead',
      'Delete Clip',
    ]);
    expect(labels(soundClip)).toEqual([
      'Rename',
      'Gain',
      'Tempo',
      'Copy',
      'Cut',
      'Duplicate',
      'Split at playhead',
      'Download Sound',
      'Delete Clip',
    ]);
    expect(labels(oneTake).at(-1)).toBe('Delete Clip');
  });

  it('offers no Take choices on a Clip of one Take', () => {
    expect(labels(oneTake)).toEqual([
      'Retake',
      'Nudge',
      'Download Take',
      'Rename',
      'Gain',
      'Tempo',
      'Copy',
      'Cut',
      'Duplicate',
      'Split at playhead',
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
      'Gain',
      'Tempo',
      'Copy',
      'Cut',
      'Duplicate',
      'Split at playhead',
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
      setGain: (dB) => ran.push(`gain ${dB}`),
      setTempo: (percent) => ran.push(`tempo ${percent}`),
      copy: () => ran.push('copy'),
      cut: () => ran.push('cut'),
      duplicate: () => ran.push('duplicate'),
      split: () => ran.push('split'),
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
      'gain 5',
      'tempo 5',
      'copy',
      'cut',
      'duplicate',
      'split',
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
    const recording = { ...state, canRecord: false, frozen: 'recording' as const };
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
      ['Gain', hint],
      ['Tempo', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Split at playhead', hint],
      ['Delete Clip', hint],
      ['Rename', hint],
      ['Gain', hint],
      ['Tempo', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Split at playhead', hint],
      ['Delete Clip', hint],
    ]);
    expect(on).toEqual(['Download Take', 'Download Sound']);
  });

  it('names the keys that copy and cut, where there are keys to name', () => {
    expect(clipActions(beatClip, state, run)).toMatchObject([
      { label: 'Rename' },
      { label: 'Gain' },
      { label: 'Tempo' },
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate' },
      { label: 'Split at playhead', title: 'Or S' },
      { label: 'Delete Clip' },
    ]);
    const noKeys = clipActions(beatClip, { ...state, copyKeys: null, cutKeys: null }, run);
    expect(noKeys.filter((a) => a.label === 'Copy' || a.label === 'Cut').map((a) => a.title)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('takes an exact Gain in dB, from −36 to +36, starting at the Clip’s', () => {
    const entry = clipActions({ ...beatClip, gain: -4.5 }, state, run).find((a) => a.label === 'Gain')!;
    expect('field' in entry && entry.field).toMatchObject({ value: -4.5, unit: 'dB', min: -36, max: 36 });
  });

  it('takes an exact Tempo in percent, from 50% to 200%, starting at the Clip’s, with a reset to 100%', () => {
    const entry = clipActions({ ...beatClip, tempo: 0.92 }, state, run).find((a) => a.label === 'Tempo')!;
    expect('field' in entry && entry.field).toMatchObject({
      value: 92,
      unit: '%',
      min: 50,
      max: 200,
      reset: { value: 100, label: 'Reset to 100%' },
    });
  });

  it('turns Retake off, saying why, while the Clip’s Tempo isn’t 100%', () => {
    expect(clipActions({ ...oneTake, tempo: 0.8 }, state, run).find((a) => a.label === 'Retake')).toMatchObject({
      disabled: true,
      title: 'Set the Tempo back to 100% to retake this Clip',
    });
  });

  it('leaves every entry on while not recording', () => {
    expect(clipActions(twoTakes, state, run).some((a) => a.disabled)).toBe(false);
  });

  it('turns Split at playhead off, saying why, while the playhead doesn’t cross the Clip', () => {
    const entry = clipActions(beatClip, { ...state, canSplit: false }, run).find(
      (a) => a.label === 'Split at playhead',
    );
    expect(entry).toMatchObject({ disabled: true, title: 'Move the playhead into the Clip to split it' });
    const noKeys = clipActions(beatClip, { ...state, splitKeys: null }, run).find(
      (a) => a.label === 'Split at playhead',
    );
    expect(noKeys?.title).toBeUndefined();
    expect(noKeys?.disabled).toBeFalsy();
  });
});

group('selectionActions', () => {
  const run = {
    copyClips: () => {},
    cutClips: () => {},
    duplicateClips: () => {},
    splitClips: () => {},
    mergeClips: () => {},
    deleteClips: () => {},
    setTempo: () => {},
  };
  const state = {
    tempo: 1,
    frozen: null,
    copyKeys: 'Ctrl+C',
    cutKeys: 'Ctrl+X',
    canMerge: false,
    canSplit: true,
    splitKeys: 'S',
  };
  const labels = (count: number) => selectionActions(count, run, state).map((a) => a.label);

  it('offers copying, cutting, duplicating, splitting and deleting every selected Clip, naming how many it duplicates and deletes', () => {
    expect(labels(3)).toEqual(['Tempo', 'Copy', 'Cut', 'Duplicate 3 Clips', 'Split at playhead', 'Delete 3 Clips']);
  });

  it('names one Clip as one', () => {
    expect(labels(1)).toEqual(['Tempo', 'Copy', 'Cut', 'Duplicate 1 Clip', 'Split at playhead', 'Delete 1 Clip']);
  });

  it('copies, cuts, duplicates, splits, merges or deletes them when picked', () => {
    const picked: string[] = [];
    const entries = selectionActions(
      2,
      {
        copyClips: () => picked.push('copy'),
        cutClips: () => picked.push('cut'),
        duplicateClips: () => picked.push('duplicate'),
        splitClips: () => picked.push('split'),
        mergeClips: () => picked.push('merge'),
        deleteClips: () => picked.push('delete'),
        setTempo: (percent) => picked.push(`tempo ${percent}`),
      },
      { ...state, canMerge: true },
    );
    for (const entry of entries) {
      if ('run' in entry) entry.run();
      else if ('field' in entry) entry.field.set(80);
    }
    expect(picked).toEqual(['tempo 80', 'copy', 'cut', 'duplicate', 'split', 'merge', 'delete']);
  });

  it('offers merging them only where they can be merged', () => {
    expect(selectionActions(2, run, { ...state, canMerge: true }).map((a) => a.label)).toEqual([
      'Tempo',
      'Copy',
      'Cut',
      'Duplicate 2 Clips',
      'Split at playhead',
      'Merge',
      'Delete 2 Clips',
    ]);
    expect(labels(2)).not.toContain('Merge');
  });

  it('names the keys that copy and cut, where there are keys to name', () => {
    expect(selectionActions(2, run, state)).toMatchObject([
      { label: 'Tempo' },
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate 2 Clips' },
      { label: 'Split at playhead', title: 'Or S' },
      { label: 'Delete 2 Clips' },
    ]);
    const noKeys = selectionActions(2, run, { ...state, copyKeys: null, cutKeys: null, splitKeys: null });
    expect(noKeys.slice(1).map((a) => a.title)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('turns every entry off while recording, saying why', () => {
    const hint = 'Stop recording to edit';
    expect(selectionActions(2, run, { ...state, frozen: 'recording' })).toMatchObject([
      { label: 'Tempo', disabled: true, title: hint },
      { label: 'Copy', disabled: true, title: hint },
      { label: 'Cut', disabled: true, title: hint },
      { label: 'Duplicate 2 Clips', disabled: true, title: hint },
      { label: 'Split at playhead', disabled: true, title: hint },
      { label: 'Delete 2 Clips', disabled: true, title: hint },
    ]);
  });

  it('sets the Tempo of every one of them, starting at the Tempo of the Clip it opened on', () => {
    const entry = selectionActions(2, run, { ...state, tempo: 1.5 }).find((a) => a.label === 'Tempo')!;
    expect('field' in entry && entry.field).toMatchObject({ value: 150, unit: '%', min: 50, max: 200 });
  });

  it('turns Split at playhead off, saying why, while the playhead crosses none of them', () => {
    expect(selectionActions(2, run, { ...state, canSplit: false })).toContainEqual(
      expect.objectContaining({
        label: 'Split at playhead',
        disabled: true,
        title: 'Move the playhead into a selected Clip to split it',
      }),
    );
  });

  it('turns every entry off while a Merge is being made, saying why', () => {
    const hint = 'Wait for the Merge to finish to edit';
    const shown = selectionActions(2, run, { ...state, canMerge: true, frozen: 'merging' });
    expect(shown.every((a) => a.disabled && a.title === hint)).toBe(true);
    expect(selectionActions(2, run, state).some((a) => a.disabled)).toBe(false);
  });
});
