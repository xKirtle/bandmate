import type { Page } from '@playwright/test';
import type { Clip } from '../bandmate';
import { toneWav } from '../beats';
import { failRequests, holdRequests, loseAnswers } from '../faults';
import { expect, test } from '../fixtures';
import {
  clip,
  comeBackTo,
  namedClip,
  cueName,
  cueOf,
  customTuningNotes,
  drag,
  dragMiddleOf,
  middleOf,
  dragClip,
  extentOf,
  fadeDot,
  gainLine,
  heroSong,
  pickCustomTuning,
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

  // At 0 dB the line's halfway down the waveform, which runs from −36 dB at
  // the Clip's bottom to +36 dB at its top. Dragged up by half its height
  // above the Clip's bottom, a quarter of the range, it's at about +18 dB,
  // the waveform ending a few pixels inside the Clip.
  const line = await middleOf(gainLine(take));
  const takeBox = (await take.boundingBox())!;
  await dragMiddleOf(page, gainLine(take), { x: 0, y: -(takeBox.y + takeBox.height - line.y) / 2 });
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].gain).not.toBe(0);
  const [gained] = await serverClips(bandmate, song.id, 'Lead vox');
  expect(gained).toMatchObject({ start: 4, length: 21 });
  expect(Math.abs((gained.gain as number) - 18)).toBeLessThanOrEqual(2);
  await expect(take).toHaveAccessibleName(`Take 2, selected, 0:04 to 0:25, +${gained.gain} dB`);

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
  const dot = fadeDot(take, 'Fade in');
  const [middle, dotMiddle] = [await middleOf(take), await middleOf(dot)];
  await dragMiddleOf(page, dot, { x: middle.x - dotMiddle.x, y: 0 });
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
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
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
  const beatClip = clip(page, 'Lorem Click');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // Take 2 clicked, then the Beat's Clip added with Mod+click.
  await take.click();
  await beatClip.click({ modifiers: ['ControlOrMeta'] });
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(beatClip).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');

  // Dragging Take 2 later takes the Beat's Clip with it, still selected.
  await dragClip(page, take, 100);
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBeGreaterThan(4);
  const [movedTake] = await serverClips(bandmate, song.id, 'Lead vox');
  const [movedBeatClip] = await serverClips(bandmate, song.id, 'Beat');
  expect(movedBeatClip.start).toBeGreaterThan(0);
  expect(movedBeatClip.start).toBeCloseTo(movedTake.start - 4, 6);
  expect([movedTake.length, movedBeatClip.length]).toEqual([21, 90]);
  await expect(take).toHaveAccessibleName(/^Take 2, selected, /);
  await expect(beatClip).toHaveAccessibleName(/^Lorem Click, selected, /);
  expect(await extentOf(take)).not.toBe('0:04 to 0:25');

  // One undo brings both back.
  await undo.click();
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(beatClip).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');
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
  await dragMiddleOf(page, take, { x: 3, y: -3 });
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  // Given time for a save that would follow, none does.
  await page.waitForTimeout(500);
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

