import type { Locator, Page } from '@playwright/test';
import { toneWav, uploadBeat } from '../beats';
import { expect, test } from '../fixtures';

// The previewed Beat's mark, in the lists with no waveform to tell it by: the
// Beat Library's wide table, its staged rows, and the Beat Picker. The mark
// follows the Beat preview, not the sound: a paused Beat is still previewed,
// until another is previewed or the preview is put away. Its row is marked
// current for assistive technology, which is what these tests read.

/** Long enough to still be playing when the test pauses it. */
const tone = (name: string) => toneWav(name, 30);

/** The rows marked current in a list. */
const current = (list: Locator) => list.locator('[aria-current="true"]');

/** The table's row for a Beat, found by its title. */
const row = (list: Locator, title: string) => list.getByRole('row').filter({ hasText: title });

async function twoBeats(page: Page) {
  await uploadBeat(page.request, tone('echo.wav'), { title: 'Echo Room' });
  await uploadBeat(page.request, tone('paper.wav'), { title: 'Paper Hours' });
}

test.describe('in the Beat Library', () => {
  const table = (page: Page) => page.getByRole('table');

  test('marks the previewed Beat, playing or paused, and moves the mark to the next one previewed', async ({
    page,
  }) => {
    await twoBeats(page);
    await page.goto('/beats');
    await expect(current(table(page))).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview Echo Room' }).click();
    await expect(page.getByRole('button', { name: 'Pause Echo Room' })).toBeVisible();
    await expect(current(table(page))).toHaveCount(1);
    await expect(row(table(page), 'Echo Room')).toHaveAttribute('aria-current', 'true');

    // Paused, it's still the Beat previewed.
    await page.getByRole('button', { name: 'Pause Echo Room' }).click();
    await expect(page.getByRole('button', { name: 'Preview Echo Room' })).toBeVisible();
    await expect(row(table(page), 'Echo Room')).toHaveAttribute('aria-current', 'true');

    await page.getByRole('button', { name: 'Preview Paper Hours' }).click();
    await expect(page.getByRole('button', { name: 'Pause Paper Hours' })).toBeVisible();
    await expect(current(table(page))).toHaveCount(1);
    await expect(row(table(page), 'Paper Hours')).toHaveAttribute('aria-current', 'true');
  });

  test('deleting the previewed Beat ends its preview', async ({ page }) => {
    await twoBeats(page);
    await page.goto('/beats');
    await page.getByRole('button', { name: 'Preview Echo Room' }).click();
    await expect(row(table(page), 'Echo Room')).toHaveAttribute('aria-current', 'true');

    await page.getByRole('button', { name: 'Edit Echo Room' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('dialog', { name: 'Edit “Echo Room”' }).getByRole('button', { name: 'Delete' }).click();

    await expect(row(table(page), 'Echo Room')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Beat preview' })).toHaveCount(0);
    await expect(current(table(page))).toHaveCount(0);
  });

  test('the player bar closing, as the window narrows, ends the preview', async ({ page }) => {
    await twoBeats(page);
    await page.goto('/beats');
    await page.getByRole('button', { name: 'Preview Echo Room' }).click();
    await expect(row(table(page), 'Echo Room')).toHaveAttribute('aria-current', 'true');

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByRole('region', { name: 'Beat preview' })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });

    await expect(page.getByRole('button', { name: 'Preview Echo Room' })).toBeVisible();
    await expect(current(table(page))).toHaveCount(0);
  });

  test('marks a staged row previewed, and its leaving the batch ends the preview', async ({ page }) => {
    await page.goto('/beats');
    await page.getByLabel('Add Beat', { exact: true }).first().setInputFiles([tone('one.wav'), tone('two.wav')]);
    const batch = page.getByRole('region', { name: 'Add Beats' }).getByRole('table');
    const preview = (name: string) => page.getByRole('button', { name: `Preview “${name}”` });
    await expect(preview('two.wav')).toBeVisible();

    await preview('one.wav').click();
    await expect(page.getByRole('button', { name: 'Pause “one.wav”' })).toBeVisible();
    await expect(row(batch, 'one.wav')).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Pause “one.wav”' }).click();
    await expect(preview('one.wav')).toBeVisible();
    await expect(row(batch, 'one.wav')).toHaveAttribute('aria-current', 'true');

    await preview('two.wav').click();
    await expect(current(batch)).toHaveCount(1);
    await expect(row(batch, 'two.wav')).toHaveAttribute('aria-current', 'true');

    await page.getByRole('button', { name: 'Remove “two.wav”' }).click();
    await expect(current(batch)).toHaveCount(0);
  });
});

test.describe('in the Beat Picker', () => {
  const picker = (page: Page) => page.getByRole('dialog', { name: 'Add a Beat' });

  async function openPicker(page: Page) {
    await page.getByRole('button', { name: 'Beat', exact: true }).click();
    await expect(picker(page)).toBeVisible();
  }

  // Its wide table, and its narrow list.
  for (const [width, listRole, itemRole] of [
    [1440, 'table', 'row'],
    [800, 'list', 'listitem'],
  ] as const) {
    test(`marks the previewed Beat, playing or paused, at ${width}px wide`, async ({ page, bandmate }) => {
      await page.setViewportSize({ width, height: 900 });
      await twoBeats(page);
      const song = await bandmate.song({ title: 'Anthem' });
      await page.goto(`/songs/${song.id}`);
      await openPicker(page);
      const list = (page: Page) => picker(page).getByRole(listRole);
      const item = (title: string) => list(page).getByRole(itemRole).filter({ hasText: title });
      await expect(current(list(page))).toHaveCount(0);

      await picker(page).getByRole('button', { name: 'Preview Echo Room' }).click();
      await expect(picker(page).getByRole('button', { name: 'Pause Echo Room' })).toBeVisible();
      await expect(item('Echo Room')).toHaveAttribute('aria-current', 'true');

      await picker(page).getByRole('button', { name: 'Pause Echo Room' }).click();
      await expect(picker(page).getByRole('button', { name: 'Preview Echo Room' })).toBeVisible();
      await expect(item('Echo Room')).toHaveAttribute('aria-current', 'true');

      await picker(page).getByRole('button', { name: 'Preview Paper Hours' }).click();
      await expect(picker(page).getByRole('button', { name: 'Pause Paper Hours' })).toBeVisible();
      await expect(current(list(page))).toHaveCount(1);
      await expect(item('Paper Hours')).toHaveAttribute('aria-current', 'true');

      // Closing the Picker ends the preview: opened again, nothing is marked.
      await picker(page).getByRole('button', { name: 'Close' }).click();
      await expect(picker(page)).toHaveCount(0);
      await openPicker(page);
      await expect(picker(page).getByRole('button', { name: 'Preview Paper Hours' })).toBeVisible();
      await expect(current(list(page))).toHaveCount(0);
    });
  }
});
