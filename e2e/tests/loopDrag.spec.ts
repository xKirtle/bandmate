import type { Page } from '@playwright/test';
import type { Bandmate, Loop } from '../bandmate';
import { expect, test } from '../fixtures';
import { clip, drag, heroSong, loopBar, loopButton, middleOf, timeline, type Point } from '../songPage';

// Dragging the Loop along the top of the ruler, on the demo Backup's hero
// Song: marking a new one, moving its edges, snapping them to Clips' edges
// or not with Shift held, and what sets nothing. Its Beat's Clip runs from
// 0:00 to 1:30 and Take 2 from 0:04 to 0:25, so nothing is near 0:30 to 1:20
// to snap to, and the playhead stays at 0:00.

/** One of the Loop's edges, dragged to move it. */
const loopEdge = (page: Page, edge: 'start' | 'end') => timeline(page).getByTitle(`Drag to move the Loop's ${edge}`);

/**
 * Where a time is on the top of the ruler, measured off the Beat's Clip,
 * which runs from 0:00 to 1:30, so the tests don't depend on the zoom.
 */
async function loopBarAt(page: Page, time: number): Promise<Point> {
  const beat = await clip(page, 'Lorem Click').boundingBox();
  if (!beat) throw new Error("The Beat's Clip is not on screen");
  const { y } = await middleOf(loopBar(page));
  return { x: beat.x + (time / 90) * beat.width, y };
}

/** How many seconds a pixel is along the Timeline. */
async function secondsPerPixel(page: Page): Promise<number> {
  const beat = await clip(page, 'Lorem Click').boundingBox();
  if (!beat) throw new Error("The Beat's Clip is not on screen");
  return 90 / beat.width;
}

/** Drags from one point on the page to another. */
async function dragTo(page: Page, from: Point, to: Point) {
  await drag(page, from, { x: to.x - from.x, y: to.y - from.y });
}

/** Drags one of the Loop's edges to a point on the page. */
async function dragEdge(page: Page, edge: 'start' | 'end', to: Point) {
  await dragTo(page, await middleOf(loopEdge(page, edge)), to);
}

/** The server's Loop, once it's no longer what it was. */
async function savedLoop(bandmate: Bandmate, songId: number, was: Loop | null): Promise<Loop> {
  await expect.poll(async () => (await bandmate.timeline(songId)).loop ?? null).not.toEqual(was);
  return (await bandmate.timeline(songId)).loop!;
}

/** Opens a Song's page, with its Timeline's Clips shown. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(clip(page, 'Lorem Click')).toHaveAccessibleName('Lorem Click, 0:00 to 1:30');
}

test('dragging along the top of the ruler marks a new Loop, switched on, where it was dropped', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  const was = { start: 70, end: 80, on: false };
  await bandmate.setLoop(song.id, was);
  await open(page, song.id);
  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'false');
  const pixel = await secondsPerPixel(page);

  await dragTo(page, await loopBarAt(page, 40), await loopBarAt(page, 60));

  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'true');
  const loop = await savedLoop(bandmate, song.id, was);
  expect(loop.on).toBe(true);
  expect(Math.abs(loop.start - 40)).toBeLessThanOrEqual(pixel);
  expect(Math.abs(loop.end - 60)).toBeLessThanOrEqual(pixel);
});

test("dragging the Loop's start or end moves only that edge", async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  const was = { start: 40, end: 60, on: true };
  await bandmate.setLoop(song.id, was);
  await open(page, song.id);
  const pixel = await secondsPerPixel(page);

  // The start, earlier.
  await dragEdge(page, 'start', await loopBarAt(page, 32));
  const started = await savedLoop(bandmate, song.id, was);
  expect(Math.abs(started.start - 32)).toBeLessThanOrEqual(pixel);
  expect(started).toMatchObject({ end: 60, on: true });

  // The end, later.
  await dragEdge(page, 'end', await loopBarAt(page, 75));
  const ended = await savedLoop(bandmate, song.id, started);
  expect(Math.abs(ended.end - 75)).toBeLessThanOrEqual(pixel);
  expect(ended).toMatchObject({ start: started.start, on: true });
});

test("a Loop edge dragged near a Clip's edge snaps to it, and with Shift held it doesn't", async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  const was = { start: 40, end: 60, on: true };
  await bandmate.setLoop(song.id, was);
  await open(page, song.id);
  const pixel = await secondsPerPixel(page);
  // A few pixels off the edge, well within snapping's reach.
  const off = 4;
  const near = async (time: number, by: number) => {
    const at = await loopBarAt(page, time);
    return { x: at.x + by, y: at.y };
  };

  // The start, just after where Take 2 ends, at 0:25, snaps to it.
  await dragEdge(page, 'start', await near(25, off));
  const snappedStart = await savedLoop(bandmate, song.id, was);
  expect(snappedStart).toEqual({ start: 25, end: 60, on: true });

  // The end, just short of where the Beat's Clip ends, at 1:30, snaps to it.
  await dragEdge(page, 'end', await near(90, -off));
  const snappedEnd = await savedLoop(bandmate, song.id, snappedStart);
  expect(snappedEnd).toEqual({ start: 25, end: 90, on: true });

  // Moved away again, with Shift held, each stays where it's dropped, just off them.
  await page.keyboard.down('Shift');
  await dragEdge(page, 'start', await loopBarAt(page, 40));
  const startAway = await savedLoop(bandmate, song.id, snappedEnd);
  await dragEdge(page, 'end', await loopBarAt(page, 60));
  const away = await savedLoop(bandmate, song.id, startAway);
  await dragEdge(page, 'start', await near(25, off));
  const freeStart = await savedLoop(bandmate, song.id, away);
  await dragEdge(page, 'end', await near(90, -off));
  const freeEnd = await savedLoop(bandmate, song.id, freeStart);
  await page.keyboard.up('Shift');

  expect(freeStart.start).toBeGreaterThan(25);
  expect(Math.abs(freeStart.start - (25 + off * pixel))).toBeLessThanOrEqual(pixel);
  expect(freeEnd.end).toBeLessThan(90);
  expect(Math.abs(freeEnd.end - (90 - off * pixel))).toBeLessThanOrEqual(pixel);
  expect(freeEnd.start).toBe(freeStart.start);
});

test('a click on the top of the ruler, or a drag shorter than the shortest Loop, sets nothing', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await bandmate.setLoop(song.id, { start: 70, end: 80, on: false });
  await open(page, song.id);
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const before = await bandmate.timeline(song.id);
  const saves: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && saves.push(`${r.method()} ${r.url()}`));
  const at = await loopBarAt(page, 40);

  // A click.
  await page.mouse.click(at.x, at.y);
  // A drag out and back to where it was pressed: a Loop shorter than the shortest.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y, { steps: 5 });
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await page.mouse.up();

  // Given time for a save that would follow, none does.
  await page.waitForTimeout(500);
  await expect(loopButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(undo).toBeDisabled();
  expect(saves).toEqual([]);
  expect(await bandmate.timeline(song.id)).toEqual(before);
});
