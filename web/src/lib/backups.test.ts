import { describe, expect, it } from 'vitest';
import { backupName, backupSize } from './backups';

// 18:30 on 4 Oct 2026, in the time zone the tests run in.
const made = new Date(2026, 9, 4, 18, 30).toISOString();

describe('backupName', () => {
  it('names a Backup after the day it was made and how many Songs it holds', () => {
    expect(backupName({ createdAt: made, songs: 3 })).toBe('4 Oct 2026 · 3 Songs');
  });

  it('says Song for one', () => {
    expect(backupName({ createdAt: made, songs: 1 })).toBe('4 Oct 2026 · 1 Song');
  });

  it('gives every month its three-letter name', () => {
    const months = Array.from(
      { length: 12 },
      (_, m) => backupName({ createdAt: new Date(2026, m, 15).toISOString(), songs: 2 }).split(' ')[1],
    );
    expect(months).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('takes the day where the Backup is shown, not where it was made', () => {
    // Just after midnight here can still be the day before in UTC.
    const justAfterMidnight = new Date(2026, 9, 5, 0, 10).toISOString();
    expect(backupName({ createdAt: justAfterMidnight, songs: 2 })).toBe('5 Oct 2026 · 2 Songs');
  });
});

describe('backupSize', () => {
  it('gives a Backup under a megabyte in kilobytes, rounded up', () => {
    expect(backupSize(7828)).toBe('8 KB');
    expect(backupSize(1)).toBe('1 KB');
    expect(backupSize(1023 * 1024)).toBe('1023 KB');
  });

  it('gives a larger one in megabytes, as uploads are', () => {
    expect(backupSize(1 << 20)).toBe('1.0 MB');
    expect(backupSize(4.2 * (1 << 20))).toBe('4.2 MB');
    expect(backupSize(612 * (1 << 20))).toBe('612 MB');
  });
});
