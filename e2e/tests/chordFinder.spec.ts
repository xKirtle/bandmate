import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { customTuningNotes as notes, pickCustomTuning, warnsOnLeaving } from '../songPage';

// The Chord Finder's page, and its tuning field: kept on this device, with
// nothing to save to a Song.

const tuning = (page: Page) => page.getByRole('combobox', { name: 'Tuning' });

test('custom tuning notes are kept on Enter, taken back on Esc, and never ask before leaving', async ({ page }) => {
  await page.goto('/chords');
  await pickCustomTuning(page);
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
  await (await pickCustomTuning(page)).fill('C G D');
  await notes(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'A custom tuning is six notes, low string to high, like D A D G B E',
  );
  await expect(notes(page)).toHaveValue('C G D');
});

// The first string Name it's fretboard draws: the low one, or the high one mirrored.
const firstString = (page: Page) =>
  page.getByRole('group', { name: 'Fretboard' }).getByRole('button', { name: /string: / }).first();
const leftHanded = (page: Page) => page.getByRole('switch', { name: 'Left-handed' });

test('the Left-handed switch beside the tuning mirrors the fretboard, and is the one in Settings', async ({ page }) => {
  await page.goto('/chords');
  await page.getByRole('tab', { name: 'Name it' }).click();
  await expect(firstString(page)).toHaveAccessibleName(/^6th string/);

  await leftHanded(page).check();
  await expect(firstString(page)).toHaveAccessibleName(/^1st string/);

  await page.goto('/settings');
  await expect(leftHanded(page)).toBeChecked();
  await leftHanded(page).uncheck();
  await page.goto('/chords');
  await expect(leftHanded(page)).not.toBeChecked();
});

test('on a phone, the tabs keep one row and the Left-handed switch sits under the tuning', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/chords');
  const tabs = page.getByRole('tab');
  const tops = await Promise.all((await tabs.all()).map(async (t) => (await t.boundingBox())!.y));
  expect(new Set(tops).size).toBe(1);

  const tuningBox = (await tuning(page).boundingBox())!;
  const switchBox = (await leftHanded(page).boundingBox())!;
  expect(switchBox.y).toBeGreaterThanOrEqual(tuningBox.y + tuningBox.height);
  // And above the Chord Finder's card.
  expect(switchBox.y).toBeLessThan((await tabs.first().boundingBox())!.y);
  // Only the switch and its label take a tap, not the rest of the line.
  const row = (await page.locator('label', { has: leftHanded(page) }).boundingBox())!;
  expect(row.width).toBeLessThan(200);

  // A custom tuning's notes stay with the tuning, above the switch.
  await pickCustomTuning(page);
  const notesBox = (await notes(page).boundingBox())!;
  expect((await leftHanded(page).boundingBox())!.y).toBeGreaterThanOrEqual(notesBox.y + notesBox.height);
});
