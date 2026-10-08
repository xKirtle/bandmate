import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { clip, dragTo, heroSong, playhead, seek, timeline, trackHead, type Point } from '../songPage';

// Drawing a box over Tracks to select Clips, and clicking empty space along
// a Track, on the demo Backup's hero Song, with the mouse and with touch. Its
// Beat's Clip runs from 0:00 to 1:30 on the Beat Track, and Take 2 from 0:04
// to 0:25 on the Lead vox Track below it, which is chosen as the page opens.
// Empty space is pressed along the Lead vox Track, before Take 2 or after it.

/** The Beat's Clip. */
const beatClip = (page: Page) => clip(page, 'Lorem Click');

/** Take 2, the Clip on the Lead vox Track. */
const takeClip = (page: Page) => clip(page, 'Take 2');

/** Expects a Clip to be selected, or not. */
async function expectSelected(page: Page, title: string, selected: boolean) {
  const name = new RegExp(`^${title}, selected, `);
  if (selected) await expect(clip(page, title)).toHaveAccessibleName(name);
  else await expect(clip(page, title)).not.toHaveAccessibleName(name);
}

/** Expects a Track to be the Chosen Track, or not. */
async function expectChosen(page: Page, track: string, chosen: boolean) {
  if (chosen) await expect(trackHead(page, track)).toHaveAttribute('aria-current', 'true');
  else await expect(trackHead(page, track)).not.toHaveAttribute('aria-current');
}

/** Where a Clip is on screen. */
async function boxOf(page: Page, title: string) {
  const box = await clip(page, title).boundingBox();
  if (!box) throw new Error(`${title} is not on screen`);
  return box;
}

/** A point on empty space along the Lead vox Track, `by` pixels before Take 2's start. */
async function beforeTake(page: Page, by: number): Promise<Point> {
  const box = await boxOf(page, 'Take 2');
  return { x: box.x - by, y: box.y + box.height / 2 };
}

/** A point on empty space along the Lead vox Track, halfway between Take 2's end and the Beat's Clip's. */
async function afterTake(page: Page): Promise<Point> {
  const box = await boxOf(page, 'Take 2');
  const beat = await boxOf(page, 'Lorem Click');
  return { x: (box.x + box.width + beat.x + beat.width) / 2, y: box.y + box.height / 2 };
}

/** A point inside Take 2, `by` pixels after its start. */
async function intoTake(page: Page, by: number): Promise<Point> {
  const box = await boxOf(page, 'Take 2');
  return { x: box.x + by, y: box.y + box.height / 2 };
}

/**
 * Where the playhead's line is across the page, in pixels. The ruler gives
 * the playhead only in whole seconds, which can't tell a time a few pixels
 * off a Clip's edge from the edge itself; the line, which is hidden from a
 * screen reader, can.
 */
async function playheadX(page: Page): Promise<number> {
  const box = await timeline(page).locator('.playhead').boundingBox();
  if (!box) throw new Error("The playhead's line is not on screen");
  return box.x + box.width / 2;
}

/**
 * Sends a finger's touch as the browser's own touch event: down or moved to
 * a point, or lifted. Playwright's touchscreen only taps, so a finger held
 * and dragged is sent this way.
 */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', at?: Point) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] });
}

/** Opens a Song's page, with its Timeline's Clips shown. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(beatClip(page)).toHaveAccessibleName('Lorem Click, 0:00 to 1:30');
  await expect(takeClip(page)).toHaveAccessibleName('Take 2, 0:04 to 0:25');
}

/**
 * Selects the Beat's Clip, leaves the playhead at 0:10 and chooses the Beat
 * Track, so a click on empty space along the Lead vox Track shows what it
 * changes of all three.
 */
async function selectBeatAtTen(page: Page) {
  await beatClip(page).click();
  await trackHead(page, 'Beat').click();
  await seek(page, 10);
  await expectSelected(page, 'Lorem Click', true);
  await expectChosen(page, 'Beat', true);
}

