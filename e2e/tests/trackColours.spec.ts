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
  namedClip,
  redoButton,
  serverClips,
  timeline,
  trackHead,
  undoButton,
} from '../songPage';

// A Clip's border in its Track's Track Colour, on the demo Backup's hero
// Song: the Beat's Clip on the Beat Track, its first, and Take 2 on the Lead
// vox Track, its second. A shade is compared with the token as the page holds
// it, as the shades change with the Palette and the theme. A waveform is
// hidden from a screen reader, so palettes.test.ts checks it takes the same
// colour, and so too for its Fade slopes, a trim edge and its ⋯, and that
// nothing else on a Clip is in the accent. A Track's volume slider is drawn by
// the browser, so its check is the colour the page gives the browser to draw it
// in, and palettes.test.ts holds that colour to the contrast floor.

const borderOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).borderTopColor);

/** The colour a Clip's gain line or fade dot is drawn in. */
const markOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);

const backgroundOf = (c: Locator) => c.evaluate((el) => getComputedStyle(el).backgroundColor);

/** Every colour something is drawn in, as the browser reports them. */
const paintOf = (c: Locator) =>
  c.evaluate((el) => {
    const { backgroundColor, borderLeftColor, boxShadow, color } = getComputedStyle(el);
    return [backgroundColor, borderLeftColor, boxShadow, color].join(' ');
  });

/** A Track's volume slider. */
const volumeOf = (page: Page, track: string) => timeline(page).getByRole('slider', { name: `Volume of ${track}` });

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
    await expect(volumeOf(page, 'Lead vox')).toHaveCSS('accent-color', await drawnColour(page, '--track-colour-2'));
  });
}

test('a selected Clip is ringed and filled in its Track Colour, not the accent', async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toBeVisible();
  const unselected = await take.evaluate((el) => getComputedStyle(el).backgroundColor);
  const colour = await drawnColour(page, '--track-colour-2');
  const accent = await drawnColour(page, '--accent');

  await take.click({ modifiers: ['ControlOrMeta'] });

  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expectBorderIn(page, take, '--track-colour-2');
  const ring = await take.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).toContain(colour);
  expect(ring).not.toContain(accent);
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

test("a Track a paste adds takes its source Track's colour, through undo and redo", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  await expect(clip(page, 'Take 2')).toBeVisible();

  // Pasted from Lead vox, the last Track, Take 2 runs a row past it.
  await clip(page, 'Take 2').click();
  await clip(page, 'Lorem Click').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+v');
  const pasted = namedClip(page, 'Take 2, selected, 1:34 to 1:55');
  await expect(pasted).toBeVisible();
  await expectBorderIn(page, pasted, '--track-colour-2');

  await undoButton(page).click();
  await expect(pasted).toBeHidden();

  await redoButton(page).click();
  const redone = namedClip(page, 'Take 2, 1:34 to 1:55');
  await expect(redone).toBeVisible();
  await expectBorderIn(page, redone, '--track-colour-2');
});

test("undoing a Track's deletion brings its colour back", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  await expect(clip(page, 'Take 2')).toBeVisible();
  const addATrack = timeline(page).getByRole('button', { name: 'Add a Track' });
  const deleteTrack = (name: string) => timeline(page).getByRole('button', { name: `Delete ${name} and its Clips` });
  await addATrack.click();
  await expect(trackHead(page, 'Track 3')).toBeVisible();
  await addATrack.click();
  await expect(trackHead(page, 'Track 4')).toBeVisible();

  await deleteTrack('Lead vox').click();
  await expect(clip(page, 'Take 2')).toBeHidden();
  await deleteTrack('Track 3').click();
  await expect(trackHead(page, 'Track 3')).toBeHidden();

  // Lead vox's colour is the least used by now, so Track 3 only comes back
  // in its own if it keeps it.
  await undoButton(page).click();
  await expect(trackHead(page, 'Track 3')).toBeVisible();
  await undoButton(page).click();

  await expectBorderIn(page, clip(page, 'Take 2'), '--track-colour-2');
  const tracks = (await bandmate.timeline(hero.id)).tracks;
  expect(tracks.map((t) => t.colour)).toEqual([1, 2, 3, 4]);
});

test("a Track's volume slider is in its colour, on an empty Track too", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  await expect(volumeOf(page, 'Beat')).toHaveCSS('accent-color', await drawnColour(page, '--track-colour-1'));
  await expect(volumeOf(page, 'Lead vox')).toHaveCSS('accent-color', await drawnColour(page, '--track-colour-2'));

  await timeline(page).getByRole('button', { name: 'Add a Track' }).click();

  await expect(volumeOf(page, 'Track 3')).toHaveCSS('accent-color', await drawnColour(page, '--track-colour-3'));
});

test("a Track's header shows its colour on its volume slider and, while Chosen, along its edge and as its tint", async ({
  page,
  bandmate,
}) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);

  const chosen = trackHead(page, 'Lead vox');
  await expect(chosen).toHaveAttribute('aria-current', 'true');
  const shades = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => drawnColour(page, `--track-colour-${n}`)));

  expect(await paintOf(chosen)).toContain(await drawnColour(page, '--track-colour-2'));
  expect(await paintOf(chosen)).not.toContain(await drawnColour(page, '--accent'));
  expect(await backgroundOf(chosen)).not.toBe(await backgroundOf(trackHead(page, 'Beat')));
  for (const part of [trackHead(page, 'Beat'), ...(await chosen.getByRole('button').all())]) {
    const paint = await paintOf(part);
    for (const shade of shades) expect(paint).not.toContain(shade);
  }
});

test('Mute and Solo are in the accent while on, not the Track Colour', async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const accent = await drawnColour(page, '--accent');

  for (const name of ['Mute Lead vox', 'Solo Lead vox']) {
    const toggle = timeline(page).getByRole('button', { name });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveCSS('background-color', accent);
  }
});

test("a Clip's changed Gain line is in its Track's colour", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  const [placed] = await serverClips(bandmate, hero.id, 'Lead vox');
  await bandmate.setClipGain(hero.id, placed.id, -6);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25, −6 dB');

  expect(await markOf(gainLine(take))).toBe(await drawnColour(page, '--track-colour-2'));
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

test("a Clip's fade dots are in its Track's colour", async ({ page, bandmate }) => {
  const hero = await heroSong(bandmate);
  await page.goto(`/songs/${hero.id}`);
  const take = clip(page, 'Take 2');
  await expect(take).toBeVisible();
  const colour = await drawnColour(page, '--track-colour-2');

  await take.hover();
  await expect(fadeDot(take, 'Fade in')).toHaveCSS('opacity', '1');
  expect(await markOf(fadeDot(take, 'Fade in'))).toBe(colour);
  expect(await markOf(fadeDot(take, 'Fade out'))).toBe(colour);
});
