import { describe, expect, it } from 'vitest';
import { formatVolume, trackGains } from './mixer';

const track = (id: number, levels: { volume?: number; muted?: boolean; soloed?: boolean } = {}) => ({
  id,
  volume: 0,
  muted: false,
  soloed: false,
  ...levels,
});

describe('trackGains', () => {
  it('plays a Track at 0 dB as it is', () => {
    expect(trackGains([track(1)])).toEqual(new Map([[1, 1]]));
  });

  it('turns decibels into a gain', () => {
    const gains = trackGains([track(1, { volume: 6 }), track(2, { volume: -6 }), track(3, { volume: -20 })]);
    expect(gains.get(1)).toBeCloseTo(1.9953, 4);
    expect(gains.get(2)).toBeCloseTo(0.5012, 4);
    expect(gains.get(3)).toBeCloseTo(0.1, 4);
  });

  it('silences a Track at the bottom of its fader', () => {
    expect(trackGains([track(1, { volume: -60 })]).get(1)).toBe(0);
  });

  it('silences a muted Track', () => {
    expect(trackGains([track(1, { muted: true }), track(2)])).toEqual(
      new Map([
        [1, 0],
        [2, 1],
      ]),
    );
  });

  it('only plays soloed Tracks when there are any, however many', () => {
    const gains = trackGains([track(1, { soloed: true }), track(2), track(3, { soloed: true, volume: -20 })]);
    expect(gains.get(1)).toBe(1);
    expect(gains.get(2)).toBe(0);
    expect(gains.get(3)).toBeCloseTo(0.1, 4);
  });

  it('keeps a muted Track silent even when it is soloed', () => {
    const gains = trackGains([track(1, { soloed: true, muted: true }), track(2)]);
    expect(gains.get(1)).toBe(0);
    expect(gains.get(2)).toBe(0);
  });
});

describe('formatVolume', () => {
  it('shows decibels with their sign, and silence', () => {
    expect(formatVolume(0)).toBe('0 dB');
    expect(formatVolume(6)).toBe('+6 dB');
    expect(formatVolume(-12.5)).toBe('−12.5 dB');
    expect(formatVolume(-60)).toBe('Silent');
  });
});
