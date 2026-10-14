import type { Sheet } from '../bandmate';
import { expect, test } from '../fixtures';
import { redoButton, undoButton } from '../songPage';

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
  await expect(dialog.getByText(/^Differs:\s*Waves in the dark$/)).toBeVisible();
  await expect(dialog.getByText(/^Differs:\s*Lights on the water$/)).toBeVisible();
  await expect(dialog.getByText('Salt on the window', { exact: true })).toHaveCount(2);
  await expect(dialog.getByText(/^Differs:\s*Salt on the window$/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Restore this Snapshot' }).click();
  await expect(dialog).toBeHidden();
  const lines = page.getByRole('article', { name: 'Verse' }).getByRole('textbox').first();
  await expect(lines).toHaveValue('Salt on the window\nWaves in the dark');
  const taken = (await bandmate.snapshots(song.id)).length;

  // Undo puts back the sheet from before the restore, taking no Snapshot;
  // Redo restores it again.
  await undoButton(page).click();
  await expect(lines).toHaveValue('Salt on the window\nLights on the water');
  await expect
    .poll(async () => {
      const { sections } = (await bandmate.getSong(song.id)) as unknown as Sheet;
      return sections[0].alternates[0].lines.map((l) => l.text);
    })
    .toEqual(['Salt on the window', 'Lights on the water']);
  expect(await bandmate.snapshots(song.id)).toHaveLength(taken);
  await redoButton(page).click();
  await expect(lines).toHaveValue('Salt on the window\nWaves in the dark');
});
