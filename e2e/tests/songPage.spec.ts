import type { Page } from '@playwright/test';
import type { Clip } from '../bandmate';
import { failRequests, holdRequests, loseAnswers } from '../faults';
import { expect, test } from '../fixtures';
import {
  clip,
  comeBackTo,
  cueName,
  cueOf,
  drag,
  dragBy,
  dragClip,
  extentOf,
  fadeDot,
  gainLine,
  heroSong,
  serverClips,
  serverCues,
  timeline,
  warnsOnLeaving,
} from '../songPage';

// The Song page, and how it saves: Clips edited on the Timeline and undone,
// Cues synced and nudged, saves that fail or whose answer is lost, the Song
// changed in another tab, and the Details and Tags.

/** A Cue's save, setting a Line's Cue. */
const cueSave = { method: 'PUT', url: '**/api/songs/*/lines/*/cue' };

/** A save of an Alternate's Lines, typed in its text box. */
const textSave = { method: 'PUT', url: '**/api/songs/*/alternates/*/text' };

/** A Clip of Takes, with the Takes the shared Clip leaves to tests to read. */
type TakesClip = Clip & { activeTakeId: number; takes: { id: number; nudge: number }[] };

/** The Nudge of a Clip's active Take, in seconds. */
const activeNudge = (c: TakesClip) => c.takes.find((t) => t.id === c.activeTakeId)!.nudge;

/** The page's save error, under the Details. */
const saveError = (page: Page) => page.getByRole('main').getByRole('alert');

test('a Clip moved, trimmed and deleted is undone and redone a step at a time', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const redo = timeline(page).getByRole('button', { name: 'Redo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  await expect(undo).toBeDisabled();

  // Moved later.
  await dragClip(page, take, 100);
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBeGreaterThan(4);
  const [moved] = await serverClips(bandmate, song.id, 'Lead vox');
  expect(moved.length).toBe(21);
  const movedExtent = await extentOf(take);
  expect(movedExtent).not.toBe('0:04 to 0:25');

  // Its end trimmed in.
  await dragClip(page, take, -60, 'end');
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].length).toBeLessThan(21);
  const [trimmed] = await serverClips(bandmate, song.id, 'Lead vox');
  expect(trimmed.start).toBe(moved.start);
  const trimmedExtent = await extentOf(take);
  expect(trimmedExtent).not.toBe(movedExtent);

  // Deleted, from the keyboard.
  await take.focus();
  await page.keyboard.press('Delete');
  await expect(take).toHaveCount(0);
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);

  // Undone a step at a time, back to where it started.
  await undo.click();
  await expect(take).toContainText('Take 2');
  await expect.poll(async () => (await extentOf(take)) === trimmedExtent).toBe(true);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: trimmed.start, length: trimmed.length }]);
  await undo.click();
  await expect.poll(() => extentOf(take)).toBe(movedExtent);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: moved.start, length: 21 }]);
  await undo.click();
  await expect.poll(() => extentOf(take)).toBe('0:04 to 0:25');
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toMatchObject([{ start: 4, length: 21 }]);
  await expect(undo).toBeDisabled();

  // Redone, the same steps again: moved, trimmed, deleted.
  await redo.click();
  await expect.poll(() => extentOf(take)).toBe(movedExtent);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: moved.start, length: 21 }]);
  await redo.click();
  await expect.poll(() => extentOf(take)).toBe(trimmedExtent);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: trimmed.start, length: trimmed.length }]);
  await redo.click();
  await expect(take).toHaveCount(0);
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);
  await expect(redo).toBeDisabled();
});

test("a Clip's gain line dragged up sets its Gain, and an undo brings it back", async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // Dragged up past the Clip's top, it stops at the top of the range.
  const height = (await take.boundingBox())!.height;
  await dragBy(page, gainLine(take), { x: 0, y: -height });
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25, +36 dB');
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: 4, length: 21, gain: 36 }]);

  await undo.click();
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: 4, length: 21, gain: 0 }]);
  await expect(undo).toBeDisabled();
});

