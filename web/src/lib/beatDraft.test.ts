import { describe, expect, it } from 'vitest';
import { describeOffer, invalidFields, invalidValue, sameDraft, toDraft, wouldLoseEdits } from './beatDraft';

describe('describeOffer', () => {
  it('lists every offered change in the order the form shows them', () => {
    expect(describeOffer({ key: 'Am', bpm: '140', producer: 'Pryme', title: 'Echo Room' })).toBe(
      '“Echo Room” · by Pryme · 140 BPM · Am',
    );
  });

  it('leaves out what is not offered', () => {
    expect(describeOffer({ bpm: '92' })).toBe('92 BPM');
    expect(describeOffer({ title: 'Paper Hours', key: 'Ebm' })).toBe('“Paper Hours” · Ebm');
  });

  it('describes nothing when nothing is offered', () => {
    expect(describeOffer({})).toBe('');
  });
});

describe('sameDraft', () => {
  const opened = toDraft({ title: 'Echo Room', producer: 'Pryme', bpm: 140, key: 'Am', notes: '' });

  it('holds an unchanged draft the same', () => {
    expect(sameDraft({ ...opened }, opened)).toBe(true);
  });

  it('tells any field typed in', () => {
    expect(sameDraft({ ...opened, title: 'Echo Room 2' }, opened)).toBe(false);
    expect(sameDraft({ ...opened, bpm: '14' }, opened)).toBe(false);
    expect(sameDraft({ ...opened, notes: ' ' }, opened)).toBe(false);
  });
});

describe('wouldLoseEdits', () => {
  const saved = toDraft({ title: 'Echo Room', producer: 'Pryme', bpm: 140, key: 'Am', notes: '' });

  it('loses nothing while the details are as saved', () => {
    expect(wouldLoseEdits({ ...saved }, saved, null)).toBe(false);
  });

  it('loses details typed since they were saved', () => {
    expect(wouldLoseEdits({ ...saved, producer: 'Pryme Beats' }, saved, null)).toBe(true);
  });

  it('loses suggested details neither used nor dismissed', () => {
    expect(wouldLoseEdits({ ...saved }, saved, { bpm: '92' })).toBe(true);
  });
});

describe('invalidFields', () => {
  const valid = toDraft({
    title: 'Echo Room',
    producer: 'Pryme',
    bpm: 140,
    key: 'Am',
    sourceLink: 'https://example.com/b',
  });

  it('finds nothing wrong with a Beat that can be added', () => {
    expect(invalidFields(valid)).toEqual([]);
    expect(invalidFields({ ...valid, bpm: '', sourceLink: '', producer: '', key: '' })).toEqual([]);
  });

  it('needs a Title', () => {
    expect(invalidFields({ ...valid, title: '  ' })).toEqual(['title']);
  });

  it('needs a BPM to be a whole number the server takes', () => {
    expect(invalidFields({ ...valid, bpm: '92.5' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: 'fast' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: '0' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: '1000' })).toEqual(['bpm']);
    expect(invalidFields({ ...valid, bpm: ' 999 ' })).toEqual([]);
  });

  it('needs a Source link to be a web address', () => {
    expect(invalidFields({ ...valid, sourceLink: 'example.com' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: 'ftp://example.com/b' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: 'https://' })).toEqual(['sourceLink']);
    expect(invalidFields({ ...valid, sourceLink: ' http://example.com ' })).toEqual([]);
  });

  it('lists every invalid field', () => {
    expect(invalidFields({ ...valid, title: '', bpm: 'x', sourceLink: 'y' })).toEqual(['title', 'bpm', 'sourceLink']);
  });
});

describe('invalidValue', () => {
  it('refuses a value for a field as it would refuse one typed into a row', () => {
    expect(invalidValue('bpm', 'fast')).toBe(true);
    expect(invalidValue('bpm', '1000')).toBe(true);
    expect(invalidValue('sourceLink', 'beatstars')).toBe(true);
  });

  it('takes valid values, and an empty one, which clears the field', () => {
    expect(invalidValue('bpm', '92')).toBe(false);
    expect(invalidValue('sourceLink', 'https://example.com/b')).toBe(false);
    expect(invalidValue('producer', '')).toBe(false);
    expect(invalidValue('bpm', '')).toBe(false);
    expect(invalidValue('notes', 'CC BY')).toBe(false);
  });
});
