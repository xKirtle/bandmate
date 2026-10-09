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