/**
 * Expects what a click on empty space along the Lead vox Track at `at` does,
 * after selectBeatAtTen: the Selection cleared, the playhead moved to exactly
 * there, unsnapped to a Clip's edge however near, and the Lead vox Track
 * chosen.
 */
async function expectClickedAt(page: Page, at: Point) {
  await expectSelected(page, 'Lorem Click', false);
  await expectChosen(page, 'Lead vox', true);
  await expectChosen(page, 'Beat', false);
  await expect.poll(() => playhead(page)).not.toBe(10);
  const line = await playheadX(page);
  expect(Math.abs(line - at.x)).toBeLessThanOrEqual(1.5);
}

test.describe('with the mouse', () => {
  test('dragging from empty space along a Track draws a box whose Clips replace the Selection', async ({
    page,
    bandmate,
  }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await beatClip(page).click();
    await expectSelected(page, 'Lorem Click', true);

    // From before Take 2, along its Track only, into it.
    await dragTo(page, await beforeTake(page, 15), await intoTake(page, 20));

    await expectSelected(page, 'Take 2', true);
    await expectSelected(page, 'Lorem Click', false);
  });

  test('with Mod held at the press, the boxed Clips are added to the Selection', async ({ page, bandmate }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await beatClip(page).click();
    await expectSelected(page, 'Lorem Click', true);

    await page.keyboard.down('ControlOrMeta');
    await dragTo(page, await beforeTake(page, 15), await intoTake(page, 20));
    await page.keyboard.up('ControlOrMeta');

    await expectSelected(page, 'Take 2', true);
    await expectSelected(page, 'Lorem Click', true);
  });

  test('a click on empty space along a Track clears the Selection, moves the playhead there unsnapped, and chooses that Track', async ({
    page,
    bandmate,
  }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await selectBeatAtTen(page);

    // A few pixels before Take 2's start, well within snapping's reach.
    const at = await beforeTake(page, 5);
    await page.mouse.click(at.x, at.y);

    await expectClickedAt(page, at);
  });

  test('a Mod-click on empty space along a Track leaves the Selection, the playhead and the Chosen Track alone', async ({
    page,
    bandmate,
  }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await selectBeatAtTen(page);
    const was = await playheadX(page);

    const at = await afterTake(page);
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('ControlOrMeta');

    // Given time for a change that would follow, none does.
    await page.waitForTimeout(300);
    await expectSelected(page, 'Lorem Click', true);
    await expectChosen(page, 'Beat', true);
    expect(await playhead(page)).toBe(10);
    expect(await playheadX(page)).toBe(was);
  });
});

test.describe('with touch', () => {
  test.use({ hasTouch: true });

  test('a tap on empty space along a Track does what a click does', async ({ page, bandmate }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await selectBeatAtTen(page);

    // Away from Clips: a finger a few pixels off one lands on it, as the
    // browser takes a tap to the nearest thing it can press.
    const at = await afterTake(page);
    await page.touchscreen.tap(at.x, at.y);

    await expectClickedAt(page, at);
  });

  test('a long press then a drag draws a box that replaces the Selection', async ({ page, bandmate }) => {
    const song = await heroSong(bandmate);
    await open(page, song.id);
    await beatClip(page).click();
    await expectSelected(page, 'Lorem Click', true);
    const from = await beforeTake(page, 15);
    const to = await intoTake(page, 20);
    const cdp = await page.context().newCDPSession(page);

    await touch(cdp, 'touchStart', from);
    // Held still for the long press, the box appears under the finger, as yet
    // over no Clip, so it's replaced the Selection with none.
    await expectSelected(page, 'Lorem Click', false);
    for (let step = 1; step <= 10; step++) {
      await touch(cdp, 'touchMove', { x: from.x + ((to.x - from.x) * step) / 10, y: from.y });
    }
    await touch(cdp, 'touchEnd');
    await cdp.detach();

    await expectSelected(page, 'Take 2', true);
    await expectSelected(page, 'Lorem Click', false);
  });
});
