import type { Locator, Page } from '@playwright/test';
import type { Bandmate, Sheet } from '../bandmate';
import { expect, test } from '../fixtures';
import { middleOf, type Point } from '../songPage';

// Dragging a Section by the grip on its header, on a Song of three Sections:
// to a new place in the Arrangement, or onto another Section to add it to it.
// Esc gives the drag up. A Section added to another is remade, so what's
// being typed in it is saved first, and the caret stays where it is. What a
// move says, the Lyric Sheet says, however the move was made.

/** The labels of a Song's Sections, in the order the Arrangement has them on the server. */
async function serverArrangement(bandmate: Bandmate, songId: number): Promise<string[]> {
  const sheet = (await bandmate.getSong(songId)) as unknown as Sheet;
  return sheet.arrangement.map((id) => sheet.sections.find((s) => s.id === id)!.label);
}

/** A Section on the Lyric Sheet, by its Label. */
const section = (page: Page, label: string) => page.getByRole('article', { name: label });

/** The grip on a Section's header, which drags it. */
const grip = (target: Locator) => target.getByTitle(/^Drag to move/);

/** A Song of three Sections in its Arrangement, opened on its page. */
async function threeSections(page: Page, bandmate: Bandmate) {
  const song = await bandmate.song({ title: 'Harbour' });
  for (const label of ['Verse 1', 'Chorus', 'Bridge']) await bandmate.addSection(song.id, label);
  await page.goto(`/songs/${song.id}`);
  await expect(section(page, 'Bridge')).toBeVisible();
  return song;
}

/**
 * Takes the grip of a Section. Hovering it brings it into the Lyric Sheet's
 * view, which moves the Sections, so where to drop is measured after this.
 */
async function takeGrip(page: Page, target: Locator) {
  await grip(target).hover();
  await page.mouse.down();
}

