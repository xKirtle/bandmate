import { describe, expect, it } from 'vitest';
import { editHint, editsWhileRecording } from './freeze';
import type { Edit } from './history';

describe('editsWhileRecording', () => {
  it("lets a Track's levels change, heard live", () => {
    expect(editsWhileRecording({ kind: 'updateTrack', trackId: 1, changes: { muted: true } })).toBe(true);
    expect(editsWhileRecording({ kind: 'updateTrack', trackId: 1, changes: { soloed: false } })).toBe(true);
    expect(editsWhileRecording({ kind: 'updateTrack', trackId: 1, changes: { volume: -6 } })).toBe(true);
  });

  it('refuses renaming a Track', () => {
    expect(editsWhileRecording({ kind: 'updateTrack', trackId: 1, changes: { name: 'Vox' } })).toBe(false);
  });

  it('refuses every other edit to the Timeline', () => {
    const edits: Edit[] = [
      { kind: 'addBeat', trackId: 1, beatId: 2 },
      { kind: 'addTrack', track: { name: 'Track 2' } },
      { kind: 'reorderTracks', order: [2, 1] },
      { kind: 'deleteTrack', trackId: 1 },
      { kind: 'duplicateClip', clipId: 1 },
      { kind: 'moveClip', clipId: 1, trackId: 1, start: 2 },
      { kind: 'moveClips', moves: [] },
      { kind: 'trimClip', clipId: 1, offset: 0, length: 1 },
      { kind: 'renameClip', clipId: 1, name: 'Hook' },
      { kind: 'deleteClip', clipId: 1 },
      { kind: 'deleteClips', clipIds: [1] },
      { kind: 'replaceClips', clipIds: [1], clips: [] },
      { kind: 'chooseTake', clipId: 1, takeId: 2 },
      { kind: 'nudgeTake', clipId: 1, takeId: 2, nudge: 0.01 },
      { kind: 'deleteTake', clipId: 1, takeId: 2 },
      { kind: 'clearInactiveTakes', clipId: 1 },
      { kind: 'setLoop', loop: { start: 0, end: 4, on: true } },
      { kind: 'switchLoop', on: false },
      { kind: 'clearLoop' },
    ];
    for (const e of edits) expect(editsWhileRecording(e)).toBe(false);
  });
});

describe('editHint', () => {
  it('says to stop recording while recording', () => {
    expect(editHint('recording', 'Move up')).toBe('Stop recording to edit');
    expect(editHint('recording', undefined)).toBe('Stop recording to edit');
  });

  it('says to wait for a Merge while one is being made', () => {
    expect(editHint('merging', 'Move up')).toBe('Wait for the Merge to finish to edit');
  });

  it("is the control's own otherwise", () => {
    expect(editHint(null, 'Move up')).toBe('Move up');
    expect(editHint(null, undefined)).toBeUndefined();
  });
});
