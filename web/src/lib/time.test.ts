import { describe as group, expect, it } from 'vitest';
import { toTheSecond } from './time';

group('toTheSecond', () => {
  it('splits a time into minutes and two-digit seconds, rounded to the nearest second', () => {
    expect(toTheSecond(0)).toEqual({ minutes: 0, seconds: '00' });
    expect(toTheSecond(65.4)).toEqual({ minutes: 1, seconds: '05' });
    expect(toTheSecond(119.6)).toEqual({ minutes: 2, seconds: '00' });
  });
});
