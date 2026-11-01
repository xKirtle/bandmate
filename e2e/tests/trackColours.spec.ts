import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clip, drawnColour, dragTo, heroSong, timeline, trackHead } from '../songPage';

// A Clip's border in its Track's Track Colour, on the demo Backup's hero
// Song: the Beat's Clip on the Beat Track, its first, and Take 2 on the Lead
// vox Track, its second. A shade is compared with the token as the page holds
// it, as the shades change with the Palette and the theme. A waveform is
// hidden from a screen reader, so palettes.test.ts checks it takes the same
// colour.

const borderOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).borderTopColor);

/** Expects a Clip's border to be in a token's colour. */
async function expectBorderIn(page: Page, c: Locator, token: string) {
  const colour = await drawnColour(page, token);
  await expect.poll(() => borderOf(c)).toBe(colour);
}

test("a Clip's border is in its Track's colour, and never the accent", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  await expectBorderIn(page, clip(page, 'Lorem Click'), '--track-colour-1');
  await expectBorderIn(page, clip(page, 'Take 2'), '--track-colour-2');
  expect(await borderOf(clip(page, 'Take 2'))).not.toBe(await drawnColour(page, '--accent'));
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
    await expectBorderIn(page, clip(page, 'Take 2'), '--track-colour-2');
  });
}

test('a selected Clip keeps its Track Colour, inside the accent ring and fill', async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toBeVisible();
  const unselected = await take.evaluate((el) => getComputedStyle(el).backgroundColor);
  const accent = await drawnColour(page, '--accent');

  await take.click({ modifiers: ['ControlOrMeta'] });

  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expectBorderIn(page, take, '--track-colour-2');
  expect(await take.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(accent);
  expect(await take.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(unselected);
});

test("a Clip moved to another Track takes that Track's colour", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expectBorderIn(page, take, '--track-colour-2');
  await timeline(page).getByRole('button', { name: 'Add a Track' }).click();
  const added = trackHead(page, 'Track 3');
  await expect(added).toBeVisible();

  const box = (await take.boundingBox())!;
  const head = (await added.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragTo(page, from, { x: from.x, y: head.y + head.height / 2 });

  const clipsOnTheNewTrack = async () =>
    (await bandmate.timeline(hero.id)).tracks.find((t) => t.name === 'Track 3')!.clips.length;
  await expect.poll(clipsOnTheNewTrack).toBe(1);
  await expectBorderIn(page, take, '--track-colour-3');
});

test("a Track's header shows no colour, and the Chosen Track's is marked in the accent", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  const chosen = trackHead(page, 'Lead vox');
  await expect(chosen).toHaveAttribute('aria-current', 'true');
  const shades = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => drawnColour(page, `--track-colour-${n}`)));
  const painted = await chosen.evaluate((el) => {
    const { backgroundColor, borderLeftColor, boxShadow, color } = getComputedStyle(el);
    return [backgroundColor, borderLeftColor, boxShadow, color].join(' ');
  });

  expect(painted).toContain(await drawnColour(page, '--accent'));
  for (const shade of shades) expect(painted).not.toContain(shade);
});
