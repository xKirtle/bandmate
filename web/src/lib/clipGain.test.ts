import { describe, expect, it } from 'vitest';
import { clampGain, draggedGain, formatGain, gainFactor, gainLineAt, heardPeak } from './clipGain';

describe('gainFactor', () => {
  it('plays a Clip at 0 dB as it is', () => {
    expect(gainFactor(0)).toBe(1);
  });

  it('turns decibels into a factor of its audio', () => {
    expect(gainFactor(6)).toBeCloseTo(1.9953, 4);
    expect(gainFactor(-20)).toBeCloseTo(0.1, 4);
  });

  it('never silences a Clip, even all the way down', () => {
    expect(gainFactor(-36)).toBeCloseTo(0.01585, 5);
  });
});

describe('gainLineAt', () => {
  it('puts 0 dB in the middle, +36 at the top and −36 at the bottom', () => {
    expect(gainLineAt(0)).toBe(0.5);
    expect(gainLineAt(36)).toBe(0);
    expect(gainLineAt(-36)).toBe(1);
  });

  it('is linear in dB', () => {
    expect(gainLineAt(18)).toBe(0.25);
    expect(gainLineAt(-9)).toBe(0.625);
  });
});

describe('draggedGain', () => {
  it('follows the pointer: dragging up the whole height goes up 72 dB', () => {
    expect(draggedGain(0, -50, 100, false)).toBe(36);
    expect(draggedGain(-6, 25, 100, false)).toBe(-24);
  });

  it('goes a tenth as far with Shift held, for fine drags', () => {
    expect(draggedGain(0, -50, 100, true)).toBe(3.6);
    expect(draggedGain(2, 10, 100, true)).toBe(1.3);
  });

  it('stops at the ends of the range', () => {
    expect(draggedGain(30, -100, 100, false)).toBe(36);
    expect(draggedGain(-30, 100, 100, false)).toBe(-36);
  });

  it('keeps to tenths of a dB', () => {
    expect(draggedGain(0, -1, 70, false)).toBe(1);
    expect(draggedGain(0, -1, 300, false)).toBe(0.2);
  });

  it('stays where it was with nothing to drag across', () => {
    expect(draggedGain(4, -10, 0, false)).toBe(4);
  });
});

describe('clampGain', () => {
  it('keeps a Gain typed within the range', () => {
    expect(clampGain(40)).toBe(36);
    expect(clampGain(-50)).toBe(-36);
    expect(clampGain(-4.5)).toBe(-4.5);
  });
});

describe('formatGain', () => {
  it('shows a Gain signed, in dB', () => {
    expect(formatGain(3)).toBe('+3 dB');
    expect(formatGain(-4.5)).toBe('−4.5 dB');
    expect(formatGain(0)).toBe('0 dB');
  });

  it('rounds to tenths', () => {
    expect(formatGain(1.2345)).toBe('+1.2 dB');
    expect(formatGain(-0.04)).toBe('0 dB');
  });
});

describe('heardPeak', () => {
  it('scales a waveform peak by the Gain', () => {
    expect(heardPeak(0.5, 0)).toBe(0.5);
    expect(heardPeak(0.5, -20)).toBeCloseTo(0.05, 4);
  });

  it('stops at full scale, as drawn', () => {
    expect(heardPeak(0.5, 12)).toBe(1);
  });
});
