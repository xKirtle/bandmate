import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  clip,
  drawnColour,
  dragTo,
  fadeDot,
  gainLine,
  heroSong,
  middleOf,
  serverClips,
  timeline,
  trackHead,
  trimEdge,
} from '../songPage';

// A Clip's border in its Track's Track Colour, on the demo Backup's hero
// Song: the Beat's Clip on the Beat Track, its first, and Take 2 on the Lead
// vox Track, its second. A shade is compared with the token as the page holds
// it, as the shades change with the Palette and the theme. A waveform is
// hidden from a screen reader, so palettes.test.ts checks it takes the same
// colour. So are a Clip's Fade slopes, which are found as the only lines
// drawn on it.

const borderOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).borderTopColor);

/** The colour a Clip's gain line or fade dot is drawn in. */
const markOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);

/** The colours of what's drawn in lines inside a Clip: its Fade slopes, while nothing else shows one. */
const strokesOn = (c: Locator) =>
  c.evaluate((el) =>
    [...el.querySelectorAll('*')]
      .filter((inside) => inside.checkVisibility())
      .map((inside) => getComputedStyle(inside).stroke)
      .filter((stroke) => stroke !== 'none'),
  );

/** Every colour that shows on something and inside it, drawn by an element or its ::before. What's see-through or hidden doesn't count. */
const coloursOn = (c: Locator) =>
  c.evaluate((el) => {
    const shown = [el, ...el.querySelectorAll('*')].filter((inside) =>
      inside.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    );
    return shown.flatMap((inside) =>
      [getComputedStyle(inside), getComputedStyle(inside, '::before')].flatMap((style) => [
        style.color,
        style.backgroundColor,
        style.borderTopColor,
        style.outlineColor,
        style.fill,
        style.stroke,
        style.boxShadow,
      ]),
    );
  });

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

test("a Clip's Fade slopes and changed Gain line are in its Track's colour, and nothing on it at rest is in the accent", async ({
  page,
  bandmate,
}) => {
  const hero = await heroSong(bandmate);
  const [placed] = await serverClips(bandmate, hero.id, 'Lead vox');
  await bandmate.setClipGain(hero.id, placed.id, -6);
  await bandmate.setClipFades(hero.id, placed.id, 3, 3);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25, −6 dB, fade in 3 s, fade out 3 s');
  const shade = await drawnColour(page, '--track-colour-2');

  expect(await strokesOn(take)).toEqual([shade, shade]);
  expect(await markOf(gainLine(take))).toBe(shade);
  expect(await coloursOn(take)).not.toContain(await drawnColour(page, '--accent'));
});

test("a Clip's unchanged Gain line stays muted", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  expect(await markOf(gainLine(clip(page, 'Take 2')))).toBe(await drawnColour(page, '--text-muted'));
});

test("a Clip's Gain line is in the accent while it's hovered or dragged, and back in its Track's colour after", async ({
  page,
  bandmate,
}) => {
  const hero = await heroSong(bandmate);
  const [placed] = await serverClips(bandmate, hero.id, 'Lead vox');
  await bandmate.setClipGain(hero.id, placed.id, -6);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  const line = gainLine(take);
  await expect(line).toBeVisible();
  const accent = await drawnColour(page, '--accent');

  await line.hover();
  await expect.poll(() => markOf(line)).toBe(accent);

  // Dragged, it stays in the accent with the pointer off it and off the Clip.
  const from = await middleOf(line);
  const { height } = (await take.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - height / 8, { steps: 4 });
  await page.mouse.move(from.x, from.y - height * 2, { steps: 4 });
  expect(await markOf(line)).toBe(accent);
  await page.mouse.up();

  await page.mouse.move(0, 0);
  await expect.poll(() => markOf(line)).toBe(await drawnColour(page, '--track-colour-2'));
});

test("a Clip's fade dots, a hovered trim edge and a hovered menu button are in the accent", async ({
  page,
  bandmate,
}) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toBeVisible();
  const accent = await drawnColour(page, '--accent');

  await take.hover();
  await expect(fadeDot(take, 'Fade in')).toHaveCSS('opacity', '1');
  expect(await markOf(fadeDot(take, 'Fade in'))).toBe(accent);
  expect(await markOf(fadeDot(take, 'Fade out'))).toBe(accent);

  const end = trimEdge(take, 'end');
  await end.hover();
  await expect(end).toHaveCSS('background-color', accent);

  const menu = take.getByRole('button', { name: 'More actions for Take 2' });
  await menu.hover();
  await expect.poll(() => coloursOn(menu)).toContain(accent);
});
