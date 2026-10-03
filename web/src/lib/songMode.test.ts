import { describe, expect, it } from 'vitest';
import { detailsSummary, openingMode, sideParts } from './songMode';

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

  it('shows the key the Chords are transposed to, with the written one', () => {
    expect(detailsSummary({ key: 'G', bpm: '92', capo: '2', tuning: '' }, 2)).toBe(
      'Key A (written G) · 92 BPM · Capo 2',
    );
    expect(detailsSummary({ ...none, key: ' G minor ' }, 2)).toBe('Key A minor (written G minor)');
  });

  it("shows the written key when it can't be read or isn't transposed", () => {
    expect(detailsSummary({ ...none, key: 'Sol' }, 2)).toBe('Sol');
    expect(detailsSummary({ ...none, key: 'G' }, 0)).toBe('G');
    expect(detailsSummary({ ...none, bpm: '92' }, 2)).toBe('92 BPM');
  });
});

describe('sideParts', () => {
  it('shows the Scrapbook, then the Masters starting closed, in Write mode', () => {
    expect(sideParts('write')).toEqual([
      { part: 'scrapbook', open: true },
      { part: 'masters', open: false },
    ]);
  });

  it('shows only the Masters, open, in Read mode', () => {
    expect(sideParts('read')).toEqual([{ part: 'masters', open: true }]);
  });
});
