import { describe as group, expect, it } from 'vitest';
import type { Clip, Take } from './api';
import type { ClipCommand, ClipCommandBlock, ClipCommandKind } from './clipCommands.svelte';
import {
  clipActions,
  selectionActions,
  type ClipMenuCommands,
  type ClipMenuState,
  type SelectionMenuState,
} from './clipMenu';

/** Every Clip command. */
const everyKind: ClipCommandKind[] = [
  'copy',
  'cut',
  'paste',
  'duplicate',
  'split',
  'delete',
  'merge',
  'tempo',
  'pitch',
  'gain',
  'chooseTake',
  'deleteTake',
  'nudgeTake',
  'clearInactiveTakes',
];

/**
 * Clip commands, faked: covering the Clips given, each command blocked as
 * `blocks` says, or else available, and each run written down, e.g.
 * "tempo selection 80".
 */
function fakeCommands(clips: Clip[], blocks: Partial<Record<ClipCommandKind, ClipCommandBlock>> = {}) {
  const ran: string[] = [];
  const commands: ClipMenuCommands = {
    clipsOf: () => clips,
    can: (kind) => blocks[kind] ?? null,
    run: (command: ClipCommand) => {
      const { kind, target, ...values } = command;
      const on = target.kind === 'selection' ? 'selection' : `clip ${target.clipId}`;
      ran.push([kind, on, ...Object.values(values)].join(' '));
      return Promise.resolve({ focus: null });
    },
  };
  return { commands, ran };
}

