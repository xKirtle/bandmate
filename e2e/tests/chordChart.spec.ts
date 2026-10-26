import type { Locator, Page } from '@playwright/test';
import type { Bandmate } from '../bandmate';
import { failRequests } from '../faults';
import { expect, test } from '../fixtures';

// The Chord Chart and a Chord's popover in Read mode, on the device's
// Instrument: the one the Chord Finder plays, the guitar until the piano is
// picked there.

/** A finished Song, which opens in Read mode, with these Chords in a Line, in this tuning. */
async function songWith(bandmate: Bandmate, chords: string[], tuning = '') {
  const song = await bandmate.song({ title: 'Keys', status: 'finished' });
  const sheet = await bandmate.addSection(song.id, 'Verse');
  const alternate = sheet.sections[0].alternates[0].id;
  await bandmate.setLines(song.id, alternate, chords.map((c) => `[${c}]la`).join(' '));
  if (tuning) await bandmate.tune(song.id, tuning);
  return { ...song, alternate };
}

/** Picks the device's Instrument on the Chord Finder's page. */
async function pickInstrument(page: Page, name: 'Guitar' | 'Piano') {
  await page.goto('/chords');
  await page.getByRole('combobox', { name: 'Instrument' }).click();
  await page.getByRole('option', { name }).click();
}

const chart = (page: Page) => page.getByRole('region', { name: 'Chord Chart' });

/** What a piano drawing shows: the name of each C it draws, low to high, and nothing else. */
const namesTheCs = (...cs: string[]) => new RegExp(`^\\s*${cs.join('\\s*')}\\s*$`);

const height = async (drawing: Locator) => (await drawing.boundingBox())!.height;
const width = async (drawing: Locator) => (await drawing.boundingBox())!.width;

