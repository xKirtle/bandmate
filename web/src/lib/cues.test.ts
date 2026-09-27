import { describe, expect, it } from 'vitest';
import { currentOccurrence, formatCue, parseCue } from './cues';

describe('parseCue', () => {
  it('reads plain seconds', () => {
    expect(parseCue('45')).toBe(45);
    expect(parseCue('45.25')).toBe(45.25);
    expect(parseCue('0')).toBe(0);
    expect(parseCue('90')).toBe(90);
  });

  it('reads minutes and seconds', () => {
    expect(parseCue('0:45')).toBe(45);
    expect(parseCue('0:45.25')).toBe(45.25);
    expect(parseCue('1:02')).toBe(62);
    expect(parseCue('12:00.5')).toBe(720.5);
  });

  it('ignores surrounding spaces', () => {
    expect(parseCue('  1:02 ')).toBe(62);
  });

  it('keeps no more than millisecond precision', () => {
    expect(parseCue('1.23456')).toBe(1.235);
  });

  it('rejects anything that is not a time', () => {
    for (const text of ['', ' ', 'abc', '1:', ':45', '1:2:3', '1:60', '1:5', '4 5', '1e3', '.', '45.']) {
      expect(parseCue(text), text).toBeNull();
    }
  });

  it('rejects negative times', () => {
    expect(parseCue('-3')).toBeNull();
    expect(parseCue('-0:03')).toBeNull();
  });
});

describe('formatCue', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatCue(0)).toBe('0:00.0');
    expect(formatCue(45.25)).toBe('0:45.3');
    expect(formatCue(62)).toBe('1:02.0');
    expect(formatCue(720.5)).toBe('12:00.5');
  });

  it('rounds up into the next minute', () => {
    expect(formatCue(59.96)).toBe('1:00.0');
  });

  it('reads back as the time it shows', () => {
    expect(parseCue(formatCue(83.4))).toBe(83.4);
  });
});

describe('currentOccurrence', () => {
  // Intro (no Cue), Verse at 0:10, Chorus at 0:30, Verse 2 at 0:50.
  const arrangement = [
    { id: 1, cue: null },
    { id: 2, cue: 10 },
    { id: 3, cue: 30 },
    { id: 4, cue: 50 },
  ];

  it('is nothing before the first Cue', () => {
    expect(currentOccurrence(arrangement, 0)).toBeNull();
    expect(currentOccurrence(arrangement, 9.999)).toBeNull();
  });

  it('is the Occurrence whose Cue has most recently passed', () => {
    expect(currentOccurrence(arrangement, 10)).toBe(2);
    expect(currentOccurrence(arrangement, 29.9)).toBe(2);
    expect(currentOccurrence(arrangement, 30)).toBe(3);
    expect(currentOccurrence(arrangement, 400)).toBe(4);
  });

  it('follows time rather than the Arrangement', () => {
    const outOfOrder = [
      { id: 1, cue: 40 },
      { id: 2, cue: 5 },
      { id: 3, cue: 20 },
    ];
    expect(currentOccurrence(outOfOrder, 6)).toBe(2);
    expect(currentOccurrence(outOfOrder, 25)).toBe(3);
    expect(currentOccurrence(outOfOrder, 45)).toBe(1);
  });

  it('is nothing without any Cues', () => {
    expect(currentOccurrence([{ id: 1, cue: null }], 12)).toBeNull();
    expect(currentOccurrence([], 12)).toBeNull();
  });

  it('picks the later Occurrence of two cued at the same time', () => {
    expect(
      currentOccurrence(
        [
          { id: 1, cue: 5 },
          { id: 2, cue: 5 },
        ],
        6,
      ),
    ).toBe(2);
  });
});
