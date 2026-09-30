import { describe as group, expect, it } from 'vitest';
import { transportActions } from './transportMenu';

group('transportActions', () => {
  const idle = { fullTimeline: true, importing: false, recording: false };
  const run = { importAudio: () => {}, recordingSettings: () => {} };
  const shown = (state: typeof idle) =>
    transportActions(state, run).map(({ label, disabled }) => ({ label, disabled: disabled ?? false }));

  it('offers Import audio… and Recording settings… on the full Timeline', () => {
    expect(shown(idle)).toEqual([
      { label: 'Import audio…', disabled: false },
      { label: 'Recording settings…', disabled: false },
    ]);
  });

  it('runs what each entry names', () => {
    const ran: string[] = [];
    const entries = transportActions(idle, {
      importAudio: () => ran.push('import'),
      recordingSettings: () => ran.push('settings'),
    });
    for (const entry of entries) if ('run' in entry) entry.run();
    expect(ran).toEqual(['import', 'settings']);
  });

  it('disables Import audio… while importing', () => {
    expect(shown({ ...idle, importing: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Recording settings…', disabled: false },
    ]);
  });

  it('disables both while recording', () => {
    expect(shown({ ...idle, recording: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Recording settings…', disabled: true },
    ]);
  });

  it('offers neither where the Timeline is transport-only', () => {
    expect(shown({ ...idle, fullTimeline: false })).toEqual([]);
  });
});
