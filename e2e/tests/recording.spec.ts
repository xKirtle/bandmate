import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
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

/** The calibration offered before an Input's first recording. */
const calibrationOffer = (page: Page) => page.getByRole('dialog', { name: 'Calibrate the latency' });

/** Skips the calibration offered, to record straight away. */
async function skipCalibration(page: Page) {
  await calibrationOffer(page).getByRole('button', { name: 'Skip and record' }).click();
}

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
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();

  await recordButton(page).click();
  const offer = calibrationOffer(page);
  await expect(offer).toBeVisible();
  // Of the Input the default input is, by name.
  await expect(offer).toContainText(/Before the first recording from .+ · Input 1,/);
  await expect(offer).not.toContainText('Default input');
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
  // Still uncalibrated, so the latency the browser reports places Takes.
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();

  // Not offered again on this device, even after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 1);
  await expect(offer).toHaveCount(0);
  await expect(clip(page, 'Take 1')).toHaveCount(2);
  expect(await clipsOn(bandmate, song.id, 'Track 1')).toHaveLength(2);
});

test('calibration measures each tap as it is heard, until Use this keeps the average', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await hearClicks(page, 0.025);
  await open(page, song.id);
  await seek(page, 5);
  await recordButton(page).click();
  const offer = calibrationOffer(page);
  await offer.getByRole('button', { name: 'Start' }).click();

  const useThis = offer.getByRole('button', { name: 'Use this' });
  const reading = offer.getByRole('status');
  await expect(reading).toHaveText(/^25 ms, from [1-5] taps?$/, { timeout: 10_000 });
  await expect(useThis).toBeDisabled();
  await expect(offer).toContainText('It takes 6 taps in time with the clicks.');
  // From 6 taps, it can be used; from 10, it says how steady it's been.
  await expect(useThis).toBeEnabled({ timeout: 10_000 });
  await expect(reading).toHaveText(/^25 ms, from ([6-9]|\d\d) taps$/);
  await expect(offer).toContainText('Steady: ±0 ms over the last 10', { timeout: 10_000 });
  await expect(offer.getByRole('img', { name: /^Each tap's delay: \d+ taps, averaging 25 ms$/ })).toBeVisible();
  // It never stops on its own.
  await page.waitForTimeout(2_000);
  await expect(useThis).toBeEnabled();

  await useThis.click();
  await expect(offer.getByRole('status')).toContainText(
    /The Latency Offset of .+ · Input 1 is 25 ms, from\s+\d+ taps\./,
  );
  await offer.getByRole('button', { name: 'Record' }).click();
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toBeVisible();
  await playheadPast(page, 5 + 1);
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.025, 3);
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toHaveCount(0);
});

test('calibration cancelled or closed keeps the offset there was', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await hearClicks(page, 0.025);
  await open(page, song.id);
  const offer = calibrationOffer(page);
  const useThis = offer.getByRole('button', { name: 'Use this' });

  await recordButton(page).click();
  await offer.getByRole('button', { name: 'Start' }).click();
  await expect(useThis).toBeEnabled({ timeout: 15_000 });
  await offer.getByRole('button', { name: 'Cancel' }).click();
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();

  // Closed, likewise; and still offered before the first recording, after a reload.
  await recordButton(page).click();
  await offer.getByRole('button', { name: 'Start' }).click();
  await expect(useThis).toBeEnabled({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toBeVisible();
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await recordButton(page).click();
  await expect(offer).toContainText('Before the first recording from');
});

test('a Latency Offset typed in calibration is kept for its Input, as if calibrated', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await open(page, song.id);
  await seek(page, 5);
  await recordButton(page).click();
  const offer = calibrationOffer(page);
  const field = offer.getByRole('spinbutton', { name: /^Latency Offset of .+ · Input 1, in ms$/ });
  const set = offer.getByRole('button', { name: /^Set the Latency Offset of / });

  // Outside 0 to 500 ms, or not whole, it's refused, and nothing is kept.
  for (const typed of ['501', '12.5']) {
    await field.fill(typed);
    await set.click();
    await expect(offer.getByRole('alert')).toHaveText('Type a whole number of ms, from 0 to 500.');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  }
  await expect(offer.getByRole('button', { name: 'Skip and record' })).toBeVisible();

  await field.fill('40');
  await field.press('Enter');
  await expect(offer.getByRole('status')).toContainText(/^The Latency Offset of .+ · Input 1 is 40 ms\./);
  await offer.getByRole('button', { name: 'Record' }).click();
  await expect(offer).toBeHidden();
  await expect(stopButton(page)).toBeVisible();
  await playheadPast(page, 5 + 1);
  await stopButton(page).click();
  await expect(recordButton(page)).toBeEnabled();
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.04, 3);

  // Counted as calibrated: not offered before the next recording, even after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toHaveCount(0);
  await seek(page, 10);
  await record(page, () => recordButton(page).click(), 10 + 1);
  await expect(offer).toHaveCount(0);
  const takes = (await clipsOn(bandmate, song.id, 'Track 1')).map((c) => c.takes[0].latencyOffset);
  expect(takes).toHaveLength(2);
  for (const offset of takes) expect(offset).toBeCloseTo(0.04, 3);
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
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toHaveCount(0);
  await seek(page, 5);
  await record(page, () => recordButton(page).click(), 5 + 2);
  await expect(calibrationOffer(page)).toHaveCount(0);
  const [made] = await clipsOn(bandmate, song.id, 'Track 1');
  expect(made.takes[0].latencyOffset).toBeCloseTo(0.05, 3);

  // Kept so after a reload.
  await page.reload();
  await expect(recordButton(page)).toBeEnabled();
  await expect(timeline(page).getByRole('button', { name: 'Not calibrated' })).toHaveCount(0);
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
  const fault = await failRequests(page, { method: 'POST', url: `**/api/songs/${song.id}/timeline/takes` });

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

test('Settings lists each calibrated Input, to calibrate again, whether or not chosen, or forget', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto('/settings');
  const [first, second] = await page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
      .map(({ deviceId, label }) => ({ deviceId, label, channel: 0 })),
  );
  // The first fake input chosen; it and the second calibrated, and a
  // Scarlett Solo's Input 2 calibrated before it was unplugged.
  const unplugged = { deviceId: 'unplugged', label: 'Scarlett Solo USB (1235:8211)', channel: 1 };
  await page.evaluate(
    ({ first, second, unplugged }) => {
      localStorage.setItem('bandmate.input', JSON.stringify(first));
      localStorage.setItem(
        'bandmate.latencyOffsets',
        JSON.stringify({
          inputs: [
            { ...unplugged, offset: 0.045, offered: true },
            { ...second, offset: 0.034, offered: true },
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

  const recording = page.getByRole('region', { name: 'Recording' });
  const offset = recording.getByRole('definition').nth(1);
  const list = recording.getByRole('list', { name: 'Calibrated inputs' });
  const item = (name: string) => list.getByRole('listitem').filter({ hasText: name });
  const typed = (name: string) => list.getByRole('spinbutton', { name: `Latency Offset of ${name}, in ms` });
  const firstName = `${first.label} · Input 1`;
  const secondName = `${second.label} · Input 1`;
  // By name, with its offset, an unplugged one saying so.
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').first()).toContainText(firstName);
  await expect(typed(firstName)).toHaveValue('21');
  await expect(typed(secondName)).toHaveValue('34');
  await expect(item(secondName)).not.toContainText('Not connected');
  await expect(typed('Scarlett Solo USB · Input 2')).toHaveValue('45');
  await expect(item('Scarlett Solo USB · Input 2')).toContainText('Not connected');
  // Unplugged, it can't be measured, only typed or forgotten.
  await expect(item('Scarlett Solo USB · Input 2').getByRole('button', { name: /again|Forget/ })).toHaveText([
    'Forget',
  ]);
  await expect(offset).toHaveText('21 ms, calibrated');

  // Calibrating one not chosen measures it, not the one chosen.
  await list.getByRole('button', { name: `Calibrate ${secondName} again` }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibrate the latency' });
  await expect(dialog).toContainText(`from ${secondName} after`);
  await dialog.getByRole('button', { name: 'Start' }).click();
  // The fake microphone's tone has no taps to hear, so nothing is measured,
  // but it's the second that's listened to.
  await expect(dialog.getByRole('status')).toHaveText('Tap along with the clicks');
  await expect(dialog.getByRole('button', { name: 'Use this' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([second.deviceId]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(typed(secondName)).toHaveValue('34');
  await expect(offset).toHaveText('21 ms, calibrated');

  // Forgotten, an Input is uncalibrated, and offered calibration before its next recording.
  await list.getByRole('button', { name: `Forget ${firstName}` }).click();
  await expect(item(firstName)).toHaveCount(0);
  await expect(offset).toHaveText('Not calibrated');
  await list.getByRole('button', { name: 'Forget Scarlett Solo USB · Input 2' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveCount(1);

  await open(page, song.id);
  await recordButton(page).click();
  await expect(calibrationOffer(page)).toContainText(`Before the first recording from ${firstName},`);
});

test('a Latency Offset typed in Settings is kept for its Input, leaving Takes where they are', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await page.goto('/settings');
  const [first, second] = await page.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
      .map(({ deviceId, label }) => ({ deviceId, label, channel: 0 })),
  );
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
  const recording = page.getByRole('region', { name: 'Recording' });
  const offset = recording.getByRole('definition').nth(1);
  const list = recording.getByRole('list', { name: 'Calibrated inputs' });
  const firstName = `${first.label} · Input 1`;
  const secondName = `${second.label} · Input 1`;
  const typed = (name: string) => list.getByRole('spinbutton', { name: `Latency Offset of ${name}, in ms` });
  const set = (name: string) => list.getByRole('button', { name: `Set the Latency Offset of ${name}` });

  // Outside 0 to 500 ms, it's refused, and nothing is kept.
  await typed(firstName).fill('501');
  await set(firstName).click();
  await expect(list.getByRole('alert')).toHaveText('Type a whole number of ms, from 0 to 500.');
  await expect(offset).toHaveText('21 ms, calibrated');

  // Typed, it's that Input's alone, and kept after a reload.
  await typed(firstName).fill('48');
  await typed(firstName).press('Enter');
  await expect(list.getByRole('alert')).toHaveCount(0);
  await expect(offset).toHaveText('48 ms, calibrated');
  await typed(secondName).fill('0');
  await set(secondName).click();
  await page.reload();
  await expect(typed(firstName)).toHaveValue('48');
  await expect(typed(secondName)).toHaveValue('0');
  await expect(offset).toHaveText('48 ms, calibrated');

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