test('a Split selects and focuses the right half of each Clip it cuts, so Delete trims off what follows the playhead', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const beatClip = clip(page, 'Lorem Click');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const redo = timeline(page).getByRole('button', { name: 'Redo' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // The playhead at 0:10, across Take 2 and the Beat's Clip, 5 s at a time.
  const ruler = timeline(page).getByRole('slider', { name: 'Position' });
  await ruler.press('ArrowRight');
  await ruler.press('ArrowRight');
  await expect(ruler).toHaveAttribute('aria-valuenow', '10');

  // One Clip split: only its right half is selected, and focused.
  await take.click();
  await page.keyboard.press('s');
  await expect(namedClip(page, 'Take 2, selected, 0:10 to 0:25')).toBeFocused();
  await expect(namedClip(page, 'Take 2, 0:04 to 0:10')).toBeVisible();
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([
      { start: 4, length: 6 },
      { start: 10, length: 15 },
    ]);

  // Undone, the whole Clip is selected; redone, only the right half again.
  await undo.click();
  await expect(take).toHaveCount(1);
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await redo.click();
  await expect(namedClip(page, 'Take 2, selected, 0:10 to 0:25')).toBeVisible();
  await expect(namedClip(page, 'Take 2, 0:04 to 0:10')).toBeVisible();
  await undo.click();
  await expect(take).toHaveCount(1);
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');

  // Several split: each one's right half is selected, the left halves not,
  // and focus moves from the Beat's Clip to its right half.
  await beatClip.click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('s');
  await expect(namedClip(page, 'Take 2, selected, 0:10 to 0:25')).toBeVisible();
  await expect(namedClip(page, 'Lorem Click, selected, 0:10 to 1:30')).toBeFocused();
  await expect(namedClip(page, 'Take 2, 0:04 to 0:10')).toBeVisible();
  await expect(namedClip(page, 'Lorem Click, 0:00 to 0:10')).toBeVisible();

  // Delete trims off what follows the playhead, leaving the left halves.
  await page.keyboard.press('Delete');
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toMatchObject([{ start: 4, length: 6 }]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toMatchObject([{ start: 0, length: 10 }]);
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:10');
  await expect(beatClip).toHaveAccessibleName('Lorem Click, 0:00 to 0:10');
});

test('Clips copied and pasted at the playhead on the Chosen Track are selected, and the Clips copied no longer are', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const beat = timeline(page).getByRole('group', { name: 'Track Beat' });
  await expect(clip(page, 'Take 2')).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // Both copied, the Beat chosen, and the playhead at the end, 1:30.
  await clip(page, 'Take 2').click();
  await clip(page, 'Lorem Click').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('ControlOrMeta+c');
  await timeline(page).getByRole('button', { name: 'Choose Beat' }).click();
  await expect(beat).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('End');
  await expect(timeline(page).getByRole('slider', { name: 'Position' })).toHaveAttribute('aria-valuenow', '90');

  // The earliest, the Beat's Clip, starts at the playhead, on the Beat, and
  // Take 2 keeps its place from it, a Track below and 4 s later.
  await page.keyboard.press('ControlOrMeta+v');
  await expect(namedClip(page, 'Lorem Click, selected, 1:30 to 3:00')).toBeVisible();
  await expect(namedClip(page, 'Take 2, selected, 1:34 to 1:55')).toBeVisible();
  await expect(namedClip(page, 'Lorem Click, 0:00 to 1:30')).toBeVisible();
  await expect(namedClip(page, 'Take 2, 0:04 to 0:25')).toBeVisible();
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Beat'))
    .toMatchObject([
      { start: 0, length: 90 },
      { start: 90, length: 90 },
    ]);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([
      { start: 4, length: 21 },
      { start: 94, length: 21 },
    ]);
});

test('Selected Clips merged become one Clip, selected, its Track chosen, and undo and redo take the Merge back and make it again', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const beatClip = clip(page, 'Lorem Click');
  const merged = clip(page, 'Merged Clip');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const redo = timeline(page).getByRole('button', { name: 'Redo' });
  const beat = timeline(page).getByRole('group', { name: 'Track Beat' });
  const leadVox = timeline(page).getByRole('group', { name: 'Track Lead vox' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  const [{ beatId }] = await serverClips(bandmate, song.id, 'Beat');

  // Take 2 clicked, which chooses Lead vox, then the Beat's Clip added, and
  // the Selection's menu opened on Take 2, which keeps Lead vox chosen.
  await take.click();
  await beatClip.click({ modifiers: ['ControlOrMeta'] });
  await take.click({ button: 'right' });
  await expect(leadVox).toHaveAttribute('aria-current', 'true');
  await page.getByRole('menuitem', { name: 'Merge' }).click();

  // One Clip of the span they covered, on the Beat, the topmost of their
  // Tracks with room, which becomes the Chosen Track.
  await expect(merged).toHaveAccessibleName('Merged Clip, selected, 0:00 to 1:30');
  await expect(take).toHaveCount(0);
  await expect(beatClip).toHaveCount(0);
  await expect(beat).toHaveAttribute('aria-current', 'true');
  await expect(leadVox).not.toHaveAttribute('aria-current', 'true');
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Beat'))
    .toMatchObject([{ name: null, beatId: null, start: 0, length: 90 }]);
  expect(await serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);
  const [made] = await serverClips(bandmate, song.id, 'Beat');
  // Nothing came out silent, so no Merge note.
  await expect(timeline(page).getByRole('status').filter({ hasText: 'merged as silence' })).toHaveCount(0);

  // Undone, the Clips are back.
  await undo.click();
  await expect(merged).toHaveCount(0);
  await expect(take).toHaveAccessibleName('Take 2, selected, 0:04 to 0:25');
  await expect(beatClip).toHaveAccessibleName('Lorem Click, selected, 0:00 to 1:30');
  await expect.poll(() => serverClips(bandmate, song.id, 'Lead vox')).toMatchObject([{ start: 4, length: 21 }]);
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toMatchObject([{ beatId, start: 0, length: 90 }]);

  // Redone, they're merged again, into the same Sound, rather than rendering a new one.
  await redo.click();
  await expect(merged).toHaveAccessibleName('Merged Clip, selected, 0:00 to 1:30');
  await expect(take).toHaveCount(0);
  await expect(beatClip).toHaveCount(0);
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Beat'))
    .toMatchObject([{ soundId: made.soundId, start: 0, length: 90 }]);
  expect(await serverClips(bandmate, song.id, 'Lead vox')).toEqual([]);
});

test('a Merge with a muted Track names it in the Merge note, until OK', async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const note = timeline(page).getByRole('status').filter({ hasText: 'merged as silence' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  await timeline(page).getByRole('button', { name: 'Mute Lead vox' }).click();
  await expect(timeline(page).getByRole('button', { name: 'Mute Lead vox' })).toHaveAttribute('aria-pressed', 'true');
  await take.click();
  await clip(page, 'Lorem Click').click({ modifiers: ['ControlOrMeta'] });
  await take.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Merge' }).click();

  await expect(clip(page, 'Merged Clip')).toHaveAccessibleName('Merged Clip, selected, 0:00 to 1:30');
  await expect(note).toContainText('Lead vox is muted, so it merged as silence.');
  await note.getByRole('button', { name: 'OK' }).click();
  await expect(note).toHaveCount(0);
});

test('a Sound imported with Import audio… goes in a new Clip after the Chosen Track’s last Clip, and undo and redo take it away and bring it back', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const first = clip(page, 'night drive');
  const second = clip(page, 'night ride');
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const redo = timeline(page).getByRole('button', { name: 'Redo' });
  await expect(clip(page, 'Take 2')).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  /** Imports a file with Import audio…, from the transport row's ⋯. */
  async function importAudio(name: string) {
    await timeline(page).getByRole('button', { name: 'More Timeline actions' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import audio…' }).click();
    await (await chooser).setFiles(toneWav(name, 2));
  }

  // Lead vox chosen, with the playhead at the start, before Take 2.
  await timeline(page).getByRole('button', { name: 'Choose Lead vox' }).click();
  await importAudio('night drive.wav');

  // Named after its file, it goes where Take 2 ends, not at the playhead.
  await expect(first).toHaveAccessibleName('night drive, 0:25 to 0:27');
  await expect
    .poll(() => serverClips(bandmate, song.id, 'Lead vox'))
    .toMatchObject([
      { start: 4, length: 21 },
      { name: null, beatId: null, start: 25, length: 2 },
    ]);
  expect((await serverClips(bandmate, song.id, 'Lead vox'))[1].soundId).toEqual(expect.any(Number));
  expect(await serverClips(bandmate, song.id, 'Beat')).toHaveLength(1);

  // The next goes after it, now the Track's last Clip.
  await importAudio('night ride.wav');
  await expect(second).toHaveAccessibleName('night ride, 0:27 to 0:29');
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox')).length).toBe(3);
  const [, , imported] = await serverClips(bandmate, song.id, 'Lead vox');
  expect(imported).toMatchObject({ start: 27, length: 2 });

  await undo.click();
  await expect(second).toHaveCount(0);
  await expect(first).toHaveAccessibleName('night drive, 0:25 to 0:27');
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox')).length).toBe(2);

  // Redone, the same Sound is back, rather than the file uploaded again.
  await redo.click();
  await expect(second).toHaveAccessibleName('night ride, 0:27 to 0:29');
  await expect
    .poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[2])
    .toMatchObject({ soundId: imported.soundId, start: 27, length: 2 });
});

test('a Clip moved over Cues offers to move them, naming how many, which moves them, and another edit withdraws the offer', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const take = clip(page, 'Take 2');
  const offer = timeline(page)
    .getByRole('status')
    .filter({ hasText: /^The Clip moved / });
  const accept = offer.getByRole('button', { name: 'Move 4 Cues with it' });
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');
  // Take 2, from 0:04 to 0:25, spans Verse 1's four Cues.
  expect(await serverCues(bandmate, song.id, 'Verse 1')).toEqual([5, 10, 15, 20]);

  // Moved later, it offers to move those four with it.
  await dragClip(page, take, 100);
  await expect(offer).toContainText(/^The Clip moved \d+:\d\d\.\d\s+later\./);
  await expect(accept).toBeVisible();
  await expect.poll(async () => (await serverClips(bandmate, song.id, 'Lead vox'))[0].start).toBeGreaterThan(4);
  const by = (await serverClips(bandmate, song.id, 'Lead vox'))[0].start - 4;

  // Accepted, each moves by as much as the Clip, and the offer's gone.
  await accept.click();
  await expect(offer).toHaveCount(0);
  await expect
    .poll(() => serverCues(bandmate, song.id, 'Verse 1'))
    .toEqual([5 + by, 10 + by, 15 + by, 20 + by].map((c) => expect.closeTo(c, 2)));
  const moved = await serverCues(bandmate, song.id, 'Verse 1');

  // Moved back earlier, it offers again, for the Cues it spans now;
  // deleting the Beat's Clip withdraws it.
  await dragClip(page, take, -100);
  await expect(offer).toContainText(/^The Clip moved \d+:\d\d\.\d\s+earlier\./);
  await expect(offer.getByRole('button', { name: /^Move \d+ Cues with it$/ })).toBeVisible();
  await clip(page, 'Lorem Click').focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => serverClips(bandmate, song.id, 'Beat')).toEqual([]);
  await expect(take).toHaveCount(1);
  expect(await serverClips(bandmate, song.id, 'Lead vox')).toHaveLength(1);
  await expect(offer).toHaveCount(0);
  expect(await serverCues(bandmate, song.id, 'Verse 1')).toEqual(moved);
});

test('Home and End go to the start and the end with focus on the lanes, without scrolling the page, and a volume slider keeps its own', async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  const ruler = timeline(page).getByRole('slider', { name: 'Position' });
  const take = clip(page, 'Take 2');
  await expect(take).toHaveAccessibleName('Take 2, 0:04 to 0:25');

  // Focus on a Clip in the lanes, which a click selects.
  await take.click();
  await expect(take).toBeFocused();
  const scrolled = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('End');
  await expect(ruler).toHaveAttribute('aria-valuetext', /^(\d+:\d+) of \1$/);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await page.keyboard.press('Home');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

  // A Track's volume slider takes Home to its lowest, leaving the playhead be.
  await page.keyboard.press('End');
  const volume = timeline(page).getByRole('slider', { name: 'Volume of Lead vox' });
  const lowest = (await volume.getAttribute('min'))!;
  await expect(volume).not.toHaveValue(lowest);
  await volume.focus();
  await page.keyboard.press('Home');
  await expect(volume).toHaveValue(lowest);
  await expect(ruler).toHaveAttribute('aria-valuetext', /^(\d+:\d+) of \1$/);
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

test("a Master's name and notes typed stay, unsaved, when refused as the Song changed elsewhere", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await bandmate.master(song.id, 'Studio');
  await bandmate.master(song.id, 'Live');
  await page.goto(`/songs/${song.id}`);
  // On desktop, the Masters start folded away.
  await page.getByRole('group').getByText('Masters', { exact: true }).filter({ visible: true }).click();
  const live = page.getByRole('region', { name: 'Masters' }).getByRole('article', { name: 'Live' });
  await expect(live.getByRole('textbox', { name: 'Name' })).toHaveValue('Live');

  // Another tab changes the Song, then this one renames the Master, and is refused.
  await bandmate.retitle(song.id, 'Ballad');
  await live.getByRole('textbox', { name: 'Name' }).fill('Live at the Roxy');
  await live.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'This Song changed elsewhere' })).toBeVisible();
  // What's typed stays where it was typed, to copy out, and so do notes typed after.
  await live.getByRole('textbox', { name: 'Notes' }).fill('Crowd too loud.');
  await live.getByRole('textbox', { name: 'Notes' }).blur();
  await expect(live.getByRole('textbox', { name: 'Name' })).toHaveValue('Live at the Roxy');
  await expect(live.getByRole('textbox', { name: 'Notes' })).toHaveValue('Crowd too loud.');
  expect(await warnsOnLeaving(page)).toBe(true);
  const saved = (await bandmate.getSong(song.id)).masters as { name: string; notes: string }[];
  expect(saved.map(({ name, notes }) => ({ name, notes }))).toEqual([
    { name: 'Studio', notes: '' },
    { name: 'Live', notes: '' },
  ]);
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