/** A point in the top quarter of a Section, which is the gap above it rather than the Section itself. */
async function aboveSection(target: Locator): Promise<Point> {
  const box = await target.boundingBox();
  if (!box) throw new Error('the Section is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 8 };
}

test('a Section dragged by its grip to the top of the Arrangement moves there, and is saved', async ({
  page,
  bandmate,
}) => {
  const song = await threeSections(page, bandmate);
  const bridge = section(page, 'Bridge');
  await expect(bridge.getByRole('button', { name: 'Move up' })).toBeEnabled();

  await takeGrip(page, bridge);
  const above = await aboveSection(section(page, 'Verse 1'));
  await page.mouse.move(above.x, above.y, { steps: 5 });
  await page.mouse.up();

  await expect.poll(() => serverArrangement(bandmate, song.id)).toEqual(['Bridge', 'Verse 1', 'Chorus']);
  // First in the Arrangement, it has nowhere above to move to.
  await expect(bridge.getByRole('button', { name: 'Move up' })).toBeDisabled();
  await expect(section(page, 'Verse 1').getByRole('button', { name: 'Move up' })).toBeEnabled();
});

test('a Section dragged onto the middle of another is added to it as Alternates', async ({ page, bandmate }) => {
  const song = await threeSections(page, bandmate);
  const chorus = section(page, 'Chorus');

  await takeGrip(page, section(page, 'Bridge'));
  const onto = await middleOf(chorus);
  await page.mouse.move(onto.x, onto.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByText('Bridge added to Chorus as an Alternate')).toBeVisible();

  // The Bridge is gone from the Arrangement, its text an Alternate of the Chorus.
  await expect.poll(() => serverArrangement(bandmate, song.id)).toEqual(['Verse 1', 'Chorus']);
  await expect(section(page, 'Bridge')).toHaveCount(0);
  await chorus.getByRole('button', { name: 'Alternates' }).click();
  await expect(chorus.getByRole('radio')).toHaveCount(2);
});

test('a Section dragged onto another saves the Label still being typed in it, which names the Alternate', async ({
  page,
  bandmate,
}) => {
  const song = await threeSections(page, bandmate);
  const chorus = section(page, 'Chorus');
  // The Bridge by its place, as its Label is typed over below.
  const bridge = page.getByRole('article').nth(2);
  // A drag doesn't leave the Label, so what's typed in it has to be sent first.
  const label = bridge.getByLabel('Label', { exact: true });
  await label.click();
  await label.fill('Middle 8');

  await takeGrip(page, bridge);
  const onto = await middleOf(chorus);
  await page.mouse.move(onto.x, onto.y, { steps: 5 });
  await expect(label).toBeFocused();
  await page.mouse.up();

  await expect.poll(() => serverArrangement(bandmate, song.id)).toEqual(['Verse 1', 'Chorus']);
  await chorus.getByRole('button', { name: 'Alternates' }).click();
  await expect(chorus.getByRole('radio', { name: 'Middle 8' })).toBeVisible();
});

test('a Scrapbook Section dragged onto a Section leaves the caret in a field elsewhere', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Harbour' });
  const sheet = await bandmate.addSection(song.id, 'Chorus');
  await bandmate.setLines(song.id, sheet.sections[0].alternates[0].id, 'Lanterns on the quay');
  await bandmate.addSection(song.id, 'Night swim', 'scrapbook');
  await page.goto(`/songs/${song.id}`);

  // Its editor open in the Scrapbook, which is when the whole page's focus was at risk.
  await page.getByRole('button', { name: /^Night swim/ }).click();
  const idea = page.getByRole('article', { name: 'Night swim' });
  await expect(idea).toBeVisible();

  // The caret in the Chorus' Lines, nowhere near the Section being moved.
  const lines = section(page, 'Chorus').getByRole('textbox', { name: 'Lines' });
  await lines.click();
  await lines.press('End');
  await lines.pressSequentially(' at night');

  await idea.getByTitle(/^Drag between Sections/).hover();
  await page.mouse.down();
  const onto = await middleOf(section(page, 'Chorus'));
  await page.mouse.move(onto.x, onto.y, { steps: 5 });
  await page.mouse.up();

  // Added to the Chorus as Alternates, with the caret left where it was, and
  // said in the Lyric Sheet as a Section dragged from the Arrangement is.
  await expect(idea).toHaveCount(0);
  await expect(page.getByText('Night swim added to Chorus as an Alternate')).toBeVisible();
  await expect(lines).toBeFocused();
  await expect(lines).toHaveValue('Lanterns on the quay at night');
  await section(page, 'Chorus').getByRole('button', { name: 'Alternates' }).click();
  await expect(section(page, 'Chorus').getByRole('radio')).toHaveCount(2);
});

test('Esc gives a Section drag up, leaving the Arrangement as it was', async ({ page, bandmate }) => {
  const song = await threeSections(page, bandmate);
  const bridge = section(page, 'Bridge');

  await takeGrip(page, bridge);
  const above = await aboveSection(section(page, 'Verse 1'));
  await page.mouse.move(above.x, above.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(bridge.getByRole('button', { name: 'Move up' })).toBeEnabled();
  expect(await serverArrangement(bandmate, song.id)).toEqual(['Verse 1', 'Chorus', 'Bridge']);
});

test('a Section with nothing written in it, taken out from its menu, says it wasn’t kept', async ({
  page,
  bandmate,
}) => {
  const song = await threeSections(page, bandmate);
  const bridge = section(page, 'Bridge');

  await bridge.getByRole('button', { name: 'Delete this Section' }).click();

  // Nothing written in it, so it isn't kept in the Scrapbook but deleted,
  // which is said here as it is for one dragged onto the Scrapbook.
  await expect(page.getByText("Nothing was written in Bridge, so it wasn't kept.")).toBeVisible();
  await expect.poll(() => serverArrangement(bandmate, song.id)).toEqual(['Verse 1', 'Chorus']);
  await expect(page.getByRole('button', { name: /^Bridge/ })).toHaveCount(0);
});
