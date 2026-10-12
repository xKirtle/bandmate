import type { Page } from '@playwright/test';
import { failRequests, holdRequests } from '../faults';
import { expect, test } from '../fixtures';

// Settings' Backups: the Scheduled Backups card, over the Backups card, its
// header holding Upload and New Backup once the Backups have loaded, over the
// upload messages and the list.

/** The Backups card, labelled by its heading. */
const card = (page: Page) => page.getByRole('region', { name: 'Backups', exact: true });

/** The Scheduled Backups card, labelled by its heading. */
const scheduleCard = (page: Page) => page.getByRole('region', { name: 'Scheduled Backups' });

/** The card's Upload, a file input behind a label that looks like a button. */
const upload = (page: Page) => card(page).getByText('Upload', { exact: true });

const newBackup = (page: Page) => card(page).getByRole('button', { name: 'New Backup' });

/** The request that lists the Backups. */
const listing = { method: 'GET', url: (url: URL) => url.pathname === '/api/backups' };

test('the Backups card holds Upload and New Backup over the list', async ({ page, bandmate }) => {
  await bandmate.restoreDemo();

  await page.goto('/settings/backups');

  await expect(card(page).getByRole('heading', { name: 'Backups' })).toBeVisible();
  await expect(upload(page)).toBeVisible();
  await expect(newBackup(page)).toBeVisible();
  await expect(card(page).getByRole('listitem')).toHaveCount(1);
  // The Settings header holds only its title.
  await expect(page.getByRole('banner').getByRole('button')).toHaveCount(0);
});

test('with no Backups, the card still offers Upload and New Backup over the empty state', async ({ page }) => {
  await page.goto('/settings/backups');

  await expect(card(page).getByText('No Backups yet.')).toBeVisible();
  await expect(upload(page)).toBeVisible();
  await expect(newBackup(page)).toBeVisible();
});

test('Upload and New Backup wait for the Backups to load', async ({ page }) => {
  const hold = await holdRequests(page, listing);

  await page.goto('/settings/backups');
  await hold.reached;

  await expect(card(page).getByText('Loading…')).toBeVisible();
  await expect(upload(page)).toHaveCount(0);
  await expect(newBackup(page)).toHaveCount(0);

  await hold.release();
  await expect(newBackup(page)).toBeVisible();
});

test("Upload and New Backup don't show when the Backups fail to load", async ({ page }) => {
  await failRequests(page, listing, { error: 'Disk on fire' });

  await page.goto('/settings/backups');

  await expect(card(page).getByRole('alert')).toHaveText('Disk on fire');
  await expect(upload(page)).toHaveCount(0);
  await expect(newBackup(page)).toHaveCount(0);
});

/** The demo Backup's row, by its name, which says it holds everything. */
const demoRow = (page: Page) => card(page).getByRole('listitem').filter({ hasText: 'Everything' });

test("on a phone, a Backup's Restore and Download fold into its ⋯", async ({ page, bandmate }) => {
  await bandmate.restoreDemo();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/settings/backups');

  await expect(demoRow(page).getByRole('button', { name: /^Restore/ })).toHaveCount(0);
  await expect(demoRow(page).getByRole('link', { name: /^Download/ })).toHaveCount(0);
  await demoRow(page).getByRole('button', { name: /^More actions/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Restore…', 'Download', 'Rename…', 'Delete…']);

  // Download is still a link that downloads the Backup's file.
  const download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.bandmate$/);

  await demoRow(page).getByRole('button', { name: /^More actions/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Restore…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test("on a desktop, a Backup's Restore and Download stay beside its ⋯", async ({ page, bandmate }) => {
  await bandmate.restoreDemo();

  await page.goto('/settings/backups');

  await expect(demoRow(page).getByRole('button', { name: /^Restore/ })).toBeVisible();
  await expect(demoRow(page).getByRole('link', { name: /^Download/ })).toBeVisible();
  await demoRow(page).getByRole('button', { name: /^More actions/ }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Rename…', 'Delete…']);
});

test("at 320px, the card's buttons go under its heading, still on the right, and nothing scrolls sideways", async ({
  page,
  bandmate,
}) => {
  await bandmate.restoreDemo();
  await page.setViewportSize({ width: 320, height: 700 });

  await page.goto('/settings/backups');

  const heading = (await card(page).getByRole('heading', { name: 'Backups' }).boundingBox())!;
  const button = (await newBackup(page).boundingBox())!;
  const edge = (await card(page).boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  // Against the card's right edge, but for its padding.
  expect(edge.x + edge.width - (button.x + button.width)).toBeLessThan(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('turning on Scheduled Backups makes one at once, marked Scheduled, says so, and the schedule is kept', async ({
  page,
  bandmate,
}) => {
  await bandmate.song({ title: 'Night Drive' });

  await page.goto('/settings/backups');

  const on = scheduleCard(page).getByRole('switch', { name: 'Make Backups on a schedule' });
  const keep = scheduleCard(page).getByRole('group', { name: 'How many to keep' });
  await expect(on).not.toBeChecked();
  await expect(scheduleCard(page).getByRole('radio', { name: 'Weekly' })).toBeChecked();
  await expect(keep).toContainText('4');

  await scheduleCard(page).getByRole('radio', { name: 'Daily' }).check();
  await keep.getByRole('button', { name: 'Keep one more' }).click();
  await expect(keep).toContainText('5');
  await on.check();

  const row = card(page).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible();
  await expect(row).toContainText('Everything');
  await expect(scheduleCard(page).getByText('Last made just now.')).toBeVisible();

  await page.reload();
  await expect(on).toBeChecked();
  await expect(scheduleCard(page).getByRole('radio', { name: 'Daily' })).toBeChecked();
  await expect(keep).toContainText('5');
});

test('keeping a Scheduled Backup takes away its Scheduled badge and its Keep', async ({ page, bandmate }) => {
  await bandmate.song({ title: 'Night Drive' });
  await page.goto('/settings/backups');
  await scheduleCard(page).getByRole('switch', { name: 'Make Backups on a schedule' }).check();
  const row = card(page).getByRole('listitem');
  await expect(row.getByText('Scheduled', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: /^More actions/ }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Keep', 'Rename…', 'Delete…']);
  await page.getByRole('menu').getByRole('menuitem', { name: 'Keep' }).click();
  await expect(row.getByText('Scheduled', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(row).toContainText('Everything');
  await expect(row.getByText('Scheduled', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: /^More actions/ }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Rename…', 'Delete…']);
});

test('an uploaded Backup is not marked Scheduled', async ({ page, bandmate }) => {
  await bandmate.restoreDemo();

  await page.goto('/settings/backups');

  await expect(demoRow(page)).toBeVisible();
  await expect(demoRow(page).getByText('Scheduled', { exact: true })).toHaveCount(0);
});