test("a Clip's fade dot dragged in sets its Fade, and an undo brings it back", async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // The fade in's dot, dragged in to the Clip's middle, fades it in over half its 21 s.
  const takeBox = (await take.boundingBox())!;
  const dotBox = (await fadeDot(take, 'Fade in').boundingBox())!;
  await dragBy(page, fadeDot(take, 'Fade in'), {
    x: takeBox.x + takeBox.width / 2 - (dotBox.x + dotBox.width / 2),
    y: 0,
  });
  await expect(take).toHaveAccessibleName(/^Take 2, selected, 0:04 to 0:25, fade in \d+(\.\d+)? s$/);
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].fadeIn).not.toBe(0);
  const [faded] = await serverClips(bandmate, song.id, 'Lead vox');
  expect(faded).toMatchObject({ start: 4, length: 21, fadeOut: 0 });
  expect(faded.fadeIn as number).toBeCloseTo(10.5, 0);

  await undo.click();
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([{ start: 4, length: 21, fadeIn: 0, fadeOut: 0 }]);
  await expect(undo).toBeDisabled();
});

test('a Clip of Takes Alt+dragged nudges its active Take, the Clip staying put, and an undo brings it back', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  const [before] = (await serverClips(bandmate, song.id, 'Lead vox')) as TakesClip[];
  expect(activeNudge(before)).toBe(0);

  // Dragged a fifth of its width later: 4.2 s, as the Clip spans 21 s.
  const width = (await take.boundingBox())!.width;
  await page.keyboard.down('Alt');
  await dragClip(page, take, width / 5);
  await page.keyboard.up('Alt');
  await expect
    .poll(async () => activeNudge((await serverClips(bandmate, song.id, 'Lead vox'))[0] as TakesClip))
    .not.toBe(0);
  const [nudged] = (await serverClips(bandmate, song.id, 'Lead vox')) as TakesClip[];
  expect(activeNudge(nudged)).toBeCloseTo(4.2, 1);
  expect(nudged).toMatchObject({ start: 4, offset: before.offset, length: 21, activeTakeId: before.activeTakeId });
  // A Nudge leaves the Selection be.
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  await undo.click();
  await expect
    .poll(async () => activeNudge((await serverClips(bandmate, song.id, 'Lead vox'))[0] as TakesClip))
    .toBe(0);
  expect((await serverClips(bandmate, song.id, 'Lead vox'))[0]).toMatchObject({
    start: 4,
    offset: before.offset,
    length: 21,
  });
  await expect(undo).toBeDisabled();
});

test('a Clip dragged in a Selection of several moves them all by as much, and one undo brings them back', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const click = clip(page, 'Lorem Click');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // Take 2 clicked, then the Beat's Clip added with Mod+click.
  await take.click();
  await click.click({ modifiers: ['ControlOrMeta'] });
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(click).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');

  // Dragging Take 2 later takes the Beat's Clip with it, still selected.
  await dragClip(page, take, 100);
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBeGreaterThan(4);
  const [movedTake] = await serverClips(bandmate, song.id, 'Lead vox');
  const [movedClick] = await serverClips(bandmate, song.id, 'Beat');
  expect(movedClick.start).toBeGreaterThan(0);
  expect(movedClick.start).toBeCloseTo(movedTake.start - 4, 6);
  expect([movedTake.length, movedClick.length]).toEqual([21, 90]);
  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expect(click).toHaveAccessibleName(/^Lorem Click, selected, /);
  expect(await extentOf(take)).not.toBe('0:04 to 0:25');

  // One undo brings both back.
  await undo.click();
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(click).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toMatchObject([{ start: 4, length: 21 }]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toMatchObject([{ start: 0, length: 90 }]);
  await expect(undo).toBeDisabled();
});

test('a Clip pressed and let go without dragging is selected, and nothing is saved', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  const before = await bandmate.timeline(song.id);
  const saves: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && saves.push(`${r.method()} ${r.url()}`));

  // A wobble of a few pixels isn't a drag.
  const box = (await take.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 3, y: -3 });
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(undo).toBeDisabled();
  expect(saves).toEqual([]);
  expect(await bandmate.timeline(song.id)).toEqual(before);
});