test('with the piano picked, the Chart draws a keyboard per Chord, every one the same keys, whatever the tuning', async ({
  page,
  bandmate,
}) => {
  const song = await songWith(bandmate, ['C', 'G', 'Galt'], 'my weird tuning');
  await pickInstrument(page, 'Piano');
  await page.goto(`/songs/${song.id}`);

  // The tuning can't be read, but only the guitar minds.
  await expect(chart(page)).not.toContainText("can't be read");
  const c = chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' });
  const g = chart(page).getByRole('img', { name: 'G on the piano: G3 B3 D4' });
  const none = chart(page).getByRole('img', { name: 'Galt: no diagram' });
  await expect(c).toBeVisible();
  await expect(g).toBeVisible();
  await expect(none).toBeVisible();

  // C3 to C5, just covering G3 to G4, on both, and the Chord with none holds a card's place.
  expect(await width(c)).toBeCloseTo(await width(g), 0);
  expect(await height(none)).toBeCloseTo(await height(c), 0);
  await expect(c).toHaveText(namesTheCs('C3', 'C4', 'C5'));

  // Without G, the keys are one octave, C4 to C5.
  await bandmate.setLines(song.id, song.alternate, '[C]la');
  await page.reload();
  await expect(chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' })).toHaveText(namesTheCs('C4', 'C5'));

  // On the guitar, the tuning that can't be read blanks it, as before.
  await pickInstrument(page, 'Guitar');
  await page.goto(`/songs/${song.id}`);
  await expect(chart(page)).toContainText("The Song's tuning, “my weird tuning”, can't be read");
});

test('at the same Chart Size, a piano card is as tall as a guitar diagram', async ({ page, bandmate }) => {
  const song = await songWith(bandmate, ['C']);
  await page.goto(`/songs/${song.id}`);
  const guitar = await height(chart(page).getByRole('img', { name: 'C: x 3 2 0 1 0' }));

  await pickInstrument(page, 'Piano');
  await page.goto(`/songs/${song.id}`);
  const piano = await height(chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' }));
  expect(Math.abs(piano - guitar)).toBeLessThan(1);
});

test("a Chord's popover on the piano steps through its inversions on C3 to C5, prefers one, and the Chart follows", async ({
  page,
  bandmate,
}) => {
  const song = await songWith(bandmate, ['C']);
  await pickInstrument(page, 'Piano');
  await page.goto(`/songs/${song.id}`);
  await chart(page).getByRole('button', { name: /C/ }).click();

  const popover = page.getByRole('dialog', { name: 'C diagram' });
  const root = popover.getByRole('img', { name: 'C on the piano: C4 E4 G4' });
  await expect(root).toBeVisible();
  await expect(root).toHaveText(namesTheCs('C3', 'C4', 'C5'));
  const wide = await width(root);
  await expect(popover.getByRole('button', { name: 'Hear C' })).toBeEnabled();

  await popover.getByRole('button', { name: 'Next Voicing' }).click();
  const first = popover.getByRole('img', { name: 'C on the piano: E4 G4 C5' });
  await expect(first).toBeVisible();
  expect(await width(first)).toBeCloseTo(wide, 0);

  await popover.getByRole('button', { name: 'Prefer' }).click();
  await expect(popover).toContainText('Preferred');
  await expect(chart(page).getByRole('img', { name: 'C on the piano: E4 G4 C5' })).toBeVisible();

  // Shared with the Chord Finder, on the piano there too, which lists it first.
  await page.goto('/chords');
  const cards = page
    .getByRole('tabpanel', { name: 'Look up' })
    .getByRole('list', { name: 'Voicings of C, best first' })
    .getByRole('listitem');
  await expect(cards.first()).toContainText('1st inversion');
  await expect(cards.first()).toContainText('Preferred');
});

test("a Chord's popover on the piano loads its samples as it first opens, and says in the toast stack if they can't", async ({
  page,
  bandmate,
}) => {
  const song = await songWith(bandmate, ['C']);
  let loaded = 0;
  page.on('requestfinished', (r) => {
    if (r.url().includes('/samples/piano/')) loaded++;
  });
  await pickInstrument(page, 'Piano');
  await expect.poll(() => loaded).toBe(11);

  // None load on the Song page until the popover opens; then they fail, and so does a Hear.
  const fault = await failRequests(page, { url: '**/samples/piano/*.mp3' }, { times: 22, status: 0 });
  await page.goto(`/songs/${song.id}`);
  await expect(chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' })).toBeVisible();
  expect(fault.count).toBe(0);
  await chart(page).getByRole('button', { name: /C/ }).click();
  await expect.poll(() => fault.count).toBe(11);
  const popover = page.getByRole('dialog', { name: 'C diagram' });
  await popover.getByRole('button', { name: 'Hear C' }).click();
  await fault.spent;
  const toast = page.getByRole('alert').filter({ hasText: 'Piano' });
  await expect(toast).toContainText("Couldn't be heard");

  // Dismissed, it goes.
  await toast.getByRole('button', { name: 'Dismiss the Piano error' }).click();
  await expect(toast).toHaveCount(0);
});

/** The Reading menu, opened, in Read mode's Lyric Sheet. */
async function openReading(page: Page) {
  await page.getByRole('region', { name: 'Lyric Sheet' }).getByRole('button', { name: 'Reading', exact: true }).click();
  return page.getByRole('dialog', { name: 'Reading options' });
}

test('the Reading menu picks the Instrument, and the Chart and popover switch at once, the menu still open', async ({
  page,
  bandmate,
}) => {
  const song = await songWith(bandmate, ['C']);
  await page.goto(`/songs/${song.id}`);
  await expect(chart(page).getByRole('img', { name: 'C: x 3 2 0 1 0' })).toBeVisible();

  const reading = await openReading(page);
  const picker = reading.getByRole('combobox', { name: 'Instrument' });
  await expect(picker).toHaveText('Guitar');
  await picker.click();
  await page.getByRole('option', { name: 'Piano' }).click();
  await expect(picker).toHaveText('Piano');
  await expect(reading).toBeVisible();
  await expect(chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' })).toBeVisible();

  // Escape closes the picker's list first, then the menu.
  await picker.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Guitar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(reading).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reading).toHaveCount(0);

  await chart(page).getByRole('button', { name: /C/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'C diagram' }).getByRole('img', { name: 'C on the piano: C4 E4 G4' }),
  ).toBeVisible();

  // It's the device's: the Chord Finder plays it too.
  await page.goto('/chords');
  await expect(page.getByRole('combobox', { name: 'Instrument' })).toHaveText('Piano');
});

test("Settings' This device lists the Instrument, and picking it there switches an open Song's Chart and the Chord Finder", async ({
  page,
  bandmate,
}) => {
  const song = await songWith(bandmate, ['C']);
  await page.goto(`/songs/${song.id}`);
  await expect(chart(page).getByRole('img', { name: 'C: x 3 2 0 1 0' })).toBeVisible();

  const settings = await page.context().newPage();
  await settings.goto('/settings');
  const instrument = settings.getByRole('group', { name: 'Instrument' });
  await expect(instrument.getByRole('radio', { name: 'Guitar' })).toBeChecked();
  await instrument.getByRole('radio', { name: 'Piano' }).check();

  // The Song open in another tab switches without a reload, its Reading menu with it.
  await expect(chart(page).getByRole('img', { name: 'C on the piano: C4 E4 G4' })).toBeVisible();
  await expect((await openReading(page)).getByRole('combobox', { name: 'Instrument' })).toHaveText('Piano');

  // Picked back in the Chord Finder, Settings shows the guitar again.
  await page.goto('/chords');
  await page.getByRole('combobox', { name: 'Instrument' }).click();
  await page.getByRole('option', { name: 'Guitar' }).click();
  await expect(instrument.getByRole('radio', { name: 'Guitar' })).toBeChecked();
});