test('a Track’s fader let go where it started sends nothing, so an undo of its volume shows at once, and let go elsewhere sends its level', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  const fader = timeline(page).getByRole('slider', { name: 'Volume of Track 1' });
  const undo = timeline(page).getByRole('button', { name: 'Undo' });
  const volume = async () => (await bandmate.timeline(song.id)).tracks[0].volume;

  // Let go anywhere but where it started, it sends its level. The browser
  // sets a fader to where it's pressed, so pressing there again keeps it.
  const middle = await middleOf(fader);
  const left = { x: middle.x - 30, y: middle.y };
  await drag(page, middle, { x: -30, y: 0 });
  await expect.poll(volume).toBeLessThan(0);
  const stepped = String(await volume());
  await expect(fader).toHaveValue(stepped);

  // Dragged away and back, and let go where it started, it sends nothing.
  const saves: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && saves.push(`${r.method()} ${r.url()}`));
  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 5 });
  await expect(fader).not.toHaveValue(stepped);
  await page.mouse.move(left.x, left.y, { steps: 5 });
  await page.mouse.up();
  await expect(fader).toHaveValue(stepped);

  // So undoing the first drag shows on the fader at once.
  await undo.click();
  await expect.poll(volume).toBe(0);
  await expect(fader).toHaveValue('0');
  // The undo's is the only save since.
  expect(saves).toEqual([expect.stringMatching(/^PATCH .*\/tracks\/\d+$/)]);
});