test('Clips selected by drawing a box are deleted with Delete, and one undo brings them all back', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const click = clip(page, 'Lorem Click');
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // A box drawn from the empty Lead vox lane before Take 2, up over the
  // Beat's Clip and right into Take 2, selects both, focusing neither.
  const takeBox = (await take.boundingBox())!;
  const clickBox = (await click.boundingBox())!;
  const fromX = takeBox.x - 15;
  const fromY = takeBox.y + takeBox.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(takeBox.x + 20, clickBox.y + clickBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expect(click).toHaveAccessibleName(/^Lorem Click, selected, /);

  await page.keyboard.press('Delete');
  await expect(take).toHaveCount(0);
  await expect(click).toHaveCount(0);
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toEqual([]);

  // One undo brings both back, still selected.
  await undo.click();
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(click).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toMatchObject([{ start: 4, length: 21 }]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toMatchObject([{ start: 0, length: 90 }]);
  await expect(undo).toBeDisabled();

  // Selected with Mod+A, after a click on empty lane space, they go the same way.
  await page.mouse.click(fromX, fromY);
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await page.keyboard.press('Delete');
  await expect(take).toHaveCount(0);
  await expect(click).toHaveCount(0);
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toEqual([]);
});

test('Cue edits are undone in order with the Clip edits around them', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const redo = timeline(page).getByRole('button', { name: 'Redo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // A Clip moved, then the Cues it spans moved with it, then a Cue nudged.
  await dragClip(page, take, 100);
  await timeline(page).getByRole('button', { name: 'Move 4 Cues with it' }).click();
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).not.toEqual([5, 10, 15, 20]);
  const [moved] = await serverClips(bandmate, song.id, 'Lead vox');
  const by = moved.start - 4;
  expect((await serverCues(bandmate, song.id, 'Verse 1')).map((c) => c! - by)).toEqual([
    expect.closeTo(5, 2),
    expect.closeTo(10, 2),
    expect.closeTo(15, 2),
    expect.closeTo(20, 2),
  ]);
  await expect(cueOf(page, 'Line 1 of Verse 1')).not.toHaveAccessibleName(cueName('Line 1 of Verse 1', '0:05.0'));
  await cueOf(page, 'Line 1 of Chorus').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => serverCues(bandmate, song.id, 'Chorus')).toEqual([25.1, 30, 35, 40]);

  // Undone last first: the nudge, then the Cues moved, then the Clip.
  await undo.click();
  await expect(cueOf(page, 'Line 1 of Chorus')).toHaveAccessibleName(cueName('Line 1 of Chorus', '0:25.0'));
  await expect.poll(() => serverCues(bandmate, song.id, 'Chorus')).toEqual([25, 30, 35, 40]);
  expect((await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBe(moved.start);

  await undo.click();
  await expect(cueOf(page, 'Line 1 of Verse 1')).toHaveAccessibleName(cueName('Line 1 of Verse 1', '0:05.0'));
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10, 15, 20]);
  expect((await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBe(moved.start);

  await undo.click();
  await expect.poll(() => extentOf(take)).toBe('0:04 to 0:25');
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBe(4);
  await expect(undo).toBeDisabled();

  // Redone in the order they were made.
  await redo.click();
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBe(moved.start);
  expect(await serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10, 15, 20]);
  await redo.click();
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).not.toEqual([5, 10, 15, 20]);
  await redo.click();
  await expect.poll(() => serverCues(bandmate, song.id, 'Chorus')).toEqual([25.1, 30, 35, 40]);
  await expect(cueOf(page, 'Line 1 of Chorus')).toHaveAccessibleName(cueName('Line 1 of Chorus', '0:25.1'));
  await expect(redo).toBeDisabled();
});

