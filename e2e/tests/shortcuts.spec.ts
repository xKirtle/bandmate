import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

// Settings' Shortcuts tab: every Shortcut, in its group's card, each a fold
// opening to what it does and where it works, with the shortcuts dialog's
// search. The dialog's Change keys leads to it. Shortcuts are for a
// keyboard and mouse, so a phone opens This device at its address.

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

/** A Shortcut's fold in the Shortcuts tab, by its name. */
const fold = (page: Page, name: string) =>
  page.locator('details', { has: page.locator('summary .name', { hasText: new RegExp(`^${name}$`) }) });

/** Opens a Shortcut's fold. */
async function open(page: Page, name: string) {
  await fold(page, name).locator('summary').click();
}

test("a key is changed by clicking it and pressing another, Esc cancelling, and it's kept on this device", async ({
  page,
}) => {
  await page.goto('/settings/shortcuts');
  await open(page, 'Record');
  const record = fold(page, 'Record');

  // Esc cancels, leaving it as it was.
  await record.getByRole('button', { name: 'Change R' }).click();
  await expect(record.getByRole('button', { name: 'Press a key' })).toBeFocused();
  await page.keyboard.press('Shift');
  await expect(record.getByRole('button', { name: 'Press a key' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(record.getByRole('button', { name: 'Change R' })).toBeVisible();
  await expect(record.locator('summary')).not.toContainText('Changed');

  await record.getByRole('button', { name: 'Change R' }).click();
  await page.keyboard.press('Shift+T');
  await expect(record.getByRole('button', { name: 'Change Shift+T' })).toBeVisible();
  await expect(record.locator('summary')).toContainText('Changed');
  await expect(record.locator('summary kbd')).toHaveText(['Shift+T']);

  // A second key, then none at all.
  await record.getByRole('button', { name: 'Add key' }).click();
  await page.keyboard.press('k');
  await expect(record.locator('summary kbd')).toHaveText(['Shift+T', 'K']);
  await record.getByRole('button', { name: 'Remove Shift+T' }).click();
  await record.getByRole('button', { name: 'Remove K' }).click();
  await expect(record.locator('summary')).toContainText('No key');

  await page.reload();
  await expect(fold(page, 'Record').locator('summary')).toContainText('No key');
  await expect(fold(page, 'Record').locator('summary')).toContainText('Changed');
});

test("a two-way Shortcut's Back and Forward keys change on their own", async ({ page }) => {
  await page.goto('/settings/shortcuts');
  await open(page, 'Go to the start or end');
  const ends = fold(page, 'Go to the start or end');
  await ends.getByRole('group', { name: 'Forward' }).getByRole('button', { name: 'Change End' }).click();
  await page.keyboard.press('Alt+e');
  await expect(ends.getByRole('group', { name: 'Forward' }).getByRole('button', { name: /^Change/ })).toHaveText([
    'Alt+E',
  ]);
  await expect(ends.getByRole('group', { name: 'Back' }).getByRole('button', { name: /^Change/ })).toHaveText([
    'Home',
  ]);
});

test('a key another Shortcut has is refused, naming it, and the name leads there', async ({ page }) => {
  await page.goto('/settings/shortcuts');
  await open(page, 'Record');
  const record = fold(page, 'Record');
  await record.getByRole('button', { name: 'Change R' }).click();
  await page.keyboard.press('s');
  await expect(record.getByRole('status')).toHaveText('S is already used by Split at the playhead.');

  // It keeps listening: a key that can't be chosen says why, and the next one taken clears it.
  await page.keyboard.press('Tab');
  await expect(record.getByRole('status')).toHaveText("Tab can't be chosen: it moves between controls.");
  await page.keyboard.press('ControlOrMeta+w');
  await expect(record.getByRole('status')).toContainText("can't be chosen: the browser keeps it.");
  await page.keyboard.press('Enter');
  await expect(record.getByRole('status')).toContainText("Enter can't be chosen on its own");
  await page.keyboard.press('Escape');
  await expect(record.getByRole('status')).toHaveCount(0);

  await record.getByRole('button', { name: 'Change R' }).click();
  await page.keyboard.press('s');
  await record.getByRole('button', { name: 'Split at the playhead' }).click();
  const split = fold(page, 'Split at the playhead');
  await expect(split).toHaveAttribute('open', '');
  await expect(split.locator('summary')).toBeFocused();
  await expect(record.getByRole('status')).toHaveCount(0);
});

test('a refusal clears once focus leaves, or its fold closes', async ({ page }) => {
  await page.goto('/settings/shortcuts');
  await open(page, 'Undo');
  const undo = fold(page, 'Undo');
  await undo.getByRole('button', { name: /^Change/ }).click();
  await page.keyboard.press('s');
  await expect(undo.getByRole('status')).toBeVisible();
  await page.getByRole('searchbox').click();
  await expect(undo.getByRole('status')).toHaveCount(0);

  await undo.getByRole('button', { name: /^Change/ }).click();
  await page.keyboard.press('s');
  await expect(undo.getByRole('status')).toBeVisible();
  await undo.locator('summary').click();
  await undo.locator('summary').click();
  await expect(undo.getByRole('status')).toHaveCount(0);
});

test("a Shortcut's Reset is refused while another has its default, and Reset to defaults puts every one back", async ({
  page,
}) => {
  await page.goto('/settings/shortcuts');
  await open(page, 'Split at the playhead');
  const split = fold(page, 'Split at the playhead');
  await split.getByRole('button', { name: 'Change S' }).click();
  await page.keyboard.press('k');
  await open(page, 'Record');
  const record = fold(page, 'Record');
  await record.getByRole('button', { name: 'Change R' }).click();
  await page.keyboard.press('s');
  await expect(record.locator('summary kbd')).toHaveText(['S']);

  await split.getByRole('button', { name: 'Reset' }).click();
  await expect(split.getByRole('status')).toHaveText("Can't reset: S is used by Record.");
  await page.keyboard.press('Escape');
  await expect(split.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(record.locator('summary kbd')).toHaveText(['R']);
  await expect(split.locator('summary kbd')).toHaveText(['S']);
  await expect(page.getByText('Changed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
});

test("keys changed show in the device's other tabs at once", async ({ page, context }) => {
  await page.goto('/settings/shortcuts');
  const other = await context.newPage();
  await other.goto('/settings/shortcuts');
  await open(page, 'Record');
  await fold(page, 'Record').getByRole('button', { name: 'Change R' }).click();
  await page.keyboard.press('t');
  await expect(fold(other, 'Record').locator('summary kbd')).toHaveText(['T']);
});

test('a Shortcut whose default the user already took arrives with no key, marked New until opened', async ({
  page,
}) => {
  // As though Record came in a later release, after Undo was given R.
  await page.goto('/settings/shortcuts');
  await page.evaluate(() =>
    localStorage.setItem('bandmate.shortcutKeys', JSON.stringify({ keys: { undo: { keys: [{ key: 'r' }] } } })),
  );
  await page.reload();
  const record = fold(page, 'Record');
  await expect(record.locator('summary')).toContainText('New');
  await expect(record.locator('summary')).toContainText('No key');
  await expect(fold(page, 'Undo').locator('summary kbd')).toHaveText(['R']);
  await open(page, 'Record');
  await expect(record.locator('summary')).not.toContainText('New');
  await page.reload();
  await expect(fold(page, 'Record').locator('summary')).not.toContainText('New');
  await expect(fold(page, 'Record').locator('summary')).toContainText('No key');
});

test('the Song page uses and names the keys as rebound', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto('/settings/shortcuts');
  await open(page, 'Show the Shortcuts');
  await fold(page, 'Show the Shortcuts').getByRole('button', { name: 'Change ?' }).click();
  await page.keyboard.press('Shift+K');
  await open(page, 'Undo');
  await fold(page, 'Undo').getByRole('button', { name: /^Change/ }).click();
  await page.keyboard.press('Alt+u');

  await page.goto(`/songs/${song.id}`);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', /\(Alt\+U\)$/);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Alt+U');
  await page.keyboard.press('Shift+/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Shift+K');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Show the Shortcuts' }).locator('kbd')).toHaveText([
    'Shift+K',
  ]);
});
