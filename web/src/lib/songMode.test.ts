import { describe, expect, it } from 'vitest';
import { detailsSummary, openingMode } from './songMode';

describe('openingMode', () => {
  it('opens a Finished Song in Read mode', () => {
    expect(openingMode('finished')).toBe('read');
  });

  it('opens Idea and Drafting Songs in Write mode', () => {
    expect(openingMode('idea')).toBe('write');
    expect(openingMode('drafting')).toBe('write');
  });
});

describe('detailsSummary', () => {
  const none = { key: '', bpm: '', capo: '', tuning: '' };

  it('joins the Details that are set', () => {
    expect(detailsSummary({ key: 'C#m', bpm: '92', capo: '2', tuning: 'Standard' })).toBe(
      'C#m · 92 BPM · Capo 2 · Standard',
    );
  });

  it('leaves out the ones that are empty', () => {
    expect(detailsSummary({ ...none, bpm: '92', tuning: 'Drop D' })).toBe('92 BPM · Drop D');
    expect(detailsSummary({ ...none, key: ' Am ', capo: '  ' })).toBe('Am');
  });

  it('is empty when none are set', () => {
    expect(detailsSummary(none)).toBe('');
  });
});