test('Sync mode cues the Lines up next at the playhead while playing', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  // Every Line but the Bridge's is cued, so the Bridge's come up next.
  expect(await serverCues(bandmate, song.id, 'Bridge')).toEqual([null, null, null, null]);

  const sync = page.getByRole('button', { name: 'Sync lyrics' });
  await sync.click();
  await expect(sync).toHaveAttribute('aria-pressed', 'true');
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  const pause = timeline(page).getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();

  await page.keyboard.press('Enter');
  await expect.poll(async () => (await serverCues(bandmate, song.id, 'Bridge'))[0]).not.toBeNull();
  // Played on past it, the next is cued later.
  const [cued] = await serverCues(bandmate, song.id, 'Bridge');
  const position = timeline(page).getByRole('slider', { name: 'Position' });
  await expect.poll(async () => Number(await position.getAttribute('aria-valuenow'))).toBeGreaterThan(cued!);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await serverCues(bandmate, song.id, 'Bridge'))[1]).not.toBeNull();

  // Playing on all the while, each Line cued where the playhead was, in order.
  await expect(pause).toBeVisible();
  const [first, second, third, fourth] = await serverCues(bandmate, song.id, 'Bridge');
  expect(first).toBeGreaterThanOrEqual(0);
  expect(second).toBeGreaterThan(first!);
  expect([third, fourth]).toEqual([null, null]);
  await pause.click();
  // Where it was paused, to the second, is past both.
  expect(Number(await position.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Math.round(second!));

  // Out of Sync mode, the Cues show as any other.
  await sync.click();
  await expect(sync).toHaveAttribute('aria-pressed', 'false');
  await expect(cueOf(page, 'Line 1 of Bridge')).toBeVisible();
  await expect(cueOf(page, 'Line 2 of Bridge')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set a Cue for Line 3 of Bridge' })).toBeVisible();
});

test('a Cue is nudged a tenth of a second at a time', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const cue = cueOf(page, 'Line 2 of Verse 1');

  await cue.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(cue).toHaveAccessibleName(cueName('Line 2 of Verse 1', '0:10.1'));
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10.1, 15, 20]);

  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cue).toHaveAccessibleName(cueName('Line 2 of Verse 1', '0:09.9'));
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 9.9, 15, 20]);
});

test('a Cue save failing every retry is taken back, its error kept by a save already queued and cleared by a later change', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(cueOf(page, 'Line 1 of Verse 1')).toBeVisible();
  // The first try, and every retry after it.
  const fault = await failRequests(page, cueSave, {
    times: 4,
    error: 'Disk full',
  });

  await cueOf(page, 'Line 1 of Verse 1').focus();
  await page.keyboard.press('Alt+ArrowUp');
  // Shown at once, while it's saved.
  await expect(cueOf(page, 'Line 1 of Verse 1')).toHaveAccessibleName(cueName('Line 1 of Verse 1', '0:05.1'));
  // Queued behind it, while it's still being retried.
  await cueOf(page, 'Line 2 of Verse 1').focus();
  await page.keyboard.press('Alt+ArrowUp');
  expect(fault.count).toBeLessThan(4);

  await expect(saveError(page)).toHaveText(
    "Couldn't save the Cue of Line 1 of Verse 1, so it was taken back. Disk full",
  );
  await expect(cueOf(page, 'Line 1 of Verse 1')).toHaveAccessibleName(cueName('Line 1 of Verse 1', '0:05.0'));
  expect(fault.count).toBe(4);
  // The save queued behind it lands, and leaves the error showing.
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10.1, 15, 20]);
  await expect(page.getByRole('status').filter({ hasText: 'Edited' })).toBeVisible();
  await expect(cueOf(page, 'Line 2 of Verse 1')).toHaveAccessibleName(cueName('Line 2 of Verse 1', '0:10.1'));
  await expect(saveError(page)).toHaveText(
    "Couldn't save the Cue of Line 1 of Verse 1, so it was taken back. Disk full",
  );

  // A change made since clears it.
  await cueOf(page, 'Line 3 of Verse 1').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10.1, 15.1, 20]);
  await expect(saveError(page)).toHaveCount(0);
});

