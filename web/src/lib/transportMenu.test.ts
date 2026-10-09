import { describe as group, expect, it } from 'vitest';
import { foldCount, foldedActions, transportActions } from './transportMenu';

group('transportActions', () => {
  const idle = {
    fullTimeline: true,
    importing: false,
    recording: false,
    merging: false,
    chosenTrack: 'Vocals',
    hasClips: true,
    undo: { can: true, title: 'Undo (Ctrl+Z)' },
    redo: { can: false, title: 'Redo (Ctrl+Shift+Z)' },
  };
  const run = { importAudio: () => {}, mixDown: () => {}, recordFrom: () => {}, undo: () => {}, redo: () => {} };
  const shown = (state: typeof idle) =>
    transportActions(state, run).map(({ label, disabled }) => ({ label, disabled: disabled ?? false }));

  it('offers Import audio…, Mix down…, Record from…, Undo and Redo on the full Timeline, in the order they fold', () => {
    expect(shown(idle)).toEqual([
      { label: 'Import audio…', disabled: false },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
      { label: 'Undo', disabled: false },
      { label: 'Redo', disabled: true },
    ]);
  });

  it('disables Undo and Redo while there is nothing to undo or redo, saying what each says', () => {
    const [, , , undo, redo] = transportActions(
      { ...idle, undo: { can: false, title: 'Wait' }, redo: { can: true, title: 'Redo now' } },
      run,
    );
    expect(undo).toMatchObject({ label: 'Undo', disabled: true, title: 'Wait' });
    expect(redo).toMatchObject({ label: 'Redo', disabled: false, title: 'Redo now' });
  });

  it('says Record from… picks the Input recorded from', () => {
    expect(transportActions(idle, run)[2].title).toBe('Pick the Input to record from');
  });

  it('says which Track Import audio… imports onto', () => {
    expect(transportActions(idle, run)[0].title).toBe('Import an audio file as a Sound onto Vocals');
  });

  it('runs what each entry names', () => {
    const ran: string[] = [];
    const entries = transportActions(idle, {
      importAudio: () => ran.push('import'),
      mixDown: () => ran.push('mix'),
      recordFrom: () => ran.push('mic'),
      undo: () => ran.push('undo'),
      redo: () => ran.push('redo'),
    });
    for (const entry of entries) if ('run' in entry) entry.run();
    expect(ran).toEqual(['import', 'mix', 'mic', 'undo', 'redo']);
  });

  it('disables Import audio… while importing', () => {
    expect(shown({ ...idle, importing: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
      { label: 'Undo', disabled: false },
      { label: 'Redo', disabled: true },
    ]);
  });

  it('disables Import audio… while a Merge is being made, saying why', () => {
    expect(shown({ ...idle, merging: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
      { label: 'Undo', disabled: false },
      { label: 'Redo', disabled: true },
    ]);
    expect(transportActions({ ...idle, merging: true }, run)[0].title).toBe(
      'Wait for the Merge to finish to import audio',
    );
  });

  it('disables Import audio…, Mix down… and Record from… while recording', () => {
    expect(shown({ ...idle, recording: true }).slice(0, 3)).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: true },
      { label: 'Record from…', disabled: true },
    ]);
  });

  it('says to stop recording on each while recording', () => {
    expect(
      transportActions({ ...idle, recording: true }, run)
        .slice(0, 3)
        .map((a) => a.title),
    ).toEqual([
      'Stop recording to import audio',
      'Stop recording to mix down',
      'Stop recording to pick the Input to record from',
    ]);
  });

  it('disables Mix down… while the Timeline has no Clips, saying why', () => {
    const mixDown = transportActions({ ...idle, hasClips: false }, run)[1];
    expect(mixDown).toMatchObject({ label: 'Mix down…', disabled: true });
    expect(mixDown.title).toBe('Add a Beat, Sound or Take to mix down');
  });

  it('offers only Mix down… where the Timeline is transport-only', () => {
    expect(shown({ ...idle, fullTimeline: false })).toEqual([{ label: 'Mix down…', disabled: false }]);
    expect(shown({ ...idle, fullTimeline: false, hasClips: false })).toEqual([{ label: 'Mix down…', disabled: true }]);
  });
});

group('foldedActions', () => {
  const state = {
    fullTimeline: true,
    importing: false,
    recording: false,
    merging: false,
    chosenTrack: 'Vocals',
    hasClips: true,
    undo: { can: true, title: 'Undo' },
    redo: { can: true, title: 'Redo' },
  };
  const all = transportActions(state, {
    importAudio: () => {},
    mixDown: () => {},
    recordFrom: () => {},
    undo: () => {},
    redo: () => {},
  });
  const folded = (room: number) => foldedActions(all, room, 50).map((a) => a.label);

  it('folds Import audio… first and Redo last, as foldCount does', () => {
    expect(folded(250)).toEqual([]);
    expect(folded(200)).toEqual(['Import audio…', 'Mix down…']);
    expect(folded(150)).toEqual(['Import audio…', 'Mix down…', 'Record from…']);
    expect(folded(10)).toEqual(['Import audio…', 'Mix down…', 'Record from…', 'Undo', 'Redo']);
  });

  it('never folds Undo without Redo', () => {
    // Room for Redo and the ⋯ alone would fold Undo, so it folds Redo too.
    expect(folded(100)).toEqual(['Import audio…', 'Mix down…', 'Record from…', 'Undo', 'Redo']);
  });
});

group('foldCount', () => {
  // Each action, and the ⋯, takes 50 px with its gap.
  it('folds none while all three fit', () => {
    expect(foldCount(3, 150, 50)).toBe(0);
  });

  it('folds the fewest, first first, that leave room for the rest and the ⋯', () => {
    // One folded alone leaves two and the ⋯, as wide as all three.
    expect(foldCount(3, 149, 50)).toBe(2);
    expect(foldCount(3, 100, 50)).toBe(2);
    expect(foldCount(3, 99, 50)).toBe(3);
    expect(foldCount(4, 199, 50)).toBe(2);
  });

  it('folds all where not even the ⋯ fits', () => {
    expect(foldCount(3, 10, 50)).toBe(3);
  });

  it('never folds a lone action, which the ⋯ would take as much room as', () => {
    expect(foldCount(1, 10, 50)).toBe(0);
    expect(foldCount(1, 50, 50)).toBe(0);
  });
});
