import { describe, expect, it } from 'vitest';
import { formatTempo, tempoOf, tempoPercent } from './clipTempo';

describe('a Tempo', () => {
  it('is shown as a whole percentage', () => {
    expect(formatTempo(0.92)).toBe('92%');
    expect(formatTempo(1)).toBe('100%');
    expect(tempoPercent(1.256)).toBe(126);
  });

  it('is set from a whole percentage, from 50% to 200%', () => {
    expect(tempoOf(92)).toBe(0.92);
    expect(tempoOf(92.4)).toBe(0.92);
    expect(tempoOf(20)).toBe(0.5);
    expect(tempoOf(250)).toBe(2);
  });
});
