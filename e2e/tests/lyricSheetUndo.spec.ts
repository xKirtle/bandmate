import type { Page } from '@playwright/test';
import type { Bandmate, Sheet } from '../bandmate';
import { expect, test } from '../fixtures';
import { heroSong, redoButton, syncButton, undoButton } from '../songPage';

// Undo on the Lyric Sheet and Scrapbook: deleting asks nothing, as Undo
// brings back what was deleted, showing it, and undoing ends Sync mode.
// Undoing a Snapshot restore is pinned with the Snapshots.

/** The ids of a Song's Sections in its Scrapbook, as the server has them. */
const serverScrapbook = async (bandmate: Bandmate, songId: number) =>
  ((await bandmate.getSong(songId)) as unknown as Sheet).scrapbook;

/** Moves focus out of any text field, so Ctrl+Z is the Song's. */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test('deleting a Scrapbook Section asks nothing, and Ctrl+Z brings it back into view, its fold opened, ending Sync mode', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  let sheet = await bandmate.addSection(song.id, 'Night swim', 'scrapbook');
  const idea = sheet.sections.find((s) => s.label === 'Night swim')!;
  sheet = await bandmate.setLines(song.id, idea.alternates[0].id, 'Under the pier');
  const line = sheet.sections.find((s) => s.id === idea.id)!.alternates[0].lines[0];
  await page.goto(`/songs/${song.id}`);
  await expect(syncButton(page)).toBeEnabled();

  const card = page.getByRole('button', { name: /^Night swim/ });
  await card.click();
  await page.getByRole('article', { name: 'Night swim' }).getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => serverScrapbook(bandmate, song.id)).not.toContain(idea.id);

  // The Scrapbook folded, and Sync mode on.
  await page.locator('summary', { hasText: 'Scrapbook' }).click();
  await syncButton(page).click();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'true');
  await blur(page);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(card).toBeInViewport();
  await expect(syncButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => serverScrapbook(bandmate, song.id)).toContain(idea.id);
  // Back under its ids.
  const back = ((await bandmate.getSong(song.id)) as unknown as Sheet).sections.find((s) => s.id === idea.id)!;
  expect(back.alternates[0].lines).toMatchObject([{ id: line.id, text: 'Under the pier' }]);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(card).toHaveCount(0);
  await expect.poll(() => serverScrapbook(bandmate, song.id)).not.toContain(idea.id);
});

test('deleting an Alternate asks nothing, and Undo brings it back', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Harbour' });
  const sheet = await bandmate.addSection(song.id, 'Chorus');
  await bandmate.setLines(song.id, sheet.sections[0].alternates[0].id, 'Lanterns on the quay');
  await page.goto(`/songs/${song.id}`);

  const chorus = page.getByRole('article', { name: 'Chorus' });
  await chorus.getByRole('button', { name: 'Alternates' }).click();
  await chorus.getByRole('button', { name: 'New Alternate' }).click();
  const alternates = chorus.getByRole('radio');
  await expect(chorus.getByRole('radio', { name: 'Alternate 2' })).toBeChecked();

  // Alternates are named by their place, so the one left is Alternate 1.
  await chorus.getByRole('button', { name: 'More actions for Alternate 1' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(alternates).toHaveCount(1);

  await undoButton(page).click();
  await expect(alternates).toHaveCount(2);
  await expect(chorus.getByRole('radio', { name: 'Alternate 2' })).toBeChecked();
  await expect(chorus.getByText('Lanterns on the quay')).toHaveCount(2);
  await redoButton(page).click();
  await expect(alternates).toHaveCount(1);
});
