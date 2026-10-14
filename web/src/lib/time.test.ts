import { describe as group, expect, it } from 'vitest';
import { formatDay, formatTime, formatWhen, toTheSecond } from './time';

group('toTheSecond', () => {
  it('splits a time into minutes and two-digit seconds, rounded to the nearest second', () => {
    expect(toTheSecond(0)).toEqual({ minutes: 0, seconds: '00' });
    expect(toTheSecond(65.4)).toEqual({ minutes: 1, seconds: '05' });
    expect(toTheSecond(119.6)).toEqual({ minutes: 2, seconds: '00' });
  });
});

// A local time, as every date and time the app shows is.
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 13, 18, 30);

group('formatDay', () => {
  it('says the local day, its month spelled out', () => {
    expect(formatDay(at(2026, 9, 4, 0, 10))).toBe('4 Sep 2026');
    expect(formatDay(at(2025, 12, 31, 23, 50))).toBe('31 Dec 2025');
  });
});

group('formatTime', () => {
  it('says the local time to the minute, in 24 hours where the locale counts them', () => {
    expect(formatTime(at(2026, 10, 13, 9, 5), 'en-GB')).toBe('09:05');
    expect(formatTime(at(2026, 10, 13, 21, 5), 'en-GB')).toBe('21:05');
  });

  it('says it in 12 hours where the locale counts those', () => {
    expect(formatTime(at(2026, 10, 13, 21, 5), 'en-US')).toMatch(/^9:05\sPM$/);
  });
});

group('formatWhen', () => {
  it('says the time alone, after Today, for today', () => {
    expect(formatWhen(at(2026, 10, 13, 9, 5), now, 'en-GB')).toBe('Today, 09:05');
  });

  it('says Yesterday for the day before', () => {
    expect(formatWhen(at(2026, 10, 12, 23, 59), now, 'en-GB')).toBe('Yesterday, 23:59');
  });

  it('says the day for one earlier this year, and the year too for another', () => {
    expect(formatWhen(at(2026, 9, 4, 14, 0), now, 'en-GB')).toBe('4 Sep, 14:00');
    expect(formatWhen(at(2025, 12, 31, 8, 30), now, 'en-GB')).toBe('31 Dec 2025, 08:30');
  });

  it('says the time as the locale counts hours', () => {
    expect(formatWhen(at(2026, 10, 13, 21, 5), now, 'en-US')).toMatch(/^Today, 9:05\sPM$/);
  });
});
