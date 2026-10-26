import type { Locator, Page } from '@playwright/test';
import { failRequests } from '../faults';
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

async function pickInstrument(page: Page, name: 'Guitar' | 'Piano') {
  await page.getByRole('combobox', { name: 'Instrument' }).click();
  await page.getByRole('option', { name }).click();
}

test('Name it on the piano reads the keys pressed, the lowest as the bass, and switching Instruments empties it', async ({
  page,
}) => {
  await page.goto('/chords');
  await pickInstrument(page, 'Piano');
  await page.getByRole('tab', { name: 'Name it' }).click();
  const nameIt = page.getByRole('tabpanel', { name: 'Name it' });
  const piano = nameIt.getByRole('group', { name: 'Piano' });
  const key = (name: string) => piano.getByRole('button', { name, exact: true });
  const best = nameIt.getByRole('list', { name: 'Readings, best first' }).getByRole('button').first();

  // Tapping presses a key, and tapping it again lets it go.
  await key('E3').click();
  await key('C4').click();
  await key('G4').click();
  await expect(key('E3')).toHaveAttribute('aria-pressed', 'true');
  await expect(best).toHaveText('C/E');
  await expect(nameIt.getByText('Notes E C G')).toBeVisible();
  await key('E3').click();
  await key('E4').click();
  await expect(key('E3')).toHaveAttribute('aria-pressed', 'false');
  await expect(best).toHaveText('C');
  await expect(nameIt.getByText('Notes C E G')).toBeVisible();

  // From a computer keyboard it's one tab stop: arrows move a semitone, Home and End go to the ends.
  await key('G4').focus();
  await page.keyboard.press('ArrowRight');
  await expect(key('Ab4')).toBeFocused();
  await expect(piano.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(key('F#4')).toBeFocused();
  await page.keyboard.press('End');
  await expect(key('C5')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(key('C3')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(key('C3')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(key('C3')).toHaveAttribute('aria-pressed', 'false');

  // A reading opens in Look up.
  await best.click();
  await expect(page.getByRole('tab', { name: 'Look up' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'C', exact: true })).toBeVisible();

  // Switching Instruments empties Name it, its C4, E4 and G4 still pressed.
  await pickInstrument(page, 'Guitar');
  await pickInstrument(page, 'Piano');
  await page.getByRole('tab', { name: 'Name it' }).click();
  await expect(piano.getByRole('button', { pressed: true })).toHaveCount(0);
  await expect(nameIt.getByText('Press the keys of a Chord.')).toBeVisible();
});

test('a piano Voicing preferred comes first in Look up and is the one Suggest draws, apart from the guitar’s', async ({
  page,
}) => {
  await page.goto('/chords');
  await pickInstrument(page, 'Piano');
  const lookUp = page.getByRole('tabpanel', { name: 'Look up' });
  const cards = lookUp.getByRole('list', { name: 'Voicings of C, best first' }).getByRole('listitem');
  const prefer = lookUp.getByRole('button', { name: 'Prefer' });
  const clear = lookUp.getByRole('button', { name: 'Clear' });
  await expect(cards).toHaveCount(3);
  await expect(prefer).toHaveCount(3);
  await expect(clear).toHaveCount(0);

  // Preferring the 2nd inversion moves it first, and focus follows it to its Clear.
  await cards.nth(2).getByRole('button', { name: 'Prefer' }).click();
  await expect(cards.first()).toContainText('2nd inversion');
  await expect(cards.first()).toContainText('Preferred');
  await expect(cards.first().getByRole('button', { name: 'Clear' })).toBeFocused();
  await expect(prefer).toHaveCount(2);

  // Suggest draws it, and it's kept after a reload.
  await page.getByRole('tab', { name: 'Suggest' }).click();
  await expect(page.getByRole('img', { name: 'C on the piano: G3 C4 E4' })).toBeVisible();
  await page.reload();
  await expect(cards.first()).toContainText('2nd inversion');

  // The guitar's preferences are its own: none there, and preferring one leaves the piano's be.
  await pickInstrument(page, 'Guitar');
  await expect(clear).toHaveCount(0);
  await lookUp.getByRole('listitem').nth(1).getByRole('button', { name: 'Prefer' }).click();
  await pickInstrument(page, 'Piano');
  await expect(cards.first()).toContainText('2nd inversion');

  // Clearing puts root position first again, focus on its Prefer, and leaves the guitar's be.
  await clear.click();
  await expect(cards.first()).toContainText('Root position');
  await expect(cards.first()).not.toContainText('Preferred');
  await expect(cards.first().getByRole('button', { name: 'Prefer' })).toBeFocused();
  await expect(clear).toHaveCount(0);
  await pickInstrument(page, 'Guitar');
  await expect(clear).toHaveCount(1);
});

test('the guitar and the piano play samples Bandmate serves itself; when they can’t load, a toast says so and the next Hear tries again', async ({
  page,
}) => {
  const samples = '**/samples/piano/*.mp3';
  const asked: URL[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.mp3')) asked.push(new URL(r.url()));
  });
  const of = (instrument: string) => asked.filter((url) => url.pathname.includes(`/samples/${instrument}/`));
  await page.goto('/chords');
  // Opening the Chord Finder loads the guitar's 19 samples, and picking the
  // piano its 11, from Bandmate itself.
  await expect.poll(() => of('guitar').length).toBe(19);
  await pickInstrument(page, 'Piano');
  await expect.poll(() => of('piano').length).toBe(11);
  expect(asked).toHaveLength(30);
  expect(asked.every((url) => url.origin === new URL(page.url()).origin)).toBe(true);

  // Opened again with none of them loading: the Chord Finder's opening
  // tries, and fails, and so does a Hear.
  const fault = await failRequests(page, { url: samples }, { times: 22, status: 0 });
  await page.reload();
  const hear = page.getByRole('tabpanel', { name: 'Look up' }).getByRole('button', { name: 'Hear C' }).first();
  await expect.poll(() => fault.count).toBe(11);
  await hear.click();
  await fault.spent;
  const toast = page.getByRole('alert').filter({ hasText: 'Piano' });
  await expect(toast).toContainText("Couldn't be heard");

  // The next Hear tries again, and once they load, the toast goes.
  await hear.click();
  await expect(toast).toHaveCount(0);
});
