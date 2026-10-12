import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { heroSong, loopButton, syncButton } from '../songPage';

// Rhyme mode on the Song page: what switches it on and off, alongside Sync
// mode, the Loop, Read mode and the window's width, and the Rhymes card it
// shows.

/** The Lyric Sheet's Rhymes switch, which switches Rhyme mode on and off. */
const rhymesButton = (page: Page) =>
  page.getByRole('region', { name: 'Lyric Sheet' }).getByRole('button', { name: 'Rhymes', exact: true });

/** The Rhymes card, in the side column while Rhyme mode is on. */
const rhymesCard = (page: Page) => page.getByRole('region', { name: 'Rhymes', exact: true });

/** Switches Rhyme mode on. */
async function rhymesOn(page: Page) {
  await rhymesButton(page).click();
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'true');
}

test('the Rhymes card shows only in Rhyme mode, for the word at the caret', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await page.getByRole('button', { name: 'Add Section' }).click();
  const lines = page.getByRole('textbox', { name: 'Lines' });
  await lines.fill('We ride tonight');
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);

  await rhymesOn(page);
  await expect(rhymesCard(page)).toBeVisible();
  await lines.click();
  await lines.press('End');
  await expect(rhymesCard(page).getByRole('searchbox', { name: 'Rhymes for' })).toHaveValue('tonight');

  await rhymesButton(page).click();
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);
});

test('the Rhymes card comes back open each time Rhyme mode comes on', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await rhymesOn(page);
  await page.locator('summary', { hasText: 'Rhymes' }).click();
  await expect(rhymesCard(page)).toBeHidden();

  await rhymesButton(page).click();
  await rhymesOn(page);

  await expect(rhymesCard(page)).toBeVisible();
});

test('switching Rhyme mode on switches Sync mode off, and the other way round', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(syncButton(page)).toBeEnabled();
  await syncButton(page).click();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'true');

  await rhymesOn(page);
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');

  await syncButton(page).click();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);
});

test('the Loop leaves Rhyme mode on', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 10, end: 14, on: false });
  await page.goto(`/songs/${song.id}`);
  await rhymesOn(page);

  await loopButton(page).click();

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(rhymesCard(page)).toBeVisible();
});

test('Rhyme mode starts off on every visit', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await rhymesOn(page);

  await page.reload();

  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);
});

test('Read mode ends Rhyme mode, and it stays off back in Write mode', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await rhymesOn(page);

  await page.getByRole('radio', { name: 'Read' }).check();
  await expect(rhymesButton(page)).toHaveCount(0);
  await expect(rhymesCard(page)).toHaveCount(0);

  await page.getByRole('radio', { name: 'Write' }).check();
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);
});

test("a window narrower than 80rem has no Rhymes, and widening it again doesn't bring them back", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await rhymesOn(page);

  await page.setViewportSize({ width: 1270, height: 900 });
  await expect(rhymesButton(page)).toHaveCount(0);
  await expect(rhymesCard(page)).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(rhymesButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(rhymesCard(page)).toHaveCount(0);
});
