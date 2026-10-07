import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clip, heroSong, pauseButton, playButton, playhead, playheadReaches, ruler, timeline } from '../songPage';

// How the Timeline plays, on the demo Backup's hero Song, whose Timeline
// plays for 1:30: playing to the end, a ruler click while playing, the
// Loop, and playing from a Cue. The playhead is read from the ruler, to the
// second, so how fast the page plays only moves it within a second or so.

/** Opens a Song's page, with its Timeline ready to play. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(clip(page, 'Take 2')).toBeVisible();
}

/** The playhead at the end, as the ruler says it: e.g. "1:30 of 1:30". */
const atTheEnd = /^(\d+:\d\d) of \1$/;

test('playing to the end stops there, keeping the playhead at the end, and playing again starts over from 0:00', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  // 5 s before the end.
  await timeline(page).getByRole('button', { name: 'Go to the end' }).click();
  await expect(ruler(page)).toHaveAttribute('aria-valuetext', atTheEnd);
  const end = await playhead(page);
  await ruler(page).press('ArrowLeft');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', String(end - 5));

  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();

  // Stopped at the end, with the playhead kept there.
  await expect(playButton(page)).toBeVisible({ timeout: 15_000 });
  await expect(ruler(page)).toHaveAttribute('aria-valuetext', atTheEnd);
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', String(end));
  // Given time to play on, were it still playing.
  await page.waitForTimeout(500);
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', String(end));

  // Played again, it starts over.
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await playheadReaches(page, 1);
  await pauseButton(page).click();
  expect(await playhead(page)).toBeLessThan(5);
});

test('a ruler click while playing jumps playback there, and it carries on playing', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await playheadReaches(page, 1);

  // Clicked two thirds of the way along the ruler shown, far ahead of the playhead.
  const box = (await ruler(page).boundingBox())!;
  const shown = Math.min(box.width, page.viewportSize()!.width - box.x);
  const span = Number(await ruler(page).getAttribute('aria-valuemax'));
  const x = (shown * 2) / 3;
  const to = (x / box.width) * span;
  expect(to - (await playhead(page))).toBeGreaterThan(15);
  await page.mouse.click(box.x + x, box.y + box.height / 2);

  // Jumped there at once, far sooner than playing on would get there.
  await playheadReaches(page, Math.floor(to) - 1, { timeout: 3_000 });
  expect(await playhead(page)).toBeLessThanOrEqual(Math.ceil(to) + 2);
  // Playing on from there, rather than from where it was.
  await playheadReaches(page, Math.floor(to) + 2, { timeout: 5_000 });
  await expect(pauseButton(page)).toBeVisible();
});

test('with the Loop on, playback wraps at its end, and switching it on never moves the playhead', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 10, end: 14, on: false });
  await open(page, song.id);
  const loop = timeline(page).getByRole('button', { name: 'Loop', exact: true });
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '5');

  // Switched on while stopped, before the Loop, the playhead stays.
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  // Given time for a restart that would move it.
  await page.waitForTimeout(300);
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '5');
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'false');

  // Switched on while playing, before the Loop, playback carries on from where it is.
  await playButton(page).click();
  await playheadReaches(page, 6);
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  const switchedAt = await playhead(page);
  expect(switchedAt).toBeLessThan(10);

  // It plays into the Loop, wrapping only at its end, back to its start:
  // the playhead, read as it goes, rises to the Loop's end, then drops back.
  const readings = [switchedAt];
  const highest = () => readings.indexOf(Math.max(...readings));
  await expect
    .poll(
      async () => {
        readings.push(await playhead(page));
        return readings[highest()] >= 12 && readings.slice(highest() + 1).some((t) => t <= 11);
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
  const rising = readings.slice(0, highest() + 1);
  expect(rising).toEqual([...rising].sort((a, b) => a - b));
  expect(readings[highest()]).toBeLessThanOrEqual(14);
  expect(Math.min(...readings.slice(highest()))).toBeGreaterThanOrEqual(10);
  await expect(pauseButton(page)).toBeVisible();
});

test('playing from a Cue in the Lyric Sheet starts playback there, and while playing jumps there', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);

  // Played from a second before the Cue, to lead into it.
  await page.getByRole('button', { name: 'Play from Line 1 of Chorus at 0:25.0' }).click();
  await expect(pauseButton(page)).toBeVisible();
  // Sooner than playing from 0:00 would get there.
  await playheadReaches(page, 24, { timeout: 5_000 });
  expect(await playhead(page)).toBeLessThanOrEqual(26);

  // Played from another while playing, it jumps there, never pausing.
  await page.getByRole('button', { name: 'Play from Line 1 of Verse 1 at 0:05.0' }).click();
  await expect.poll(() => playhead(page), { timeout: 15_000 }).toBeLessThanOrEqual(6);
  expect(await playhead(page)).toBeGreaterThanOrEqual(4);
  await playheadReaches(page, 7);
  await expect(pauseButton(page)).toBeVisible();
});