test('a Track name typed and then left with Back is saved', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  // Opened from the Songs list, so Back stays in the app.
  await page.goto('/');
  await page.getByRole('link', { name: 'Anthem', exact: true }).click();
  await timeline(page).getByRole('button', { name: 'Rename Track 1' }).click();
  await timeline(page).getByRole('textbox', { name: 'Name of Track Track 1' }).fill('Lead vox');

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Songs' })).toBeVisible();
  await expect.poll(async () => (await bandmate.timeline(song.id)).tracks.map((t) => t.name)).toEqual(['Lead vox']);
});

test('a name being typed makes closing the tab ask first', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await timeline(page).getByRole('button', { name: 'Rename Track 1' }).click();
  const name = timeline(page).getByRole('textbox', { name: 'Name of Track Track 1' });
  await expect(name).toBeFocused();
  // Opened but not typed in, nothing is unsaved.
  expect(await warnsOnLeaving(page)).toBe(false);

  await name.fill('Lead vox');
  expect(await warnsOnLeaving(page)).toBe(true);

  // Esc takes it back, and nothing is unsaved again.
  await name.press('Escape');
  await expect(timeline(page).getByRole('button', { name: 'Choose Track 1' })).toBeVisible();
  expect(await warnsOnLeaving(page)).toBe(false);
  expect((await bandmate.timeline(song.id)).tracks.map((t) => t.name)).toEqual(['Track 1']);
});

