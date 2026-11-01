import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clip, dragTo, heroSong, timeline, trackHead } from '../songPage';

// A Clip's border and waveform in its Track's Track Colour, on the demo
// Backup's hero Song: the Beat's Clip on the Beat Track, its first, and Take
// 2 on the Lead vox Track, its second. A shade is compared with the token as
// the page holds it, as the shades change with the Palette and the theme.

/** A colour token as the browser draws it, whichever way the token is written. */
const drawn = (page: Page, token: string) =>
  page.evaluate((token) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = `var(${token})`;
    const { color } = getComputedStyle(probe);
    probe.remove();
    return color;
  }, token);

const borderOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).borderTopColor);

const waveformOf = (c: Locator) => c.locator('.wave rect').first().evaluate((el) => getComputedStyle(el).fill);

/** Expects a Clip's border and waveform to be in a token's colour. */
async function expectDrawnIn(page: Page, c: Locator, token: string) {
  const colour = await drawn(page, token);
  await expect.poll(() => borderOf(c)).toBe(colour);
  await expect.poll(() => waveformOf(c)).toBe(colour);
}

test("a Clip's border and waveform are in its Track's colour, and never the accent", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  await expectDrawnIn(page, clip(page, 'Lorem Click'), '--track-colour-1');
  await expectDrawnIn(page, clip(page, 'Take 2'), '--track-colour-2');
  expect(await borderOf(clip(page, 'Take 2'))).not.toBe(await drawn(page, '--accent'));
});

for (const [palette, theme] of [
  ['ink', 'dark'],
  ['olive', 'light'],
]) {
  test(`a Clip's colour follows the ${palette} Palette in ${theme}`, async ({ page, bandmate }) => {
    await page.addInitScript(
      ([palette, theme]) => {
        localStorage.setItem('bandmate.palette', palette);
        localStorage.setItem('bandmate.theme', theme);
      },
      [palette, theme],
    );
    const hero = await heroSong(bandmate);
    await page.goto(`/songs/${hero.id}`);

    await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectDrawnIn(page, clip(page, 'Take 2'), '--track-colour-2');
  });
}

test('a selected Clip keeps its Track Colour, inside the accent ring and fill', async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toBeVisible();
  const unselected = await take.evaluate((el) => getComputedStyle(el).backgroundColor);
  const accent = await drawn(page, '--accent');

  await take.click({ modifiers: ['ControlOrMeta'] });

  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expectDrawnIn(page, take, '--track-colour-2');
  expect(await take.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(accent);
  expect(await take.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(unselected);
});

test("a Clip moved to another Track takes that Track's colour", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expectDrawnIn(page, take, '--track-colour-2');
  await timeline(page).getByRole('button', { name: 'Add a Track' }).click();
  await expect(timeline(page).locator('.lane')).toHaveCount(3);

  const box = (await take.boundingBox())!;
  const lane = (await timeline(page).locator('.lane').nth(2).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragTo(page, from, { x: from.x, y: lane.y + lane.height / 2 });

  await expect(timeline(page).locator('.lane').nth(2).locator('.clip')).toHaveCount(1);
  await expectDrawnIn(page, take, '--track-colour-3');
});

test("a Track's header shows no colour, and the Chosen Track's is marked in the accent", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  const chosen = trackHead(page, 'Lead vox');
  await expect(chosen).toHaveAttribute('aria-current', 'true');
  const shades = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => drawn(page, `--track-colour-${n}`)));
  const painted = await chosen.evaluate((el) => {
    const { backgroundColor, borderLeftColor, boxShadow, color } = getComputedStyle(el);
    return [backgroundColor, borderLeftColor, boxShadow, color].join(' ');
  });

  expect(painted).toContain(await drawn(page, '--accent'));
  for (const shade of shades) expect(painted).not.toContain(shade);
});
