import type { Page } from '@playwright/test';
import { failRequests, holdRequests } from '../faults';
import { expect, test } from '../fixtures';

// Settings' Backups: one card, its header holding Upload and New Backup once
// the Backups have loaded, over the upload messages and the list.

/** The Backups card, labelled by its heading. */
const card = (page: Page) => page.getByRole('region', { name: 'Backups' });

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
