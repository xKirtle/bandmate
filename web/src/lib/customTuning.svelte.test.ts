import { describe, expect, it } from 'vitest';
import { customTuningField } from './customTuning';
import type { Typing } from './saves.svelte';

/** The notes of a custom tuning, typed against a tuning that commits set. */
function notesField(tuning = 'Standard') {
  const state = { tuning, committed: [] as string[], invalid: [] as string[], typing: [] as Typing[] };
  const field = customTuningField({
    tuning: () => state.tuning,
    commit: (text) => {
      state.committed.push(text);
      state.tuning = text;
    },
    invalid: (message) => state.invalid.push(message),
    typing: (entry) => {
      state.typing.push(entry);
      return () => (state.typing = state.typing.filter((t) => t !== entry));
    },
  });
  return { state, field };
}

describe('customTuningField', () => {
  it('shows the tuning’s notes, or standard tuning’s when it has none', () => {
    expect(notesField('Drop D').field.shown).toBe('D A D G B E');
    expect(notesField('C G D G B D').field.shown).toBe('C G D G B D');
    expect(notesField('').field.shown).toBe('E A D G B E');
  });

  it('commits the notes typed as the tuning’s text', () => {
    const { state, field } = notesField();
    field.shown = 'c g d g b d';
    expect(field.commit()).toBe(true);
    expect(state.committed).toEqual(['C G D G B D']);
    expect(field.shown).toBe('C G D G B D');
    expect(field.unsaved).toBe(false);
  });

  it('commits nothing when the notes typed are the tuning’s', () => {
    const { state, field } = notesField('Drop D');
    field.shown = 'd a d g b e';
    expect(field.commit()).toBe(true);
    expect(state.committed).toEqual([]);
    expect(field.shown).toBe('D A D G B E');
  });

  it('says notes that can’t be read must be six, and keeps them', () => {
    const { state, field } = notesField();
    field.shown = 'D A D';
    expect(field.commit()).toBe(false);
    expect(state.invalid).toEqual(['A custom tuning is six notes, low string to high, like D A D G B E']);
    expect(field.shown).toBe('D A D');
    expect(state.committed).toEqual([]);
  });

  it('counts the notes typed as unsaved on the list of edits being typed', () => {
    const { state, field } = notesField();
    expect(state.typing).toEqual([]);
    field.shown = 'D A D G B';
    expect(state.typing).toEqual([field]);
    expect(field.unsaved).toBe(true);
  });

  it('takes back the notes typed on cancel', () => {
    const { state, field } = notesField('Drop D');
    field.shown = 'C G D G B D';
    field.cancel();
    expect(field.shown).toBe('D A D G B E');
    expect(field.unsaved).toBe(false);
    expect(state.committed).toEqual([]);
  });

  it('commits the notes typed as it goes, and leaves the list', () => {
    const { state, field } = notesField();
    field.shown = 'C G D G B D';
    field.destroy();
    expect(state.committed).toEqual(['C G D G B D']);
    expect(state.typing).toEqual([]);
  });

  it('drops notes that can’t be read as it goes', () => {
    const { state, field } = notesField();
    field.shown = 'C G';
    field.destroy();
    expect(state.committed).toEqual([]);
    expect(field.shown).toBe('E A D G B E');
    expect(state.typing).toEqual([]);
  });
});
