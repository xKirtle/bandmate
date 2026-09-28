import { describe, expect, it } from 'vitest';
import { describeOffer } from './beatDraft';

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
