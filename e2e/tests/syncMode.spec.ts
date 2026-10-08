import type { Page } from '@playwright/test';
import type { Bandmate, Loop } from '../bandmate';
import { expect, test } from '../fixtures';
import {
  dragMiddleOf,
  heroSong,
  pauseButton,
  playButton,
  playhead,
  playheadReaches,
  ruler,
  serverCues,
  timeline,
} from '../songPage';

// Sync mode on the Song page, on the demo Backup's hero Song, whose Lines
// are all cued but the Bridge's: what switches it on and off, alongside the
// Loop, recording and the lyrics changing, and which Line it cues next.
// Recording's part is pinned with the recording tests, which have a
// microphone.

/** The Lyric Sheet's Sync lyrics switch. */
const syncButton = (page: Page) => page.getByRole('button', { name: 'Sync lyrics' });

/** The Timeline's Loop switch. */
const loopButton = (page: Page) => timeline(page).getByRole('button', { name: 'Loop', exact: true });

/** The Timeline's Record button. */
const recordButton = (page: Page) => timeline(page).getByRole('button', { name: 'Record', exact: true });

/** The Now button, by the Line up next in Sync mode: there's only ever one. */
const nowButton = (page: Page) => page.getByRole('button', { name: /^Cue .* now$/ });

/** Opens a Song's page, with its Timeline's Clips shown, so Sync mode can come on. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(syncButton(page)).toBeEnabled();
}

/** Switches Sync mode on. */
async function syncOn(page: Page) {
  await syncButton(page).click();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Whether the server has the Song's Loop on. */
async function serverLoopOn(bandmate: Bandmate, songId: number): Promise<boolean> {
  const loop = (await bandmate.timeline(songId)).loop as Loop | null | undefined;
  return loop?.on ?? false;
}

test('switching Sync mode on switches the Loop off', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 10, end: 14, on: true });
  await open(page, song.id);
  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');

  await syncOn(page);

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => serverLoopOn(bandmate, song.id)).toBe(false);
});

test('the Loop switched on ends Sync mode', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 10, end: 14, on: false });
  await open(page, song.id);
  await syncOn(page);

  await loopButton(page).click();

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(nowButton(page)).toHaveCount(0);
});

test('a Loop set by dragging along the top of the ruler ends Sync mode', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  await expect(loopButton(page)).toBeDisabled();
  await syncOn(page);

  // A new Loop is set on.
  await dragMiddleOf(page, timeline(page).getByTitle('Drag to set a Loop'), { x: 120, y: 0 });

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => serverLoopOn(bandmate, song.id)).toBe(true);
});

test('the Loop brought back by an undo ends Sync mode', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 10, end: 14, on: true });
  await open(page, song.id);
  // Sync mode coming on switched the Loop off, as an edit an undo takes back.
  await syncOn(page);
  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => serverLoopOn(bandmate, song.id)).toBe(false);

  await timeline(page).getByRole('button', { name: 'Undo' }).click();

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => serverLoopOn(bandmate, song.id)).toBe(true);
});

test('Record is disabled while Sync mode is on', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  await expect(recordButton(page)).toBeEnabled();

  await syncOn(page);
  await expect(recordButton(page)).toBeDisabled();
  await expect(recordButton(page)).toHaveAccessibleDescription('Leave Sync mode to record');

  await syncButton(page).click();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(recordButton(page)).toBeEnabled();
});

test("Sync mode can't be switched on with no Clips on the Timeline", async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await expect(timeline(page)).toBeVisible();

  await expect(syncButton(page)).toBeDisabled();
  await expect(syncButton(page)).toHaveAccessibleDescription('Add a Beat to the Timeline to sync lyrics to it');
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the next Line is the first without a Cue, and Now or Enter cues it at the playhead and brings up the Line after it', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  // Every Line but the Bridge's is cued.
  expect(await serverCues(bandmate, song.id, 'Bridge')).toEqual([null, null, null, null]);

  await syncOn(page);
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 1 of Bridge now');

  // Now, with the playhead at 0:05, stopped.
  await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '5');
  await nowButton(page).click();
  await expect.poll(() => serverCues(bandmate, song.id, 'Bridge')).toEqual([5, null, null, null]);
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 2 of Bridge now');

  // Enter, with the playhead at 0:10; focus stays on the ruler, as Now keeps it where it was.
  await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '10');
  await page.keyboard.press('Enter');
  await expect.poll(() => serverCues(bandmate, song.id, 'Bridge')).toEqual([5, 10, null, null]);
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 3 of Bridge now');
});

test('a Line clicked becomes the next one, cued or not, and playing from a Cue leaves the next Line where it is', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  await syncOn(page);
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 1 of Bridge now');

  // A cued Line clicked comes up next, and cueing it brings up the Line after it, cued too.
  await page.getByRole('button', { name: 'Cue Line 3 of Verse 1 next, cued at 0:15.0' }).click();
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 3 of Verse 1 now');
  await ruler(page).press('ArrowRight');
  await ruler(page).press('ArrowRight');
  await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '15');
  await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '20');
  await nowButton(page).click();
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10, 20, 20]);
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 4 of Verse 1 now');

  // Played from a Cue elsewhere, the next Line stays where it is.
  await page.getByRole('button', { name: 'Play from Line 1 of Chorus at 0:25.0' }).click();
  await expect(pauseButton(page)).toBeVisible();
  await playheadReaches(page, 25, { timeout: 5_000 });
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 4 of Verse 1 now');
  await pauseButton(page).click();
  await expect(nowButton(page)).toHaveAccessibleName('Cue Line 4 of Verse 1 now');
});

test('adding a Section ends Sync mode, and playback carries on', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  await syncOn(page);
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await playheadReaches(page, 1);

  await page.getByRole('button', { name: 'Add Section' }).click();

  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(nowButton(page)).toHaveCount(0);
  // Still playing, on from where it was.
  const at = await playhead(page);
  await expect(pauseButton(page)).toBeVisible();
  await playheadReaches(page, at + 2);
});
