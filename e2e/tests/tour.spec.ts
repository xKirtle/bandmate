import type { Page } from '@playwright/test';
import type { Bandmate } from '../bandmate';
import { expect, test } from '../fixtures';

// The Tour: taken from the Songs page, it shows the Demo Song, one control at
// a time in a spotlight, with a card beside it, and blocks the page under it.

/** The step's card. */
const card = (page: Page) => page.getByRole('dialog');
const next = (page: Page) => card(page).getByRole('button', { name: /^(Next|Finish)$/ });
/** The Songs page's header, beside whose title the Tour is taken. */
const header = (page: Page) => page.getByRole('banner');

/** Where takeTour takes the Tour from: the Songs page, searched. */
const takenFrom = /\/\?q=light$/;

/**
 * Takes the Tour from the Songs page's header, searched for its one Song, which
 * keeps the offer from showing there instead, and waits for its first step,
 * timeout ms at most.
 */
async function takeTour(page: Page, bandmate: Bandmate, timeout?: number) {
  await bandmate.song({ title: 'Morning Light' });
  await page.goto('/?q=light');
  await header(page).getByRole('button', { name: 'Take the Tour' }).click();
  await expect(page).toHaveURL(/\/songs\/demo$/);
  await expect(card(page).getByRole('heading', { name: 'Sections' })).toBeVisible({ timeout });
}

test('the Songs page offers the Tour beside its title, and About doesn’t', async ({ page, bandmate }) => {
  await bandmate.song({ title: 'Morning Light' });
  await page.goto('/');

  const take = header(page).getByRole('button', { name: 'Take the Tour' });
  const title = header(page).getByRole('heading', { name: 'Songs' });
  await expect(take).toBeVisible();
  // On the same line, just after the title.
  const [takeBox, titleBox] = [(await take.boundingBox())!, (await title.boundingBox())!];
  expect(takeBox.y + takeBox.height / 2).toBeCloseTo(titleBox.y + titleBox.height / 2, -1);
  expect(takeBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
  expect(takeBox.x).toBeLessThan(titleBox.x + titleBox.width + 100);

  await page.goto('/settings/about');
  await expect(page.getByRole('link', { name: 'Source code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the Tour' })).toHaveCount(0);
});

test('the Songs page offers no Tour on a phone', async ({ page, bandmate }) => {
  await bandmate.song({ title: 'Morning Light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Morning Light' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the Tour' })).toHaveCount(0);
});

test('a new install’s offer has the Tour, not the header, until it’s turned down', async ({ page }) => {
  // The worker's Bandmate is a new install: nothing has turned the offer down yet.
  await page.goto('/');

  const offer = page.getByText('New here?');
  await expect(offer.getByRole('button', { name: 'Take the Tour' })).toBeVisible();
  await expect(header(page).getByRole('button', { name: 'Take the Tour' })).toHaveCount(0);

  await offer.getByRole('button', { name: 'No thanks' }).click();

  await expect(offer).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Take the Tour' })).toBeVisible();
});

test('the Tour’s steps show about as fast as a Song opens', async ({ page, bandmate }) => {
  // No seconds of "Loading…" before a step.
  await takeTour(page, bandmate, 3_000);
  await next(page).click();
  await expect(card(page).getByRole('heading', { name: 'Lines' })).toBeVisible({ timeout: 3_000 });
});

test('every step spotlights its control on the Demo Song, through to Finish', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);

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

  await expect(page).toHaveURL(takenFrom);
  await expect(card(page)).toHaveCount(0);
});

test('the last step points to the docs and to the Songs page', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');

  await expect(card(page).getByRole('link', { name: 'Open the docs' })).toBeVisible();
  await expect(card(page)).toContainText('take this Tour again any time from the Songs page');
});

test('← and → step back and forward', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(card(page).getByRole('heading', { name: 'Chords' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(card(page).getByRole('heading', { name: 'Lines' })).toBeVisible();
  await expect(next(page)).toBeFocused();
});

test('the page under the Tour is blocked: clicks, Tab and Shortcuts don’t reach it', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);
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

test('Esc ends the Tour, back where it was taken from', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);
  await page.keyboard.press('ArrowRight');

  await page.keyboard.press('Escape');

  await expect(page).toHaveURL(takenFrom);
  await expect(card(page)).toHaveCount(0);
});

test('End tour ends it, back where it was taken from, as the browser’s Back would', async ({ page, bandmate }) => {
  await page.goto('/settings/about');
  await takeTour(page, bandmate);

  await card(page).getByRole('button', { name: 'End tour' }).click();

  await expect(page).toHaveURL(takenFrom);
  await expect(page.getByRole('searchbox')).toHaveValue('light');
  await expect(header(page).getByRole('button', { name: 'Take the Tour' })).toBeVisible();
  // The Songs page isn't in the history twice.
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/about$/);
});

test('narrowing the window to a phone’s ends it', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page).toHaveURL(takenFrom);
  await expect(card(page)).toHaveCount(0);
});

test('leaving the Demo Song ends it, and coming back to it lands on the Songs page', async ({ page, bandmate }) => {
  await takeTour(page, bandmate);

  await page.goBack();
  await expect(page).toHaveURL(takenFrom);
  await expect(card(page)).toHaveCount(0);

  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible();
});

test('the Demo Song’s address outside a Tour, a reload included, lands on the Songs page', async ({ page, bandmate }) => {
  await page.goto('/songs/demo');
  await expect(page).toHaveURL(/\/$/);

  await takeTour(page, bandmate);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page)).toHaveCount(0);
});
