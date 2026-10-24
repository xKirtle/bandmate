import type { Page } from '@playwright/test';
import type { Bandmate } from '../bandmate';
import { expect, test } from '../fixtures';
import { heroSong, playButton, timeline } from '../songPage';

// Auto-scroll in Read mode: its button and key start and pause it, its pill
// pauses it while it runs, and it stops at the end of the Lyric Sheet, as
// the Timeline plays, and on leaving Read mode. Its speed is set in the
// Reading menu, on the pill and with [ and ], and kept for each Song.

/** The Lyric Sheet's Auto-scroll button, beside Reading. */
const autoScrollButton = (page: Page) =>
  page.getByRole('region', { name: 'Lyric Sheet' }).getByRole('button', { name: 'Auto-scroll', exact: true });

/** The pill floating at the foot of the window while Auto-scroll runs. */
const pill = (page: Page) => page.getByRole('group', { name: 'Auto-scroll' });

const scrolled = (page: Page) => page.evaluate(() => scrollY);

/** A finished Song, which opens in Read mode, with Lines enough to scroll through. */
async function longSong(bandmate: Bandmate) {
  const song = await bandmate.song({ title: 'Long Road', status: 'finished' });
  for (const label of ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']) {
    const sheet = await bandmate.addSection(song.id, label);
    const section = sheet.sections.find((s) => s.label === label)!;
    const lines = Array.from({ length: 12 }, (_, i) => `${label}, the road goes on, line ${i + 1}`);
    await bandmate.setLines(song.id, section.alternates[0].id, lines.join('\n'));
  }
  return song;
}

test('Auto-scroll starts from its button, scrolls on its own, and its pill pauses it', async ({ page, bandmate }) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(autoScrollButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(pill(page)).toHaveCount(0);

  await autoScrollButton(page).click();
  await expect(autoScrollButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => scrolled(page)).toBeGreaterThan(10);

  await pill(page).getByRole('button', { name: 'Pause Auto-scroll' }).click();
  await expect(pill(page)).toHaveCount(0);
  const paused = await scrolled(page);
  await page.waitForTimeout(500);
  expect(await scrolled(page)).toBe(paused);
});

test('A starts and pauses Auto-scroll, but not in a text field', async ({ page, bandmate }) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(autoScrollButton(page)).toBeVisible();

  await page.keyboard.press('a');
  await expect(pill(page)).toBeVisible();
  await page.keyboard.press('a');
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press('?');
  const search = page.getByRole('dialog').getByRole('searchbox');
  await search.fill('auto');
  await expect(page.getByRole('dialog').getByText('Start or pause Auto-scroll')).toBeVisible();
  await search.press('a');
  await expect(search).toHaveValue('autoa');
  await expect(pill(page)).toHaveCount(0);
});

test('Auto-scroll stops at the end of the Lyric Sheet, and starts from the top there', async ({ page, bandmate }) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  // The last Line a little below the docked Timeline's top edge, hidden by it.
  const last = page.getByText('Bridge, the road goes on, line 12');
  const lastBottom = async () => {
    const box = (await last.boundingBox())!;
    return box.y + box.height;
  };
  const timelineTop = async () => (await timeline(page).boundingBox())!.y;
  const below = (await lastBottom()) - (await timelineTop()) - 60;
  await page.evaluate((by) => scrollBy({ top: by, behavior: 'instant' }), below);

  await page.keyboard.press('a');
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 10_000 });
  // Stopped with the last Line in view, just above the Timeline.
  expect(await lastBottom()).toBeLessThanOrEqual((await timelineTop()) + 1);
  expect(await lastBottom()).toBeGreaterThan((await timelineTop()) - 10);

  await page.keyboard.press('a');
  await expect(pill(page)).toBeVisible();
  expect(await scrolled(page)).toBeLessThan(20);
});

