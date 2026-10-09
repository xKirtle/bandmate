import { describe as group, expect, it } from 'vitest';
import { foldCount, transportActions } from './transportMenu';

group('transportActions', () => {
  const idle = {
    fullTimeline: true,
    importing: false,
    recording: false,
    merging: false,
    chosenTrack: 'Vocals',
    hasClips: true,
  };
  const run = { importAudio: () => {}, mixDown: () => {}, recordFrom: () => {} };
  const shown = (state: typeof idle) =>
    transportActions(state, run).map(({ label, disabled }) => ({ label, disabled: disabled ?? false }));

  it('offers Import audio…, Mix down… and Record from… on the full Timeline, in the order they fold', () => {
    expect(shown(idle)).toEqual([
      { label: 'Import audio…', disabled: false },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
    ]);
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
    });
    for (const entry of entries) if ('run' in entry) entry.run();
    expect(ran).toEqual(['import', 'mix', 'mic']);
  });

  it('disables Import audio… while importing', () => {
    expect(shown({ ...idle, importing: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
    ]);
  });

  it('disables Import audio… while a Merge is being made, saying why', () => {
    expect(shown({ ...idle, merging: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: false },
      { label: 'Record from…', disabled: false },
    ]);
    expect(transportActions({ ...idle, merging: true }, run)[0].title).toBe(
      'Wait for the Merge to finish to import audio',
    );
  });

  it('disables all three while recording', () => {
    expect(shown({ ...idle, recording: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: true },
      { label: 'Record from…', disabled: true },
    ]);
  });

  it('says to stop recording on each while recording', () => {
    expect(transportActions({ ...idle, recording: true }, run).map((a) => a.title)).toEqual([
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
