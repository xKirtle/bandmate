import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import { noticeShown, SheetNotice } from './sheetNotice.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

group('SheetNotice', () => {
  it('says nothing to begin with', () => {
    expect(new SheetNotice().text).toBeNull();
  });

  it('says what it was given, until its time is up', () => {
    const notice = new SheetNotice();
    notice.say('Night swim added to Chorus as an Alternate');
    expect(notice.text).toBe('Night swim added to Chorus as an Alternate');

    vi.advanceTimersByTime(noticeShown - 1);
    expect(notice.text).toBe('Night swim added to Chorus as an Alternate');
    vi.advanceTimersByTime(1);
    expect(notice.text).toBeNull();
  });

  it('shows a new notice in place of the one shown, for its own time', () => {
    const notice = new SheetNotice();
    notice.say('Night swim added to Chorus as an Alternate');
    vi.advanceTimersByTime(noticeShown - 1);
    notice.say("Nothing was written in Hook, so it wasn't kept.");

    vi.advanceTimersByTime(noticeShown - 1);
    expect(notice.text).toBe("Nothing was written in Hook, so it wasn't kept.");
    vi.advanceTimersByTime(1);
    expect(notice.text).toBeNull();
  });
});
