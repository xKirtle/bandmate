import { describe as group, expect, it } from 'vitest';
import { transportActions } from './transportMenu';

group('transportActions', () => {
  const idle = { fullTimeline: true, importing: false, recording: false, chosenTrack: 'Vocals', hasClips: true };
  const run = { importAudio: () => {}, mixDown: () => {}, recordingSettings: () => {} };
  const shown = (state: typeof idle) =>
    transportActions(state, run).map(({ label, disabled }) => ({ label, disabled: disabled ?? false }));

  it('offers Import audio…, Mix down… and Recording settings… on the full Timeline', () => {
    expect(shown(idle)).toEqual([
      { label: 'Import audio…', disabled: false },
      { label: 'Mix down…', disabled: false },
      { label: 'Recording settings…', disabled: false },
    ]);
  });

  it('says which Track Import audio… imports onto', () => {
    expect(transportActions(idle, run)[0].title).toBe('Import an audio file as a Sound onto Vocals');
  });

  it('runs what each entry names', () => {
    const ran: string[] = [];
    const entries = transportActions(idle, {
      importAudio: () => ran.push('import'),
      mixDown: () => ran.push('mix'),
      recordingSettings: () => ran.push('settings'),
    });
    for (const entry of entries) if ('run' in entry) entry.run();
    expect(ran).toEqual(['import', 'mix', 'settings']);
  });

  it('disables Import audio… while importing', () => {
    expect(shown({ ...idle, importing: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: false },
      { label: 'Recording settings…', disabled: false },
    ]);
  });

  it('disables all three while recording', () => {
    expect(shown({ ...idle, recording: true })).toEqual([
      { label: 'Import audio…', disabled: true },
      { label: 'Mix down…', disabled: true },
      { label: 'Recording settings…', disabled: true },
    ]);
  });

  it('says to stop recording on each while recording', () => {
    expect(transportActions({ ...idle, recording: true }, run).map((a) => a.title)).toEqual([
      'Stop recording to import audio',
      'Stop recording to mix down',
      'Stop recording to change the recording settings',
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
