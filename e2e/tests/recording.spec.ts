import { resolve } from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { failRequests } from '../faults';
import { expect, test } from '../fixtures';

// Recording Takes on the Song page's Timeline, from Chromium's fake
// microphone, which captures media/tone.wav on a loop: a half-second 440 Hz
// tone, mono, 16-bit at 48 kHz. The tests check where Takes' Clips land and
// that their lengths are sensible, never the audio. How long a recording
// runs depends on how fast the page is, so lengths are checked within
// tolerances.

const tone = resolve(import.meta.dirname, '../media/tone.wav');

// Only these tests start Chromium with the fake microphone, so this file runs
// in workers of its own.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    // As playwright.config.ts picks it.
    executablePath: process.env.CHROMIUM || undefined,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${tone}`,
    ],
  },
});

/** How long playback leads in before a Take's Clip starts, in seconds. */
const leadIn = 2;

/** A Take as the Timeline has it, in seconds. */
interface Take {
  id: number;
  number: number;
  duration: number;
  latencyOffset: number;
}

/** A Clip as the Timeline has it, in seconds. */
interface Clip {
  id: number;
  start: number;
  offset: number;
  length: number;
  takes: Take[];
  activeTakeId: number | null;
}

interface Track {
  id: number;
  name: string;
  clips: Clip[];
}

/** A Song's Timeline's Tracks, top to bottom, read back from the server. */
async function tracks(request: APIRequestContext, songId: number): Promise<Track[]> {
  const res = await request.get(`/api/songs/${songId}/timeline`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { tracks: Track[] }).tracks;
}

/** A Track's Clips, read back from the server. */
async function clipsOn(request: APIRequestContext, songId: number, name: string): Promise<Clip[]> {
  const track = (await tracks(request, songId)).find((t) => t.name === name);
  expect(track, `No Track ${name}`).toBeDefined();
  return track!.clips;
}

const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

/** The ruler, whose value is the playhead, in whole seconds. */
const ruler = (page: Page) => timeline(page).getByRole('slider', { name: 'Position' });

const recordButton = (page: Page) => timeline(page).getByRole('button', { name: 'Record', exact: true });
const stopButton = (page: Page) => timeline(page).getByRole('button', { name: 'Stop', exact: true });

/** A Clip on the Timeline, by its title, e.g. "Take 1". */
const clip = (page: Page, title: string) => timeline(page).getByRole('group', { name: new RegExp(`^${title}, `) });

/** Opens a Song's page, with its Timeline ready to record. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(recordButton(page)).toBeEnabled();
}

/** Moves the playhead to a whole number of seconds, 5 s at a time from the ruler. */
async function seek(page: Page, to: number) {
  expect(to % 5).toBe(0);
  for (let at = 0; at < to; at += 5) await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', String(to));
}

/**
 * Records until the playhead is past `until`, in seconds, then stops,
 * waiting for the Take to save. With skip, skips the calibration offered
 * first, as before a device's first recording.
 */
async function record(page: Page, start: () => Promise<void>, until: number, { skip = false } = {}) {
  await start();
  if (skip)
    await page
      .getByRole('dialog', { name: 'Calibrate the latency' })
      .getByRole('button', { name: 'Skip and record' })
      .click();
  await expect(stopButton(page)).toBeVisible();
  await expect
    .poll(async () => Number(await ruler(page).getAttribute('aria-valuenow')), { timeout: 15_000 })
    .toBeGreaterThan(until);
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
}

/**
 * Checks a Clip holds its active Take whole from its start on: the Take,
 * captured from the lead-in, is placed its Latency Offset earlier, and the
 * lead-in is kept hidden before the Clip's start.
 */
function expectWholeTake(c: Clip) {
  const take = c.takes.find((t) => t.id === c.activeTakeId)!;
  expect(take, 'its active Take').toBeDefined();
  expect(c.offset).toBeCloseTo(leadIn + take.latencyOffset, 2);
  expect(c.offset + c.length).toBeCloseTo(take.duration, 2);
}

test('calibration offered before the first recording can be skipped, and is not offered again', async ({
  page,
  bandmate,
  request,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();

  await recordButton(page).click();
  const offer = page.getByRole('dialog', { name: 'Calibrate the latency' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Skip and record' }).click();

  // Skipped, it records straight away, saying where to calibrate later.
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toBeVisible();
  await expect(timeline(page).getByRole('status')).toHaveText(
    'Calibrate the latency any time from Recording settings… in the ⋯ menu.',
  );
  await expect.poll(async () => Number(await ruler(page).getAttribute('aria-valuenow'))).toBeGreaterThan(leadIn);
  await stopButton(page).click();
  await expect(clip(page, 'Take 1')).toBeVisible();
  // Still uncalibrated, so the latency the browser reports places Takes.
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();

  // Not offered again on this device, even after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1);
  await expect(offer).toHaveCount(0);
  await expect(clip(page, 'Take 1')).toHaveCount(2);
  expect(await clipsOn(request, song.id, 'Track 1')).toHaveLength(2);
});

test('a Take records on the Chosen Track at the playhead, or after its last Clip', async ({
  page,
  bandmate,
  request,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  // A Track added is chosen; Track 1 is chosen back.
  await timeline(page).getByRole('button', { name: 'Add a Track' }).click();
  await expect(timeline(page).getByRole('group', { name: 'Track Track 2' })).toBeVisible();
  await timeline(page).getByRole('button', { name: 'Choose Track 1' }).click();
  await seek(page, 5);
  await expect(recordButton(page)).toHaveAttribute('title', /^Record a Take on Track 1/);

  await record(page, () => recordButton(page).click(), 5 + 2, { skip: true });

  await expect(clip(page, 'Take 1')).toHaveAccessibleName(/^Take 1, 0:05 to 0:0[6-9]$/);
  const [take] = await clipsOn(request, song.id, 'Track 1');
  expect(await clipsOn(request, song.id, 'Track 2')).toEqual([]);
  expect(take.start).toBeCloseTo(5, 3);
  // Stopped once the playhead passed 0:07: at least 1.5 s were sung.
  expect(take.length).toBeGreaterThan(1.4);
  expect(take.length).toBeLessThan(6);
  expect(take.takes).toHaveLength(1);
  expectWholeTake(take);

  // With the playhead back before it, the next Take goes where it ends, never over it.
  await timeline(page).getByRole('button', { name: 'Go to the start' }).click();
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '0');
  const end = take.start + take.length;
  await record(page, () => recordButton(page).click(), Math.ceil(end) + 1);

  const [first, second] = await clipsOn(request, song.id, 'Track 1');
  expect(first).toEqual(take);
  expect(second.start).toBeCloseTo(end, 3);
  expect(second.length).toBeGreaterThan(0.4);
  expect(second.length).toBeLessThan(6);
  expectWholeTake(second);
});

test('a Retake records into its Clip, from its start, growing it', async ({ page, bandmate, request }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1, { skip: true });
  const [before] = await clipsOn(request, song.id, 'Track 1');
  // Seeked away, a Retake still starts from its Clip's start.
  await timeline(page).getByRole('button', { name: 'Go to the start' }).click();

  await record(
    page,
    async () => {
      // Its menu, from the keyboard: its button shows only on hover, and only where it fits.
      await clip(page, 'Take 1').focus();
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: 'Retake', exact: true }).click();
    },
    Math.ceil(before.start + before.length) + 2,
  );

  // The same Clip, playing its second Take, now longer.
  await expect(clip(page, 'Take 2')).toHaveAccessibleName(/^Take 2(, selected)?, 0:05 to /);
  await expect(clip(page, 'Take 1')).toHaveCount(0);
  const [after, ...others] = await clipsOn(request, song.id, 'Track 1');
  expect(others).toEqual([]);
  expect(after.id).toBe(before.id);
  expect(after.start).toBeCloseTo(5, 3);
  expect(after.takes.map((t) => t.number)).toEqual([1, 2]);
  expect(after.activeTakeId).toBe(after.takes[1].id);
  expect(after.length).toBeGreaterThan(before.length + 1);
  expect(after.length).toBeLessThan(10);
  expectWholeTake(after);
});

test('stopping during the lead-in keeps nothing, and says so', async ({ page, bandmate, request }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);

  await recordButton(page).click();
  await page
    .getByRole('dialog', { name: 'Calibrate the latency' })
    .getByRole('button', { name: 'Skip and record' })
    .click();
  // Stopped as soon as it can be, well inside the 2 s lead-in.
  await stopButton(page).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Recording stopped during the lead-in, so there was nothing to keep.',
  );
  await expect(recordButton(page)).toBeEnabled();
  expect(await clipsOn(request, song.id, 'Track 1')).toEqual([]);
  // Nor is it offered back as unsaved.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await expect(page.getByText(/^Recovered \d+ unsaved/)).toHaveCount(0);
});

test('a Take whose save fails is offered back, and kept after a reload', async ({ page, bandmate, request }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  const fault = await failRequests(page, { method: 'POST', url: `**/api/songs/${song.id}/timeline/takes` });

  await record(page, () => recordButton(page).click(), 5 + 2, { skip: true });

  await fault.spent;
  const offer = page.getByRole('status').filter({ hasText: 'Recovered 1 unsaved Take.' });
  await expect(offer).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Injected failure');
  await expect(clip(page, 'Take 1')).toHaveCount(0);
  expect(await clipsOn(request, song.id, 'Track 1')).toEqual([]);

  // Kept in the browser, it's offered again once the page reloads.
  await page.reload();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Keep' }).click();

  await expect(offer).toBeHidden();
  await expect(clip(page, 'Take 1')).toHaveAccessibleName(/^Take 1, 0:05 to 0:0[6-9]$/);
  const [take, ...others] = await clipsOn(request, song.id, 'Track 1');
  expect(others).toEqual([]);
  expect(take.start).toBeCloseTo(5, 3);
  expect(take.length).toBeGreaterThan(1.4);
  expect(take.length).toBeLessThan(6);
  expectWholeTake(take);
  // Kept, it's no longer offered.
  await page.reload();
  await expect(clip(page, 'Take 1')).toBeVisible();
  await expect(offer).toHaveCount(0);
});

test('undoing a new Take takes it away and returns the playhead to where it started', async ({
  page,
  bandmate,
  request,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1, { skip: true });
  await expect(clip(page, 'Take 1')).toBeVisible();
  // The playhead stopped where the recording did.
  expect(Number(await ruler(page).getAttribute('aria-valuenow'))).toBeGreaterThan(5);

  await timeline(page).getByRole('button', { name: 'Undo' }).click();

  await expect(clip(page, 'Take 1')).toHaveCount(0);
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '5');
  await expect(ruler(page)).toHaveAttribute('aria-valuetext', /^0:05 of /);
  expect(await clipsOn(request, song.id, 'Track 1')).toEqual([]);
});
