import { expect, test } from '../fixtures';

// Settings' Shortcuts tab: every Shortcut, in its group's card, each a fold
// opening to what it does and where it works, with the shortcuts dialog's
// search. The dialog's Change keys leads to it. A keyboard and mouse's
// alone, so a phone opens This device at its address.

test('the Shortcuts tab lists every Shortcut in its group, each a fold opening to what it does and where', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Shortcuts' }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts$/);
  await expect(page.getByText('Kept on this device. Each key does one thing, anywhere on a Song page.')).toBeVisible();

  const editing = page.getByRole('region', { name: 'Timeline editing' });
  const seek = editing.locator('details', {
    hasText: 'Seek back or forward 5 s',
  });
  await expect(seek.getByText('Moves the playhead 5 seconds.')).toBeHidden();
  await seek.getByText('Seek back or forward 5 s').click();
  await expect(seek.getByText('Moves the playhead 5 seconds.')).toBeVisible();
  await expect(seek.getByText('Works in the ruler, once it has focus.')).toBeVisible();

  // ? opens the shortcuts dialog, and is listed as a Shortcut of its own.
  const show = page.getByRole('region', { name: 'Song editing' }).locator('details', { hasText: 'Show the Shortcuts' });
  await expect(show.locator('kbd')).toHaveText(['?']);
});

test("the Shortcuts tab's search narrows them down as the dialog's does", async ({ page }) => {
  await page.goto('/settings/shortcuts');
  const search = page.getByRole('searchbox', {
    name: 'Search Shortcuts by name, what they do or key',
  });
  await search.fill('split');
  await expect(page.locator('summary')).toHaveText([/Split at the playhead/]);
  await expect(page.getByRole('region')).toHaveCount(1);
  await search.fill('metronome');
  await expect(page.getByText('No Shortcuts match.')).toBeVisible();
});

test("the shortcuts dialog's Change keys opens the Shortcuts tab", async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog.getByText('Show the Shortcuts')).toBeVisible();
  await dialog.getByRole('link', { name: 'Change keys' }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('on a phone, Settings has no Shortcuts tab, and its address opens This device', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/shortcuts');
  await expect(page).toHaveURL(/\/settings$/);
  const tabs = page.getByRole('navigation', { name: 'Settings' }).getByRole('link');
  await expect(tabs).toHaveText(['This device', 'Backups', 'About']);
});