test('Auto-scroll stops as the Timeline plays, and on leaving Read mode', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await page.getByRole('radio', { name: 'Read' }).check();

  await autoScrollButton(page).click();
  await expect(pill(page)).toBeVisible();
  await playButton(page).click();
  await expect(pill(page)).toHaveCount(0);
  await expect(autoScrollButton(page)).toBeDisabled();
  await page.keyboard.press('a');
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press(' ');
  await expect(autoScrollButton(page)).toBeEnabled();
  await autoScrollButton(page).click();
  await expect(pill(page)).toBeVisible();
  await page.getByRole('radio', { name: 'Write' }).check();
  await expect(pill(page)).toHaveCount(0);
});

test('Auto-scroll does nothing where the whole Lyric Sheet is in view', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Short One', status: 'finished' });
  const sheet = await bandmate.addSection(song.id, 'Verse');
  await bandmate.setLines(song.id, sheet.sections[0].alternates[0].id, 'Only a line');
  await page.goto(`/songs/${song.id}`);

  await autoScrollButton(page).click();
  await expect(autoScrollButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(pill(page)).toHaveCount(0);
});

/** The Reading menu's Auto-scroll speed row. */
const speedRow = (page: Page) =>
  page.getByRole('dialog', { name: 'Reading options' }).getByRole('group', { name: 'Auto-scroll speed' });

async function openReading(page: Page) {
  await page.getByRole('region', { name: 'Lyric Sheet' }).getByRole('button', { name: 'Reading', exact: true }).click();
  await expect(speedRow(page)).toBeVisible();
}

test('The Reading menu sets the Auto-scroll speed, kept on the device for each Song', async ({ page, bandmate }) => {
  const song = await longSong(bandmate);
  const other = await bandmate.song({ title: 'Other Road', status: 'finished' });
  const starting = (page: Page) => speedRow(page).getByRole('button', { name: 'Auto-scroll at its starting speed, 4' });
  await page.goto(`/songs/${song.id}`);
  await openReading(page);
  await expect(starting(page)).toBeDisabled();

  await speedRow(page).getByRole('button', { name: 'Speed Auto-scroll up' }).click();
  await expect(speedRow(page).getByRole('button', { name: /speed 5/ })).toBeVisible();

  await page.reload();
  await openReading(page);
  await expect(speedRow(page).getByRole('button', { name: /speed 5/ })).toBeVisible();

  await page.goto(`/songs/${other.id}`);
  await openReading(page);
  await expect(starting(page)).toBeVisible();
});

test('The pill and [ and ] change the speed while it runs, held from 1 to 10', async ({ page, bandmate }) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(autoScrollButton(page)).toBeVisible();

  // Typed in a text field, [ is a [.
  await page.keyboard.press('?');
  const search = page.getByRole('dialog').getByRole('searchbox');
  await search.fill('speed');
  await expect(page.getByRole('dialog').getByText('Slow down or speed up Auto-scroll')).toBeVisible();
  await search.press('[');
  await expect(search).toHaveValue('speed[');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Set before starting, the pill shows it.
  await page.keyboard.press(']');
  await page.keyboard.press('a');
  await expect(pill(page)).toHaveText('Speed 5');

  const slower = pill(page).getByRole('button', { name: 'Slow Auto-scroll down' });
  const faster = pill(page).getByRole('button', { name: 'Speed Auto-scroll up' });
  await slower.click();
  await expect(pill(page)).toHaveText('Speed 4');
  for (let i = 0; i < 4; i++) await page.keyboard.press('[');
  await expect(pill(page)).toHaveText('Speed 1');
  await expect(slower).toBeDisabled();

  for (let i = 0; i < 10; i++) await page.keyboard.press(']');
  await expect(pill(page)).toHaveText('Speed 10');
  await expect(faster).toBeDisabled();
  // Faster, and still running.
  const from = await scrolled(page);
  await expect.poll(() => scrolled(page)).toBeGreaterThan(from + 30);
  await expect(pill(page)).toBeVisible();
});
