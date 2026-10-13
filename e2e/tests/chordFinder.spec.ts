import type { Locator, Page } from '@playwright/test';
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

test('Left-handed, set in Settings, mirrors the fretboard: the Chord Finder has no switch of its own', async ({
  page,
}) => {
  await page.goto('/chords');
  await page.getByRole('tab', { name: 'Name it' }).click();
  await expect(firstString(page)).toHaveAccessibleName(/^6th string/);
  await expect(leftHanded(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Left-handed' })).toHaveCount(0);

  await page.goto('/settings');
  await leftHanded(page).check();
  await page.goto('/chords');
  await page.getByRole('tab', { name: 'Name it' }).click();
  await expect(firstString(page)).toHaveAccessibleName(/^1st string/);
});

// Each line a row of things starts on, top to bottom.
async function lines(boxes: Locator) {
  return new Set(await Promise.all((await boxes.all()).map(async (b) => Math.round((await b.boundingBox())!.y))))
    .size;
}

test('on a phone, the tabs keep one row and Look up’s fields fit on two', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/chords');
  expect(await lines(page.getByRole('tab'))).toBe(1);

  const lookUp = page.getByRole('tabpanel', { name: 'Look up' });
  const fields = lookUp.getByRole('textbox', { name: 'Chord' }).or(lookUp.getByRole('combobox'));
  await expect(fields).toHaveCount(4);
  expect(await lines(fields)).toBe(2);
});
