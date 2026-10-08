import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { warnsOnLeaving } from '../songPage';

// The Chord Finder's page, and its tuning field: kept on this device, with
// nothing to save to a Song.

const tuning = (page: Page) => page.getByRole('combobox', { name: 'Tuning' });
const notes = (page: Page) => page.getByRole('textbox', { name: 'Custom tuning: six notes, low string to high' });

test('custom tuning notes are kept on Enter, taken back on Esc, and never ask before leaving', async ({ page }) => {
  await page.goto('/chords');
  await tuning(page).click();
  await page.getByRole('option', { name: 'Custom' }).click();
  await expect(notes(page)).toBeFocused();
  await expect(notes(page)).toHaveValue('E A D G B E');

  // Typed, they're nothing to save.
  await notes(page).fill('c g d g b d');
  expect(await warnsOnLeaving(page)).toBe(false);
  await notes(page).press('Enter');
  await expect(notes(page)).toHaveValue('C G D G B D');

  // Esc takes back what's typed since.
  await notes(page).fill('D G D G B D');
  await notes(page).press('Escape');
  await expect(notes(page)).toHaveValue('C G D G B D');

  // Kept on this device, the tuning's there on a reload.
  await page.reload();
  await expect(tuning(page)).toHaveText('Custom');
  await expect(notes(page)).toHaveValue('C G D G B D');
});

test('custom tuning notes that can’t be read say so, and are kept to fix', async ({ page }) => {
  await page.goto('/chords');
  await tuning(page).click();
  await page.getByRole('option', { name: 'Custom' }).click();
  await notes(page).fill('C G D');
  await notes(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'A custom tuning is six notes, low string to high, like D A D G B E',
  );
  await expect(notes(page)).toHaveValue('C G D');
});