test('a Cue save whose answer is lost, but which landed, is kept', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(cueOf(page, 'Line 1 of Verse 1')).toBeVisible();
  const fault = await loseAnswers(page, cueSave);

  await cueOf(page, 'Line 1 of Verse 1').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await fault.spent;

  // Tried again, it's refused, as the Song moved on with it, but it's kept.
  await expect(page.getByRole('status').filter({ hasText: 'Edited' })).toBeVisible();
  await expect(cueOf(page, 'Line 1 of Verse 1')).toHaveAccessibleName(cueName('Line 1 of Verse 1', '0:05.1'));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5.1, 10, 15, 20]);

  // The page goes on from the Song it left: the next edit saves.
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => serverCues(bandmate, song.id, 'Verse 1')).toEqual([5.2, 10, 15, 20]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test("two tabs on one Song: the other tab's next edit marks it Stale, and Reload shows the change", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  const other = await page.context().newPage();
  await page.goto(`/songs/${song.id}`);
  await other.goto(`/songs/${song.id}`);
  await expect(other.getByRole('textbox', { name: 'BPM' })).toBeVisible();

  // One tab edits.
  await page.getByRole('textbox', { name: 'BPM' }).fill('120');
  await page.getByRole('textbox', { name: 'BPM' }).press('Enter');
  await expect.poll(async () => (await bandmate.getSong(song.id)).bpm).toBe(120);

  // The other, not knowing, edits too, and is refused.
  await other.getByRole('textbox', { name: 'Capo' }).fill('3');
  await other.getByRole('textbox', { name: 'Capo' }).press('Enter');
  const stale = other.getByRole('alert').filter({ hasText: 'This Song changed elsewhere' });
  await expect(stale).toBeVisible();
  // Its edit stays where it was typed, to copy out.
  await expect(other.getByRole('textbox', { name: 'Capo' })).toHaveValue('3');
  expect((await bandmate.getSong(song.id)).capo).toBeNull();

  // Reload asks first, as the edit there is lost, then shows the change.
  const asked: string[] = [];
  other.once('dialog', (dialog) => (asked.push(dialog.message()), dialog.accept()));
  await stale.getByRole('button', { name: 'Reload' }).click();
  await expect(other.getByRole('textbox', { name: 'BPM' })).toHaveValue('120');
  await expect(other.getByRole('textbox', { name: 'Capo' })).toHaveValue('');
  await expect(other.getByRole('alert')).toHaveCount(0);
  expect(asked).toEqual(['Reload the Song? Edits that weren’t saved here will be lost.']);
});

test('coming back to a tab with nothing unsaved shows a change made in another', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  const other = await page.context().newPage();
  await page.goto(`/songs/${song.id}`);
  await other.goto(`/songs/${song.id}`);
  await expect(other.getByRole('textbox', { name: 'Title' })).toHaveValue('Anthem');

  await page.getByRole('textbox', { name: 'Title' }).fill('Ballad');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await page.getByRole('textbox', { name: 'BPM' }).fill('90');
  await page.getByRole('textbox', { name: 'BPM' }).press('Enter');
  await expect.poll(async () => (await bandmate.getSong(song.id)).bpm).toBe(90);
  // Until then, it shows the Song as it loaded it.
  await expect(other.getByRole('textbox', { name: 'Title' })).toHaveValue('Anthem');

  await comeBackTo(other);
  await expect(other.getByRole('textbox', { name: 'Title' })).toHaveValue('Ballad');
  await expect(other.getByRole('textbox', { name: 'BPM' })).toHaveValue('90');
  await expect(other.getByRole('alert')).toHaveCount(0);

  // Up to date, its next edit saves.
  await other.getByRole('textbox', { name: 'Capo' }).fill('2');
  await other.getByRole('textbox', { name: 'Capo' }).press('Enter');
  await expect.poll(async () => (await bandmate.getSong(song.id)).capo).toBe(2);
  await expect(other.getByRole('alert')).toHaveCount(0);
});