test('custom tuning notes being typed make closing the tab ask first, and Esc takes them back', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  const notes = await pickCustomTuning(page);
  // Custom picked but nothing typed, nothing is unsaved.
  await expect(notes).toHaveValue('E A D G B E');
  expect(await warnsOnLeaving(page)).toBe(false);

  await notes.fill('C G D G');
  expect(await warnsOnLeaving(page)).toBe(true);

  // Esc takes them back, to the tuning as it was, and nothing is unsaved again.
  await notes.press('Escape');
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Tuning' })).toHaveText('—');
  expect(await warnsOnLeaving(page)).toBe(false);
  expect((await bandmate.getSong(song.id)).tuning).toBe('');

  // With a custom tuning saved, Esc takes them back to its notes.
  await (await pickCustomTuning(page)).fill('C G D G B D');
  await notes.press('Enter');
  await expect.poll(async () => (await bandmate.getSong(song.id)).tuning).toBe('C G D G B D');
  await notes.fill('C G C G C E');
  expect(await warnsOnLeaving(page)).toBe(true);
  await notes.press('Escape');
  await expect(notes).toHaveValue('C G D G B D');
  await expect(page.getByRole('combobox', { name: 'Tuning' })).toHaveText('Custom');
  expect(await warnsOnLeaving(page)).toBe(false);
});

