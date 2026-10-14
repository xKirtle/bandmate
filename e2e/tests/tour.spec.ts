import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

// The Tour: taken from About, it shows the Demo Song, one control at a time
// in a spotlight, with a card beside it, and blocks the page under it.

/** The step's card. */
const card = (page: Page) => page.getByRole('dialog');
const next = (page: Page) => card(page).getByRole('button', { name: /^(Next|Finish)$/ });

/** Takes the Tour from About, and waits for its first step, timeout ms at most. */
async function takeTour(page: Page, timeout?: number) {
  await page.goto('/settings/about');
  await page.getByRole('button', { name: 'Take the Tour' }).click();
  await expect(page).toHaveURL(/\/songs\/demo$/);
  await expect(card(page).getByRole('heading', { name: 'Sections' })).toBeVisible({ timeout });
}

test('About offers the Tour beside Source code and Report a bug', async ({ page }) => {
  await page.goto('/settings/about');

  const take = page.getByRole('button', { name: 'Take the Tour' });
  const source = page.getByRole('link', { name: 'Source code' });
  await expect(take).toBeVisible();
  // On the same line.
  expect((await take.boundingBox())!.y).toBeCloseTo((await source.boundingBox())!.y, -1);
});

test('About offers no Tour on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/about');

  await expect(page.getByRole('link', { name: 'Source code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the Tour' })).toHaveCount(0);
});

test('the Tour’s steps show about as fast as a Song opens', async ({ page }) => {
  // No seconds of "Loading…" before a step.
  await takeTour(page, 3_000);
  await next(page).click();
  await expect(card(page).getByRole('heading', { name: 'Lines' })).toBeVisible({ timeout: 3_000 });
});

test('every step spotlights its control on the Demo Song, through to Finish', async ({ page }) => {
  await takeTour(page);

  const titles = [
    'Sections',
    'Lines',
    'Chords',
    'The Arrangement',
    'The Timeline',
    'Recording a Take',
    'Clips',
    'That’s the core of it',
  ];
  for (const [i, title] of titles.entries()) {
    // The card shows once its step's control is on the page, and focus sits on Next.
    await expect(card(page).getByRole('heading', { name: title })).toBeVisible();
    await expect(card(page).getByText(`${i + 1} of 8`)).toBeVisible();
    await expect(next(page)).toBeFocused();
    await expect(card(page).getByRole('button', { name: 'Back' })).toHaveCount(i === 0 ? 0 : 1);
    await expect(card(page).getByRole('button', { name: 'End tour' })).toBeVisible();
    await expect(next(page)).toHaveText(i === titles.length - 1 ? 'Finish' : 'Next');
    await next(page).click();
  }

  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(card(page)).toHaveCount(0);
});

test('the last step points to the docs and to About', async ({ page }) => {
  await takeTour(page);
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');

  await expect(card(page).getByRole('link', { name: 'Open the docs' })).toBeVisible();
  await expect(card(page)).toContainText('Settings › About');
});

test('← and → step back and forward', async ({ page }) => {
  await takeTour(page);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(card(page).getByRole('heading', { name: 'Chords' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(card(page).getByRole('heading', { name: 'Lines' })).toBeVisible();
  await expect(next(page)).toBeFocused();
});

test('the page under the Tour is blocked: clicks, Tab and Shortcuts don’t reach it', async ({ page }) => {
  await takeTour(page);
  const label = page.locator('[data-tour="first-section-head"] input');
  const play = page.locator('[data-tour="timeline"] button.play');

  // The spotlit Label can't be clicked into.
  await label.click({ force: true });
  await expect(label).not.toBeFocused();
  await expect(next(page)).toBeFocused();

  // Tab goes round the card alone.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await card(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  // Space, focused off the card, doesn't play.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await expect(card(page).getByRole('heading', { name: 'Sections' })).toBeVisible();
});

test('Esc ends the Tour, back where it was taken from', async ({ page }) => {
  await takeTour(page);
  await page.keyboard.press('ArrowRight');

  await page.keyboard.press('Escape');

  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(card(page)).toHaveCount(0);
});

test('End tour ends it, back where it was taken from, as the browser’s Back would', async ({ page }) => {
  await page.goto('/');
  await takeTour(page);

  await card(page).getByRole('button', { name: 'End tour' }).click();

  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(page.getByRole('button', { name: 'Take the Tour' })).toBeVisible();
  // About isn't in the history twice.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test('narrowing the window to a phone’s ends it', async ({ page }) => {
  await takeTour(page);

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(card(page)).toHaveCount(0);
});

test('leaving the Demo Song ends it, and coming back to it lands on the Songs page', async ({ page }) => {
  await takeTour(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/about$/);
  await expect(card(page)).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible();
});

test('the Demo Song’s address outside a Tour, a reload included, lands on the Songs page', async ({ page }) => {
  await page.goto('/songs/demo');
  await expect(page).toHaveURL(/\/$/);

  await takeTour(page);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page)).toHaveCount(0);
});
