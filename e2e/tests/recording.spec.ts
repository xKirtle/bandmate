import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Bandmate, Clip as SharedClip } from '../bandmate';
import { toneWav } from '../beats';
import { failRequests } from '../faults';
import { expect, test } from '../fixtures';
import { heroSong, recordButton, seek, syncButton } from '../songPage';

// Recording Takes on the Song page's Timeline, from Chromium's fake
// microphone, which captures a half-second 440 Hz tone on a loop. The tests
// check where Takes' Clips land and that their lengths are sensible, never
// the audio. How long a recording runs depends on how fast the page is, so
// lengths are checked within tolerances.

// Only these tests start Chromium with the fake microphone, so this file runs
// in workers of its own. Each worker writes the tone to a file of its own
// before its Chromium starts, for the fake microphone to play.
test.use({
  permissions: ['microphone'],
  launchOptions: [
    async ({}, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'bandmate-e2e-mic-'));
      const tone = join(dir, 'tone.wav');
      writeFileSync(tone, toneWav('tone.wav', 0.5).buffer);
      try {
        await use({
          // As playwright.config.ts picks it. Playwright's own is the full
          // Chromium, not its headless shell, which gives the fake inputs new
          // ids on every page load, as no browser does, so an Input's Latency
          // Offset wouldn't outlast a reload.
          executablePath: process.env.CHROMIUM || undefined,
          channel: process.env.CHROMIUM ? undefined : 'chromium',
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${tone}`,
          ],
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
});

/** How long playback leads in before a Take's Clip starts, in seconds. */
const leadIn = 2;

/** A Take as the Timeline has it, in seconds. */
interface Take {
  id: number;
  number: number;
  duration: number;
  latencyOffset: number;
  /** Where it starts in its Clip's source span, in seconds: not 0 for a Retake with another Latency Offset. */
  position: number;
}

/** A Clip of Takes, in seconds, with the Takes the shared Clip leaves to tests to read. */
type Clip = SharedClip & { takes: Take[]; activeTakeId: number | null };

/** A Track's Clips, as the server has them now. */
async function clipsOn(bandmate: Bandmate, songId: number, name: string): Promise<Clip[]> {
  const track = (await bandmate.timeline(songId)).tracks.find((t) => t.name === name);
  if (!track) throw new Error(`No Track ${name}`);
  return track.clips as Clip[];
}

const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

/** The ruler, whose value is the playhead, in whole seconds. */
const ruler = (page: Page) => timeline(page).getByRole('slider', { name: 'Position' });

const stopButton = (page: Page) => timeline(page).getByRole('button', { name: 'Stop', exact: true });

/** A Clip on the Timeline, by its title, e.g. "Take 1". */
const clip = (page: Page, title: string) => timeline(page).getByRole('group', { name: new RegExp(`^${title}, `) });

/** Opens a Song's page, with its Timeline ready to record. */
async function open(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(recordButton(page)).toBeEnabled();
}

/** The calibration sheet, as offered before an Input's first recording, or opened to calibrate one. */
const calibrationOffer = (page: Page) => page.getByRole('dialog', { name: 'Calibrate the latency' });

/** Skips the calibration offered, to record straight away with the browser's estimate. */
async function skipCalibration(page: Page) {
  await calibrationOffer(page)
    .getByRole('button', { name: /^Skip, use the browser's \d+ ms$/ })
    .click();
}

/** Clicks the backdrop, outside the dialog. */
async function clickOutside(page: Page) {
  await page.mouse.click(5, 5);
}

/** An Input's status pill in an Input list, which opens its row: "21 ms", "Not calibrated" or "Skipped". */
const inputStatus = { name: /^(\d+ ms|Not calibrated|Skipped)$/ };

/** Opens the Timeline's ⋯ → Recording settings, and gives its popover. */
async function openRecordingSettings(page: Page) {
  await timeline(page).getByRole('button', { name: 'More Timeline actions' }).click();
  await page.getByRole('menuitem', { name: /^Recording settings/ }).click();
  const settings = page.getByRole('dialog', { name: 'Recording settings' });
  await expect(settings).toBeVisible();
  return settings;
}

/** The status pill of the chosen Input's row in the recording settings. */
const chosenStatus = (settings: Locator) =>
  settings
    .getByRole('list', { name: 'Inputs' })
    .getByRole('listitem')
    .filter({ has: settings.page().getByRole('radio', { checked: true }) })
    .getByRole('button', inputStatus);

/**
 * Has the microphone hear calibration's clicks, delay seconds after they
 * play, as if from speakers beside it, in place of the fake microphone's
 * tone: each click is a tap, so calibration measures the delay.
 */
async function hearClicks(page: Page, delay: number) {
  await page.addInitScript((delay) => {
    // What each AudioContext hears, through a delay.
    const heard = new WeakMap<BaseAudioContext, DelayNode>();
    const ear = (context: BaseAudioContext) => {
      let node = heard.get(context);
      if (!node) {
        node = context.createDelay(1);
        node.delayTime.value = delay;
        heard.set(context, node);
      }
      return node;
    };
    // A click plays through a gain straight to the speakers.
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (args[0] === this.context.destination && this instanceof GainNode) connect.call(this, ear(this.context));
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    AudioContext.prototype.createMediaStreamSource = function (this: AudioContext) {
      return ear(this) as unknown as MediaStreamAudioSourceNode;
    };
  }, delay);
}

/** Waits for the playhead to pass a time, in seconds, e.g. while recording. */
async function playheadPast(page: Page, time: number) {
  await expect
    .poll(async () => Number(await ruler(page).getAttribute('aria-valuenow')), { timeout: 15_000 })
    .toBeGreaterThan(time);
}

/**
 * Records until the playhead is past `until`, in seconds, then stops,
 * waiting for the Take to save. With skip, skips the calibration offered
 * first, as before an Input's first recording.
 */
async function record(page: Page, start: () => Promise<void>, until: number, { skip = false } = {}) {
  await start();
  if (skip) await skipCalibration(page);
  await expect(stopButton(page)).toBeVisible();
  await playheadPast(page, until);
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
}

// Recordings stop once the playhead's whole seconds pass a time: 2 s past
// the Clip's start means at least 1.5 s were sung, less a few ms of Latency
// Offset. Stopping and saving can run on a few seconds on a slow machine.
const minSung = 1.4;
const overrun = 4;

/**
 * Checks a Clip starts at start, and is sensibly long: longer than least,
 * but by no more than the time sung past it plus overrun; and that it holds
 * its active Take whole.
 */
function expectSung(c: Clip, start: number, least: number) {
  expect(c.start).toBeCloseTo(start, 3);
  expect(c.length).toBeGreaterThan(least);
  expect(c.length).toBeLessThan(least + 2 + overrun);
  expectWholeTake(c);
}

/**
 * Checks a Clip holds its active Take whole from its start on: the Take,
 * captured from the lead-in, is placed its Latency Offset earlier, and the
 * lead-in is kept hidden before the Clip's start.
 */
function expectWholeTake(c: Clip) {
  const take = c.takes.find((t) => t.id === c.activeTakeId);
  if (!take) throw new Error(`Clip ${c.id} has no active Take`);
  // Every Take here starts at 0:05 or later, so its lead-in is never cut short at 0:00.
  expect(c.offset - take.position).toBeCloseTo(leadIn + take.latencyOffset, 2);
  expect(c.offset + c.length - take.position).toBeCloseTo(take.duration, 2);
}

test('calibration offered before the first recording can be skipped, and is not offered again', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  // Nothing in the transport row says it's uncalibrated: Record offers calibration.
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toHaveCount(0);

  await recordButton(page).click();
  const offer = calibrationOffer(page);
  await expect(offer).toBeVisible();
  // Of the Input the default input is, by name, with no Input to pick.
  await expect(offer).toContainText(/ · Input 1\s*Before the first recording from it,/);
  await expect(offer).not.toContainText('Default input');
  await expect(offer.getByRole('radio', { name: /Input/ })).toHaveCount(0);
  await skipCalibration(page);

  // Skipped, it records straight away, saying where to calibrate later.
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toBeVisible();
  await expect(timeline(page).getByRole('status')).toHaveText(
    'Calibrate the latency any time from Recording settings… in the ⋯ menu.',
  );
  await playheadPast(page, leadIn);
  await stopButton(page).click();
  await expect(clip(page, 'Take 1')).toBeVisible();
  // Still uncalibrated, so the latency the browser reports as the Input opens
  // places Takes (it varies from one opening to the next), and the recording
  // settings say it was skipped.
  const [skipped] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(skipped.takes[0].latencyOffset).toBeGreaterThan(0);
  const settings = await openRecordingSettings(page);
  await expect(chosenStatus(settings)).toHaveText('Skipped');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // Not offered again on this device, even after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1);
  await expect(offer).toHaveCount(0);
  await expect(clip(page, 'Take 1')).toHaveCount(2);
  expect(await clipsOn(bandmate, song.id, 'Track 1')).toHaveLength(2);
});

test('calibration is hands-free by default, measures each tap as it is heard, finishes by itself, and Save and record keeps it', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await hearClicks(page, 0.025);
  await open(page, song.id);
  await seek(page, 5);
  await recordButton(page).click();
  const offer = calibrationOffer(page);
  const handsFree = offer.getByRole('radio', { name: /^Hands-free: rest your headphones on the mic/ });
  await expect(handsFree).toBeChecked();
  await expect(offer).toContainText('Turn the volume up for the test, so the mic hears each click clearly.');
  // Tap along points at the clicks heard, and the tip goes with hands-free.
  await offer
    .getByRole('radio', { name: 'Tap along: tap or clap on the mic in time with the clicks you hear' })
    .check();
  await expect(offer).not.toContainText('Turn the volume up');
  await handsFree.check();
  await offer.getByRole('button', { name: 'Start' }).click();

  // Measuring, the close button goes, and Finish now comes once 6 taps count.
  await expect(offer.getByRole('button', { name: 'Close' })).toHaveCount(0);
  const finish = offer.getByRole('button', { name: 'Finish now' });
  const reading = offer.getByRole('status');
  await expect(reading).toHaveText(/^25 ms, from [1-5] taps?$/, { timeout: 10_000 });
  await expect(finish).toHaveCount(0);
  await expect(offer).toContainText(/Finding the taps: [1-5] of 6/);
  await expect(finish).toBeVisible({ timeout: 10_000 });
  await expect(reading).toHaveText(/^25 ms, from [6-9] taps$/);
  // Then it says how far the taps spread, and how precisely their average is
  // known so far, against the precision it finishes at.
  await expect(offer).toContainText(/Your taps spread ±\d+ ms · average good to ±\d+ ms, finishing at ±4 ms/);
  // The metronome marks the taps around the average.
  await expect(
    offer.getByRole('img', { name: /^Metronome, .+, with \d+ taps marked around the average$/ }),
  ).toBeVisible();

  // Hearing the clicks exactly, it finishes by itself from 10 taps. Nothing
  // is kept yet: the result is shown against the browser's estimate.
  await expect(offer.getByRole('status')).toContainText(
    /^25 ms\s*The browser guessed \d+ ms\. From 10 taps spread ±\d+ ms: good to ±\d+ ms\./,
    { timeout: 10_000 },
  );
  await offer.getByRole('button', { name: 'Save and record' }).click();
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toBeVisible();
  await playheadPast(page, 5 + 1);
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.025, 3);
  await expect(chosenStatus(await openRecordingSettings(page))).toHaveText('25 ms');
});

test('Pause, or Esc, pauses calibration without closing it; Quit keeps the offset there was', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await hearClicks(page, 0.025);
  await open(page, song.id);
  const offer = calibrationOffer(page);
  const reading = offer.getByRole('status');
  const finish = offer.getByRole('button', { name: 'Finish now' });

  await recordButton(page).click();
  await offer.getByRole('button', { name: 'Start' }).click();
  await expect(finish).toBeVisible({ timeout: 15_000 });
  // Measuring, a click outside never closes it.
  await clickOutside(page);
  await expect(finish).toBeVisible();

  // Paused, it can be finished with what's measured, started over, or quit.
  await offer.getByRole('button', { name: 'Pause' }).click();
  await expect(reading).toHaveText('Paused');
  await expect(offer.getByRole('button', { name: 'Finish with 25 ms' })).toBeVisible();
  // Paused, neither Esc nor a click outside closes it.
  await page.keyboard.press('Escape');
  await clickOutside(page);
  await page.keyboard.press('Escape');
  await expect(reading).toHaveText('Paused');

  // Started over, it measures from no taps.
  await offer.getByRole('button', { name: 'Start over' }).click();
  await expect(finish).toHaveCount(0);
  await expect(reading).not.toHaveText('Paused');
  await expect(finish).toBeVisible({ timeout: 15_000 });
  // Esc pauses, too.
  await page.keyboard.press('Escape');
  await expect(reading).toHaveText('Paused');

  // The method can be changed, back on the first step.
  await offer.getByRole('button', { name: 'Change method' }).click();
  await expect(offer.getByRole('radio', { name: /^Tap along/ })).toBeVisible();
  await offer.getByRole('radio', { name: /^Tap along/ }).check();
  await offer.getByRole('button', { name: 'Start' }).click();
  await offer.getByRole('button', { name: 'Pause' }).click();

  // Quit keeps nothing, and records nothing.
  await offer.getByRole('button', { name: 'Quit' }).click();
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(chosenStatus(await openRecordingSettings(page))).toHaveText('Not calibrated');
  // Still offered before the first recording, after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await recordButton(page).click();
  await expect(offer).toContainText('Before the first recording from it,');
});

test('a click outside, or Esc, closes calibration before measuring starts', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  const offer = calibrationOffer(page);
  /** Calibrates the Input recorded from, from the recording settings. */
  async function calibrate() {
    const settings = await openRecordingSettings(page);
    await settings.getByRole('button', { name: 'Calibrate', exact: true }).click();
    await expect(settings).toBeHidden();
  }

  await calibrate();
  await expect(offer.getByRole('button', { name: 'Start' })).toBeVisible();
  // Not offered before recording, so there's no skipping it.
  await expect(offer.getByRole('button', { name: /^Skip/ })).toHaveCount(0);
  await clickOutside(page);
  await expect(offer).toBeHidden();

  await calibrate();
  await expect(offer.getByRole('button', { name: 'Start' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toHaveCount(0);
});

test("the Latency Offset calibrated before Inputs had their own becomes the chosen Input's", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  // As an earlier Bandmate kept it, with the default input chosen.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('bandmate.latency', JSON.stringify({ offset: 0.05, offered: true }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await open(page, song.id);

  // The default input's Input has it: not offered, and placed by it.
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 2);
  await expect(calibrationOffer(page)).toHaveCount(0);
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.05, 3);

  // Kept so after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await expect(chosenStatus(await openRecordingSettings(page))).toHaveText('50 ms');
});

test('a Take records on the Chosen Track at the playhead, or after its last Clip', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  // A Track added is chosen; Track 1 is chosen back.
  await timeline(page).getByRole('button', { name: 'Add a Track' }).click();
  await expect(timeline(page).getByRole('group', { name: 'Track Track 2' })).toBeVisible();
  await timeline(page).getByRole('button', { name: 'Choose Track 1' }).click();
  await seek(page, 5);
  await expect(recordButton(page)).toHaveAccessibleDescription(/^Record a Take on Track 1/);

  await record(page, () => recordButton(page).click(), 5 + 2, { skip: true });

  await expect(clip(page, 'Take 1')).toHaveAccessibleName(/^Take 1, 0:05 to \d+:\d\d$/);
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(await clipsOn(bandmate, song.id, 'Track 2')).toEqual([]);
  expect(made.takes).toHaveLength(1);
  expectSung(made, 5, minSung);

  // With the playhead back before it, the next Take goes where it ends, never over it.
  await timeline(page).getByRole('button', { name: 'Go to the start' }).click();
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '0');
  const end = made.start + made.length;
  await record(page, () => recordButton(page).click(), Math.ceil(end) + 1);

  const [first, second] = await clipsOn(bandmate, song.id, 'Track 1');
  expect([first.id, first.start, first.length]).toEqual([made.id, made.start, made.length]);
  // Stopped once the playhead passed the second after `end` rounds up to.
  expectSung(second, end, 0.4);
});

test('a Retake records into its Clip, from its start, growing it', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1, { skip: true });
  const [before] = await clipsOn(bandmate, song.id, 'Track 1');
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
  const [after, ...others] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(others).toEqual([]);
  expect(after.id).toBe(before.id);
  expect(after.takes.map((t) => t.number)).toEqual([1, 2]);
  expect(after.activeTakeId).toBe(after.takes[1].id);
  // Stopped 2 s past where the first Take's Clip ended.
  expectSung(after, 5, before.length + 1);
});

test('Space, once a Take is being captured, stops recording it, keeping it', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await recordButton(page).click();
  await skipCalibration(page);
  await expect(stopButton(page)).toBeVisible();
  await playheadPast(page, 5 + 2);

  // Pressed with nothing focused, so it's the Shortcut that stops it, never a focused Stop button.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');

  await expect(recordButton(page)).toBeEnabled();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(clip(page, 'Take 1')).toHaveAccessibleName(/^Take 1, 0:05 to \d+:\d\d$/);
  const [kept, ...others] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(others).toEqual([]);
  expectSung(kept, 5, minSung);
  // Playback stopped with it.
  await expect(timeline(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('stopping during the lead-in keeps nothing, and says so', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);

  await recordButton(page).click();
  await skipCalibration(page);
  // Stopped as soon as it can be, well inside the 2 s lead-in.
  await stopButton(page).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Recording stopped during the lead-in, so there was nothing to keep.',
  );
  await expect(recordButton(page)).toBeEnabled();
  expect(await clipsOn(bandmate, song.id, 'Track 1')).toEqual([]);
  // Nor is it offered back as unsaved.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await expect(page.getByText(/^Recovered \d+ unsaved/)).toHaveCount(0);
});

test('a Take whose save fails is offered back, and kept after a reload', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  const fault = await failRequests(page, {
    method: 'POST',
    url: `**/api/songs/${song.id}/timeline/takes`,
  });

  await record(page, () => recordButton(page).click(), 5 + 2, { skip: true });

  await fault.spent;
  const offer = page.getByRole('status').filter({ hasText: 'Recovered 1 unsaved Take.' });
  await expect(offer).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Injected failure');
  await expect(clip(page, 'Take 1')).toHaveCount(0);
  expect(await clipsOn(bandmate, song.id, 'Track 1')).toEqual([]);

  // Kept in the browser, it's offered again once the page reloads.
  await page.reload();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Keep' }).click();

  await expect(offer).toBeHidden();
  await expect(clip(page, 'Take 1')).toHaveAccessibleName(/^Take 1, 0:05 to \d+:\d\d$/);
  const [kept, ...others] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(others).toEqual([]);
  expectSung(kept, 5, minSung);
  // Kept, it's no longer offered.
  await page.reload();
  await expect(clip(page, 'Take 1')).toBeVisible();
  await expect(offer).toHaveCount(0);
});

test('undoing a new Take takes it away and returns the playhead to where it started', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1, { skip: true });
  await expect(clip(page, 'Take 1')).toBeVisible();
  // The playhead stopped where the recording did.
  await playheadPast(page, 5);

  await timeline(page).getByRole('button', { name: 'Undo' }).click();

  await expect(clip(page, 'Take 1')).toHaveCount(0);
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', '5');
  await expect(ruler(page)).toHaveAttribute('aria-valuetext', /^0:05 of /);
  expect(await clipsOn(bandmate, song.id, 'Track 1')).toEqual([]);
});

test("Sync mode can't be switched on while recording, and can once it stops", async ({ page, bandmate }) => {
  const song = await heroSong(bandmate);
  await open(page, song.id);
  const sync = syncButton(page);
  await expect(sync).toBeEnabled();

  await recordButton(page).click();
  await skipCalibration(page);
  await expect(stopButton(page)).toBeVisible();
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveAccessibleDescription('Stop recording to sync lyrics');

  // Stopped, whether or not it kept a Take, Sync mode can come on again.
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
  await expect(sync).toBeEnabled();
  await expect(sync).toHaveAttribute('aria-pressed', 'false');
});

/** The fake inputs Chromium lists, as Inputs: each device's first channel. */
async function fakeInputs(page: Page) {
  return page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
      .map(({ deviceId, label }) => ({ deviceId, label, channel: 0 })),
  );
}

/** Settings' Input list, in its Recording card. */
function inputList(page: Page) {
  const recording = page.getByRole('region', { name: 'Recording' });
  const connected = recording.getByRole('list', { name: 'Inputs' });
  /** A connected Input's row, by its name, or the default input's, by /^Default input/. */
  const row = (name: string | RegExp) =>
    connected.getByRole('listitem').filter({
      has: page.getByRole('radio', typeof name === 'string' ? { name, exact: true } : { name }),
    });
  return {
    recording,
    connected,
    notConnected: recording.getByRole('list', { name: 'Not connected' }),
    row,
    radio: (name: string) => connected.getByRole('radio', { name, exact: true }),
    /** A row's status pill, which opens it. */
    pill: (name: string | RegExp) => row(name).getByRole('button', inputStatus),
  };
}

test('Settings lists every Input, connected or not, to record from, calibrate whether or not recorded from, or forget', async ({
  page,
}) => {
  await page.goto('/settings');
  const [first, second] = await fakeInputs(page);
  // The first fake input recorded from; it and the second calibrated, the
  // second's Input 2 skipped, and a Scarlett Solo's Input 2 calibrated
  // before it was unplugged.
  const unplugged = {
    deviceId: 'unplugged',
    label: 'Scarlett Solo USB (1235:8211)',
    channel: 1,
  };
  await page.evaluate(
    ({ first, second, unplugged }) => {
      localStorage.setItem('bandmate.input', JSON.stringify(first));
      localStorage.setItem(
        'bandmate.latencyOffsets',
        JSON.stringify({
          inputs: [
            { ...unplugged, offset: 0.045, offered: true },
            { ...second, offset: 0.034, offered: true },
            { ...second, channel: 1, offset: null, offered: true },
            { ...first, offset: 0.021, offered: true },
          ],
          unclaimed: null,
        }),
      );
    },
    { first, second, unplugged },
  );
  // Which inputs the page opens, by the device asked for.
  await page.addInitScript(() => {
    const opened: string[] = ((window as unknown as { opened: string[] }).opened = []);
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const audio = constraints?.audio;
      const asked = typeof audio === 'object' ? (audio.deviceId as ConstrainDOMStringParameters)?.exact : undefined;
      opened.push(typeof asked === 'string' ? asked : 'default');
      return open(constraints);
    };
  });
  await page.reload();
  const opened = () => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

  const list = inputList(page);
  const firstName = `${first.label} · Input 1`;
  const secondName = `${second.label} · Input 1`;
  // The default input, then each channel of each fake input, calibrated or not, each with its status.
  await expect(list.connected.getByRole('listitem')).toHaveCount(5);
  await expect(list.connected.getByRole('listitem').first()).toContainText('Default input');
  await expect(list.pill(firstName)).toHaveText('21 ms');
  await expect(list.pill(`${first.label} · Input 2`)).toHaveText('Not calibrated');
  await expect(list.pill(secondName)).toHaveText('34 ms');
  await expect(list.pill(`${second.label} · Input 2`)).toHaveText('Skipped');
  // Then the one unplugged, with its offset, to forget.
  await expect(list.notConnected.getByRole('listitem')).toHaveCount(1);
  await expect(list.notConnected.getByRole('listitem')).toContainText('Scarlett Solo USB · Input 2');
  await expect(list.notConnected.getByRole('listitem')).toContainText('45 ms');

  // The Input recorded from is chosen, and open, metering it.
  await expect(list.radio(firstName)).toBeChecked();
  await expect(list.pill(firstName)).toHaveAttribute('aria-expanded', 'true');
  await expect(list.row(firstName).getByRole('meter', { name: 'Level' })).toBeVisible();
  await expect.poll(opened).toEqual([first.deviceId]);

  // Its pill opens another, metering that one in its place.
  await list.pill(secondName).click();
  await expect(list.row(secondName).getByRole('meter', { name: 'Level' })).toBeVisible();
  await expect(list.row(firstName).getByRole('meter')).toHaveCount(0);
  await expect.poll(opened).toEqual([first.deviceId, second.deviceId]);

  // Calibrating one not recorded from measures it, and leaves the choice alone.
  await list.row(secondName).getByRole('button', { name: 'Calibrate again', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibrate the latency' });
  await expect(dialog).toContainText(secondName);
  await dialog.getByRole('button', { name: 'Start' }).click();
  // The fake microphone's tone has no clicks to hear, so nothing is
  // measured, but it's the second that's listened to.
  await expect(dialog.getByRole('status')).toHaveText('Listening for the clicks…', { timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: 'Finish now' })).toHaveCount(0);
  expect((await opened()).at(-1)).toBe(second.deviceId);
  await dialog.getByRole('button', { name: 'Pause' }).click();
  await dialog.getByRole('button', { name: 'Quit' }).click();
  await expect(dialog).toBeHidden();
  await expect(list.pill(secondName)).toHaveText('34 ms');
  await expect(list.radio(firstName)).toBeChecked();

  // The radio changes the Input recorded from, kept after a reload.
  await list.radio(secondName).check();
  await expect(list.radio(firstName)).not.toBeChecked();
  await page.reload();
  await expect(list.radio(secondName)).toBeChecked();
  await expect(list.pill(secondName)).toHaveAttribute('aria-expanded', 'true');

  // Forgotten, the one unplugged is gone, after a reload too.
  await list.notConnected.getByRole('button', { name: 'Forget Scarlett Solo USB · Input 2' }).click();
  await expect(list.notConnected).toHaveCount(0);
  await page.reload();
  await expect(list.pill(secondName)).toHaveText('34 ms');
  await expect(list.notConnected).toHaveCount(0);

  // With the Input chosen unplugged, the default input is recorded from, and said so.
  await page.evaluate((unplugged) => localStorage.setItem('bandmate.input', JSON.stringify(unplugged)), unplugged);
  await page.reload();
  await expect(list.recording.getByRole('status').first()).toHaveText(
    "Scarlett Solo USB isn't connected, so the default input is used.",
  );
  await expect(list.connected.getByRole('radio', { name: /^Default input/ })).toBeChecked();
});

test("the Timeline's recording settings list every Input, to record from, meter, calibrate or type an offset for", async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto('/settings');
  const [first, second] = await fakeInputs(page);
  // The first fake input recorded from, and calibrated.
  await page.evaluate((first) => {
    localStorage.setItem('bandmate.input', JSON.stringify(first));
    localStorage.setItem(
      'bandmate.latencyOffsets',
      JSON.stringify({ inputs: [{ ...first, offset: 0.021, offered: true }], unclaimed: null }),
    );
  }, first);
  await open(page, song.id);

  const settings = await openRecordingSettings(page);
  const connected = settings.getByRole('list', { name: 'Inputs' });
  const firstName = `${first.label} · Input 1`;
  const secondName = `${second.label} · Input 1`;
  const row = (name: string) =>
    connected.getByRole('listitem').filter({ has: page.getByRole('radio', { name, exact: true }) });
  const pill = (name: string) => row(name).getByRole('button', inputStatus);
  // The same list as Settings': the default input, then each fake input's channels.
  await expect(connected.getByRole('listitem').first()).toContainText('Default input');
  await expect(connected.getByRole('radio', { name: firstName, exact: true })).toBeChecked();
  await expect(connected.getByRole('radio', { name: firstName, exact: true })).toBeFocused();
  await expect(pill(firstName)).toHaveText('21 ms');
  await expect(pill(secondName)).toHaveText('Not calibrated');
  // The Input recorded from is open, metering it, and the list fits the popover's width.
  await expect(row(firstName).getByRole('meter', { name: 'Level' })).toBeVisible();
  expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // An offset typed is kept for its Input.
  await pill(secondName).click();
  await expect(row(secondName).getByRole('meter', { name: 'Level' })).toBeVisible();
  await row(secondName).getByRole('button', { name: 'Type it' }).click();
  const field = row(secondName).getByRole('spinbutton', { name: `Latency Offset of ${secondName}, in ms` });
  await field.fill('30');
  await field.press('Enter');
  await expect(pill(secondName)).toHaveText('30 ms');

  // Calibrating one not recorded from closes the popover for the sheet,
  // naming it, and leaves the choice alone.
  await row(secondName).getByRole('button', { name: 'Calibrate again', exact: true }).click();
  await expect(settings).toBeHidden();
  const sheet = calibrationOffer(page);
  await expect(sheet).toContainText(secondName);
  await expect(sheet.getByRole('button', { name: /^Skip/ })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await expect(stopButton(page)).toHaveCount(0);

  // The radio changes the Input recorded from, which Record then records from, with its offset.
  const again = await openRecordingSettings(page);
  await expect(again.getByRole('radio', { name: firstName, exact: true })).toBeChecked();
  await again.getByRole('radio', { name: secondName, exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(again).toBeHidden();
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1);
  await expect(calibrationOffer(page)).toHaveCount(0);
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.03, 3);
});

test('a Latency Offset typed in Settings is kept for its Input, leaving Takes where they are', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto('/settings');
  const [first, second] = await fakeInputs(page);
  // The first fake input chosen; it and the second calibrated.
  await page.evaluate(
    ({ first, second }) => {
      localStorage.setItem('bandmate.input', JSON.stringify(first));
      localStorage.setItem(
        'bandmate.latencyOffsets',
        JSON.stringify({
          inputs: [
            { ...first, offset: 0.021, offered: true },
            { ...second, offset: 0.034, offered: true },
          ],
          unclaimed: null,
        }),
      );
    },
    { first, second },
  );

  // A Take recorded with the first's offset.
  await open(page, song.id);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1);
  const [before] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(before.takes[0].latencyOffset).toBeCloseTo(0.021, 3);

  await page.goto('/settings');
  const list = inputList(page);
  const firstName = `${first.label} · Input 1`;
  const secondName = `${second.label} · Input 1`;
  /** Types an offset for an Input in its row, opening it, and sets it with Enter or Set. */
  async function type(name: string, ms: string, set: 'Enter' | 'Set') {
    if ((await list.pill(name).getAttribute('aria-expanded')) !== 'true') await list.pill(name).click();
    const typeIt = list.row(name).getByRole('button', { name: 'Type it' });
    if ((await typeIt.getAttribute('aria-expanded')) !== 'true') await typeIt.click();
    const field = list.row(name).getByRole('spinbutton', { name: `Latency Offset of ${name}, in ms` });
    await field.fill(ms);
    if (set === 'Enter') await field.press('Enter');
    else
      await list
        .row(name)
        .getByRole('button', { name: `Set the Latency Offset of ${name}` })
        .click();
  }

  // Outside 0 to 500 ms, it's refused, and nothing is kept.
  await type(firstName, '501', 'Set');
  await expect(list.row(firstName).getByRole('alert')).toHaveText('Type a whole number of ms, from 0 to 500.');
  await expect(list.pill(firstName)).toHaveText('21 ms');

  // Typed, it's that Input's alone, and kept after a reload.
  await type(firstName, '48', 'Enter');
  await expect(list.recording.getByRole('alert')).toHaveCount(0);
  await expect(list.pill(firstName)).toHaveText('48 ms');
  await expect(list.pill(secondName)).toHaveText('34 ms');
  await type(secondName, '0', 'Set');
  await expect(list.pill(secondName)).toHaveText('0 ms');
  await page.reload();
  await expect(list.pill(firstName)).toHaveText('48 ms');
  await expect(list.pill(secondName)).toHaveText('0 ms');

  // The Take keeps the offset it was recorded with; the next is placed by the one typed.
  const [after] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(after.takes[0].latencyOffset).toBeCloseTo(0.021, 3);
  expect(after.start).toBe(before.start);
  expect(after.offset).toBe(before.offset);
  await open(page, song.id);
  await seek(page, 10);
  await record(page, () => recordButton(page).click(), 10 + 1);
  await expect(calibrationOffer(page)).toHaveCount(0);
  const offsets = (await clipsOn(bandmate, song.id, 'Track 1')).map((c) => c.takes[0].latencyOffset);
  expect(offsets).toHaveLength(2);
  expect(offsets[1]).toBeCloseTo(0.048, 3);
});

test('a Latency Offset typed for the default input is kept for the Input it turns out to be', async ({ page }) => {
  await page.goto('/settings');
  const list = inputList(page);
  // Nothing chosen, so the default input is recorded from, and open.
  await expect(list.connected.getByRole('radio', { name: /^Default input/ })).toBeChecked();
  await expect(list.pill(/^Default input/)).toHaveText('Not calibrated');

  const row = list.row(/^Default input/);
  await row.getByRole('button', { name: 'Type it' }).click();
  await row.getByRole('spinbutton', { name: 'Latency Offset of Default input, in ms' }).fill('33');
  await row.getByRole('button', { name: 'Set the Latency Offset of Default input' }).click();

  // Kept for the Input the default is, a fake input's first channel, never for the default itself.
  await expect(list.pill(/^Default input/)).toHaveText('33 ms');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('bandmate.latencyOffsets') ?? 'null'));
  expect(kept.inputs).toHaveLength(1);
  expect(kept.inputs[0]).toMatchObject({
    channel: 0,
    offset: 0.033,
    offered: true,
  });
  expect(['', 'default']).not.toContain(kept.inputs[0].deviceId);
  await expect(list.pill(`${kept.inputs[0].label} · Input 1`)).toHaveText('33 ms');
  const pills = list.connected.getByRole('button', inputStatus);
  await expect(pills.filter({ hasText: '33 ms' })).toHaveCount(2);
});

test("calibration's result shows the offset there was, and only Save keeps the new one", async ({ page }) => {
  await page.goto('/settings');
  const [first] = await fakeInputs(page);
  // The first fake input chosen, and calibrated at 21 ms.
  await page.evaluate((first) => {
    localStorage.setItem('bandmate.input', JSON.stringify(first));
    localStorage.setItem(
      'bandmate.latencyOffsets',
      JSON.stringify({
        inputs: [{ ...first, offset: 0.021, offered: true }],
        unclaimed: null,
      }),
    );
  }, first);
  await hearClicks(page, 0.025);
  await page.reload();

  const list = inputList(page);
  const firstName = `${first.label} · Input 1`;
  const offset = list.pill(firstName);
  const dialog = page.getByRole('dialog', { name: 'Calibrate the latency' });
  /** Calibrates the chosen Input, open as it's chosen, up to its result. */
  async function measure() {
    await list.row(firstName).getByRole('button', { name: 'Calibrate again', exact: true }).click();
    await expect(dialog).toContainText(firstName);
    await dialog.getByRole('button', { name: 'Start' }).click();
    // It finishes by itself.
    await expect(dialog.getByRole('status')).toContainText(
      /^25 ms\s*Was 21 ms: \+4 ms\. From \d+ taps spread ±\d+ ms: good to ±\d+ ms\./,
      { timeout: 20_000 },
    );
  }

  // Discarded, the offset there was stays.
  await measure();
  await expect(offset).toHaveText('21 ms');
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toBeHidden();
  await expect(offset).toHaveText('21 ms');

  // Saved, the new one is kept, after a reload too.
  await measure();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(offset).toHaveText('25 ms');
  await page.reload();
  await expect(offset).toHaveText('25 ms');
});