test('custom tuning notes that can’t be read are dropped for another tuning picked', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await (await pickCustomTuning(page)).fill('C G D');
  await page.getByRole('combobox', { name: 'Tuning' }).click();
  await expect(saveError(page)).toHaveText('A custom tuning is six notes, low string to high, like D A D G B E');
  await page.getByRole('option', { name: 'Drop D' }).click();
  await expect(customTuningNotes(page)).toHaveCount(0);
  await expect.poll(async () => (await bandmate.getSong(song.id)).tuning).toBe('Drop D');
  expect(await warnsOnLeaving(page)).toBe(false);
});

test('custom tuning notes typed and then left behind are saved', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  // Opened from the Songs list, so Back stays in the app.
  await page.goto('/');
  await page.getByRole('link', { name: 'Anthem', exact: true }).click();

  // Left for Read mode.
  await (await pickCustomTuning(page)).fill('c g d g b d');
  await page.getByRole('radio', { name: 'Read' }).check();
  await expect.poll(async () => (await bandmate.getSong(song.id)).tuning).toBe('C G D G B D');
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('C G D G B D');

  // Left with Back.
  await page.getByRole('radio', { name: 'Write' }).check();
  await customTuningNotes(page).fill('C G C G C E');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Songs' })).toBeVisible();
  await expect.poll(async () => (await bandmate.getSong(song.id)).tuning).toBe('C G C G C E');
});

test('custom tuning notes that can’t be read are dropped as they’re left behind', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto(`/songs/${song.id}`);
  await (await pickCustomTuning(page)).fill('C G D');
  await page.getByRole('radio', { name: 'Read' }).check();
  await expect(saveError(page)).toHaveText('A custom tuning is six notes, low string to high, like D A D G B E');
  expect(await warnsOnLeaving(page)).toBe(false);
  expect((await bandmate.getSong(song.id)).tuning).toBe('');
});