test("an Alternate's text box closed while its save fails leaves nothing unsaved once that save is over", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await page.getByRole('button', { name: 'Add Section' }).click();
  const lines = page.getByRole('textbox', { name: 'Lines' });
  await expect(lines).toBeVisible();
  // The save as the text box blurs, and the one as it closes.
  const fault = await failRequests(page, textSave, { times: 2, error: 'Disk full' });

  await lines.fill('First line');
  await lines.blur();
  await expect(saveError(page)).toHaveText('Disk full');

  // Opening Alternates mode closes the text box, which saves it again.
  const hold = await holdRequests(page, textSave);
  await page.getByRole('button', { name: 'Alternates', exact: true }).click();
  await expect(lines).toHaveCount(0);
  await hold.reached;
  // While that save is on its way, leaving still warns.
  expect(await warnsOnLeaving(page)).toBe(true);
  await hold.release();
  await fault.spent;

  // It failed, and says so, but the text box is gone, and nothing is unsaved.
  await expect(saveError(page)).toHaveText('Disk full');
  await expect.poll(() => warnsOnLeaving(page)).toBe(false);
  // So coming back to the tab shows a change made elsewhere.
  await bandmate.retitle(song.id, 'Ballad');
  await comeBackTo(page);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Ballad');
  await expect(page.getByRole('alert').filter({ hasText: 'This Song changed elsewhere' })).toHaveCount(0);
});

test('the Details and Tags save as they are edited', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  const details = page.getByRole('region', { name: 'Details' });
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Anthem');

  await page.getByRole('textbox', { name: 'Title' }).fill('Night Drive');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await details.getByRole('combobox', { name: 'Key' }).fill('Em');
  await details.getByRole('combobox', { name: 'Key' }).press('Tab');
  await details.getByRole('textbox', { name: 'BPM' }).fill('128');
  await details.getByRole('textbox', { name: 'BPM' }).press('Enter');
  await details.getByRole('textbox', { name: 'Capo' }).fill('4');
  await details.getByRole('textbox', { name: 'Capo' }).press('Enter');
  await details.getByRole('button', { name: 'Notes' }).click();
  await details.getByRole('textbox', { name: 'Notes' }).fill('Slower live.');
  await details.getByRole('textbox', { name: 'Notes' }).blur();

  await expect
    .poll(() => bandmate.getSong(song.id))
    .toMatchObject({
      title: 'Night Drive',
      key: 'Em',
      bpm: 128,
      capo: 4,
      notes: 'Slower live.',
    });

  // Tags: each added with Enter or a comma, and taken off by its button.
  const tags = details.getByRole('combobox', { name: 'Tags' });
  await tags.fill('live');
  await tags.press('Enter');
  await tags.pressSequentially('loud,');
  await expect.poll(async () => (await bandmate.getSong(song.id)).tags).toEqual(['live', 'loud']);
  await details.getByRole('button', { name: 'Take off “live”' }).click();
  await expect.poll(async () => (await bandmate.getSong(song.id)).tags).toEqual(['loud']);
  await expect(details.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['loud']);

  // As saved, they're there on a reload.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Night Drive');
  await expect(details.getByRole('combobox', { name: 'Key' })).toHaveValue('Em');
  await expect(details.getByRole('textbox', { name: 'BPM' })).toHaveValue('128');
  await expect(details.getByRole('textbox', { name: 'Capo' })).toHaveValue('4');
  await expect(details.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['loud']);
});

test('a failed Details save puts the field back, and the next change clears its error', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Anthem');
  const fault = await failRequests(page, { method: 'PATCH', url: `**/api/songs/${song.id}` }, { error: 'Disk full' });

  await title.fill('Ballad');
  await title.press('Enter');

  await expect(saveError(page)).toHaveText('Disk full');
  await expect(title).toHaveValue('Anthem');
  await fault.spent;
  expect((await bandmate.getSong(song.id)).title).toBe('Anthem');

  await page.getByRole('textbox', { name: 'BPM' }).fill('100');
  await page.getByRole('textbox', { name: 'BPM' }).press('Enter');
  await expect.poll(async () => (await bandmate.getSong(song.id)).bpm).toBe(100);
  await expect(saveError(page)).toHaveCount(0);
  await expect(title).toHaveValue('Anthem');
});
