import { expect, test } from '../fixtures';

// A Song's Snapshots, opened from Write mode: an older one set beside the
// Song as it is now, then restored.

test('an older Snapshot shows a Line that differs from now, and restoring it changes the Lyric Sheet', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Tides' });
  let sheet = await bandmate.addSection(song.id, 'Verse');
  const verse = sheet.sections[0].alternates[0];
  await bandmate.setLines(song.id, verse.id, 'Salt on the window\nWaves in the dark');

  // Each Scrapbook Section deleted takes a Snapshot first: the older one
  // holds the Verse as first written, the newer one as rewritten.
  const deleteAnIdea = async () => {
    sheet = await bandmate.addSection(song.id, 'Idea', 'scrapbook');
    await bandmate.deleteSection(song.id, sheet.scrapbook[0]);
  };
  await deleteAnIdea();
  await bandmate.setLines(song.id, verse.id, 'Salt on the window\nLights on the water');
  await deleteAnIdea();

  await page.goto(`/songs/${song.id}`);
  await page.getByRole('button', { name: 'Snapshots' }).click();
  const dialog = page.getByRole('dialog', { name: 'Snapshots' });
  await dialog.getByRole('button', { name: 'Older Snapshot' }).click();

  // The Line as it was, beside the Line now, each marked as differing; the
  // Line that's the same isn't.
  await expect(dialog.getByText('This Snapshot, Today')).toBeVisible();
  await expect(dialog.locator('.differs', { hasText: 'Waves in the dark' })).toBeVisible();
  await expect(dialog.locator('.differs', { hasText: 'Lights on the water' })).toBeVisible();
  await expect(dialog.locator('.differs', { hasText: 'Salt on the window' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Restore this Snapshot' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('article', { name: 'Verse' }).getByRole('textbox').first()).toHaveValue(
    'Salt on the window\nWaves in the dark',
  );
});