/** Every command blocked, as it is while frozen. */
const frozenBlocks = Object.fromEntries(everyKind.map((k) => [k, 'frozen' as const]));

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
    pitch: 0,
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
  const state: ClipMenuState = {
    canRecord: true,
    soundName: 'Riff',
    nudgeKeys: 'Alt+←/→',
    copyKeys: 'Ctrl+C',
    cutKeys: 'Ctrl+X',
    splitKeys: 'S',
    selected: 0,
    frozen: null,
  };
  const page = {
    retake: () => {},
    downloadTake: () => {},
    rename: () => {},
    downloadSound: () => {},
  };
  /** A Clip's menu, with every command available on it. */
  const menu = (c: Clip, s = state, blocks = {}) => clipActions(c, s, fakeCommands([c], blocks).commands, page);
  const labels = (c: Clip, s = state) => menu(c, s).map((a) => a.label);

  it('names its delete “Delete Clip”, whatever the Clip plays', () => {
    expect(labels(beatClip)).toEqual([
      'Rename',
      'Gain',
      'Tempo',
      'Pitch',
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
      'Pitch',
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
      'Pitch',
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
      'Pitch',
      'Copy',
      'Cut',
      'Duplicate',
      'Split at playhead',
      'Delete Clip',
    ]);
  });

  it('runs the Clip command each entry and choice names, on the Clip, and the page the rest', () => {
    const { commands, ran } = fakeCommands([twoTakes]);
    const entries = clipActions(twoTakes, state, commands, {
      retake: () => ran.push('retake'),
      downloadTake: (id) => ran.push(`download take ${id}`),
      rename: () => ran.push('rename'),
      downloadSound: (id) => ran.push(`download sound ${id}`),
    });
    for (const entry of entries) {
      if ('run' in entry) entry.run();
      else if ('choices' in entry) for (const choice of entry.choices) choice.run();
      else if ('field' in entry) entry.field.set(5);
    }
    expect(ran).toEqual([
      'retake',
      'chooseTake clip 1 10',
      'deleteTake clip 1 10',
      'deleteTake clip 1 11',
      'nudgeTake clip 1 11 5',
      'clearInactiveTakes clip 1',
      'download take 11',
      'rename',
      'gain clip 1 5',
      'tempo clip 1 5',
      'pitch clip 1 5',
      'copy clip 1',
      'cut clip 1',
      'duplicate clip 1',
      'split clip 1',
      'delete clip 1',
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
    const entry = clipActions(soundClip, state, fakeCommands([soundClip]).commands, {
      ...page,
      downloadSound: (id) => downloaded.push(id),
    }).find((a) => a.label === 'Download Sound')!;
    expect(entry.title).toBe('Save “Riff” as it was imported');
    if ('run' in entry) entry.run();
    expect(downloaded).toEqual([3]);
  });

  it('turns off every edit while recording, saying why, but still downloads', () => {
    const recording = { ...state, canRecord: false, frozen: 'recording' as const };
    const shown = [...menu(twoTakes, recording, frozenBlocks), ...menu(soundClip, recording, frozenBlocks)];
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
      ['Pitch', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Split at playhead', hint],
      ['Delete Clip', hint],
      ['Rename', hint],
      ['Gain', hint],
      ['Tempo', hint],
      ['Pitch', hint],
      ['Copy', hint],
      ['Cut', hint],
      ['Duplicate', hint],
      ['Split at playhead', hint],
      ['Delete Clip', hint],
    ]);
    expect(on).toEqual(['Download Take', 'Download Sound']);
  });

  it('names the keys that copy and cut, where there are keys to name', () => {
    expect(menu(beatClip)).toMatchObject([
      { label: 'Rename' },
      { label: 'Gain' },
      { label: 'Tempo' },
      { label: 'Pitch' },
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate' },
      { label: 'Split at playhead', title: 'Or S' },
      { label: 'Delete Clip' },
    ]);
    const noKeys = menu(beatClip, { ...state, copyKeys: null, cutKeys: null });
    expect(noKeys.filter((a) => a.label === 'Copy' || a.label === 'Cut').map((a) => a.title)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('takes an exact Gain in dB, from −36 to +36, starting at the Clip’s', () => {
    const entry = menu({ ...beatClip, gain: -4.5 }).find((a) => a.label === 'Gain')!;
    expect('field' in entry && entry.field).toMatchObject({ value: -4.5, unit: 'dB', min: -36, max: 36 });
  });

  it('takes an exact Tempo in percent, from 50% to 200%, starting at the Clip’s, with a reset to 100%', () => {
    const entry = menu({ ...beatClip, tempo: 0.92 }).find((a) => a.label === 'Tempo')!;
    expect('field' in entry && entry.field).toMatchObject({
      value: 92,
      unit: '%',
      min: 50,
      max: 200,
      reset: { value: 100, label: 'Reset to 100%' },
    });
  });

  it('takes an exact Pitch in whole semitones, from −12 to +12, starting at the Clip’s, with a reset to 0', () => {
    const entry = menu({ ...beatClip, pitch: -2 }).find((a) => a.label === 'Pitch')!;
    expect('field' in entry && entry.field).toMatchObject({
      value: -2,
      unit: 'st',
      step: 1,
      min: -12,
      max: 12,
      reset: { value: 0, label: 'Reset to 0 st', offered: true },
    });
  });

  it('offers each reset only while the Clip isn’t there already', () => {
    const field = (label: string) => {
      const entry = menu(beatClip).find((a) => a.label === label)!;
      return 'field' in entry ? entry.field : null;
    };
    expect(field('Tempo')?.reset?.offered).toBe(false);
    expect(field('Pitch')?.reset?.offered).toBe(false);
  });

  it('turns Retake off, saying why, while the Clip’s Pitch isn’t 0', () => {
    expect(menu({ ...oneTake, pitch: 2 }).find((a) => a.label === 'Retake')).toMatchObject({
      disabled: true,
      title: 'Set the Pitch back to 0 to retake this Clip',
    });
    expect(menu({ ...oneTake, tempo: 0.8, pitch: 2 }).find((a) => a.label === 'Retake')).toMatchObject({
      disabled: true,
      title: 'Set the Tempo back to 100% and the Pitch to 0 to retake this Clip',
    });
  });

  it('turns Retake off, saying why, while the Clip’s Tempo isn’t 100%', () => {
    expect(menu({ ...oneTake, tempo: 0.8 }).find((a) => a.label === 'Retake')).toMatchObject({
      disabled: true,
      title: 'Set the Tempo back to 100% to retake this Clip',
    });
  });

  it('leaves every entry on while not recording', () => {
    expect(menu(twoTakes).some((a) => a.disabled)).toBe(false);
  });

  it('turns Split at playhead off, saying why, while the playhead doesn’t cross the Clip', () => {
    const entry = menu(beatClip, state, { split: 'nothingToSplit' }).find((a) => a.label === 'Split at playhead');
    expect(entry).toMatchObject({ disabled: true, title: 'Move the playhead into the Clip to split it' });
    const noKeys = menu(beatClip, { ...state, splitKeys: null }).find((a) => a.label === 'Split at playhead');
    expect(noKeys?.title).toBeUndefined();
    expect(noKeys?.disabled).toBeFalsy();
  });
});

group('selectionActions', () => {
  const clip = (id: number, over: Partial<Clip> = {}): Clip => ({
    id,
    beatId: 1,
    soundId: null,
    name: null,
    gain: 0,
    tempo: 1,
    pitch: 0,
    fadeIn: 0,
    fadeOut: 0,
    takes: [],
    activeTakeId: null,
    start: id * 10,
    offset: 0,
    length: 4,
    ...over,
  });
  /** Clips 1 to `count`. */
  const clips = (count: number) => Array.from({ length: count }, (_, i) => clip(i + 1));
  const state: SelectionMenuState = { frozen: null, copyKeys: 'Ctrl+C', cutKeys: 'Ctrl+X', splitKeys: 'S' };
  /** Where the Clips selected can't be merged, as for one. */
  const noMerge = { merge: 'cantMerge' as const };
  /** The Selection menu of these Clips, opened on the first. */
  const menu = (selected: Clip[], s = state, blocks: Partial<Record<ClipCommandKind, ClipCommandBlock>> = noMerge) =>
    selectionActions(selected[0], s, fakeCommands(selected, blocks).commands);
  const labels = (count: number) => menu(clips(count)).map((a) => a.label);

  it('offers copying, cutting, duplicating, splitting and deleting every selected Clip, naming how many it duplicates and deletes', () => {
    expect(labels(3)).toEqual([
      'Tempo',
      'Pitch',
      'Copy',
      'Cut',
      'Duplicate 3 Clips',
      'Split at playhead',
      'Delete 3 Clips',
    ]);
  });

  it('names one Clip as one', () => {
    expect(labels(1)).toEqual([
      'Tempo',
      'Pitch',
      'Copy',
      'Cut',
      'Duplicate 1 Clip',
      'Split at playhead',
      'Delete 1 Clip',
    ]);
  });

  it('copies, cuts, duplicates, splits, merges or deletes them when picked', () => {
    const selected = clips(2);
    const { commands, ran } = fakeCommands(selected);
    for (const entry of selectionActions(selected[0], state, commands)) {
      if ('run' in entry) entry.run();
      else if ('field' in entry) entry.field.set(80);
    }
    expect(ran).toEqual([
      'tempo selection 80',
      'pitch selection 80',
      'copy selection',
      'cut selection',
      'duplicate selection',
      'split selection',
      'merge selection',
      'delete selection',
    ]);
  });

  it('offers merging them only where they can be merged', () => {
    expect(menu(clips(2), state, {}).map((a) => a.label)).toEqual([
      'Tempo',
      'Pitch',
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
    expect(menu(clips(2))).toMatchObject([
      { label: 'Tempo' },
      { label: 'Pitch' },
      { label: 'Copy', title: 'Or Ctrl+C' },
      { label: 'Cut', title: 'Or Ctrl+X' },
      { label: 'Duplicate 2 Clips' },
      { label: 'Split at playhead', title: 'Or S' },
      { label: 'Delete 2 Clips' },
    ]);
    const noKeys = menu(clips(2), { ...state, copyKeys: null, cutKeys: null, splitKeys: null });
    expect(noKeys.slice(2).map((a) => a.title)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('turns every entry off while recording, saying why', () => {
    const hint = 'Stop recording to edit';
    expect(menu(clips(2), { ...state, frozen: 'recording' }, { ...frozenBlocks, ...noMerge })).toMatchObject([
      { label: 'Tempo', disabled: true, title: hint },
      { label: 'Pitch', disabled: true, title: hint },
      { label: 'Copy', disabled: true, title: hint },
      { label: 'Cut', disabled: true, title: hint },
      { label: 'Duplicate 2 Clips', disabled: true, title: hint },
      { label: 'Split at playhead', disabled: true, title: hint },
      { label: 'Delete 2 Clips', disabled: true, title: hint },
    ]);
  });

  it('sets the Tempo of every one of them, starting at the Tempo of the Clip it opened on', () => {
    const entry = menu([clip(1, { tempo: 1.5 }), clip(2)]).find((a) => a.label === 'Tempo')!;
    expect('field' in entry && entry.field).toMatchObject({ value: 150, unit: '%', min: 50, max: 200 });
  });

  it('sets the Pitch of every one of them, starting at the Pitch of the Clip it opened on', () => {
    const entry = menu([clip(1, { pitch: 3 }), clip(2)]).find((a) => a.label === 'Pitch')!;
    expect('field' in entry && entry.field).toMatchObject({ value: 3, unit: 'st', min: -12, max: 12 });
  });

  it('offers each reset while any of them is changed, whichever Clip it opened on', () => {
    const resets = (second: Partial<Clip>) =>
      menu([clip(1), clip(2, second)]).flatMap((a) => ('field' in a ? [[a.label, a.field.reset?.offered]] : []));
    expect(resets({ tempo: 0.8 })).toEqual([
      ['Tempo', true],
      ['Pitch', false],
    ]);
    expect(resets({ pitch: -1 })).toEqual([
      ['Tempo', false],
      ['Pitch', true],
    ]);
  });

  it('turns Split at playhead off, saying why, while the playhead crosses none of them', () => {
    expect(menu(clips(2), state, { ...noMerge, split: 'nothingToSplit' })).toContainEqual(
      expect.objectContaining({
        label: 'Split at playhead',
        disabled: true,
        title: 'Move the playhead into a selected Clip to split it',
      }),
    );
  });

  it('turns every entry off while a Merge is being made, saying why', () => {
    const hint = 'Wait for the Merge to finish to edit';
    const shown = menu(clips(2), { ...state, frozen: 'merging' }, frozenBlocks);
    expect(shown.map((a) => a.label)).toContain('Merge');
    expect(shown.every((a) => a.disabled && a.title === hint)).toBe(true);
    expect(menu(clips(2), state, {}).some((a) => a.disabled)).toBe(false);
  });
});
