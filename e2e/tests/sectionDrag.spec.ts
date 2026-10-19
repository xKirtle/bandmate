import type { Locator, Page } from '@playwright/test';
import type { Bandmate, Sheet } from '../bandmate';
import { expect, test } from '../fixtures';
import { middleOf, type Point } from '../songPage';

// Dragging a Section by the grip on its header, on a Song of three Sections:
// to a new place in the Arrangement, or onto another Section to add it to it.
// Esc gives the drag up.

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
 * Takes the grip of a Section, scrolling it into the Lyric Sheet's view
 * first, which moves the Sections under it.
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

  // The Bridge is gone from the Arrangement, its text an Alternate of the Chorus.
  await expect.poll(() => serverArrangement(bandmate, song.id)).toEqual(['Verse 1', 'Chorus']);
  await expect(section(page, 'Bridge')).toHaveCount(0);
  await chorus.getByRole('button', { name: 'Alternates' }).click();
  await expect(chorus.getByRole('radio')).toHaveCount(2);
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
