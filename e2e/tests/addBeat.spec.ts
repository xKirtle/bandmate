import type { Locator, Page } from '@playwright/test';
import { beatsOnTracks, settled, stubLinkFetches, toneWav, uploadBeat, type FetchedVideo } from '../beats';
import { failRequests } from '../faults';
import { expect, test } from '../fixtures';

// Adding a Beat, in the Beat Library and in the Beat Picker on a Song's
// Timeline: from an audio file, or from a link, whose fetch is stubbed in the
// browser (see beats.ts), as yt-dlp and the network are out of the suite's
// reach. The two places add a Beat each their own way today, which these
// tests pin, differences and all.

/** A file whose name suggests its details: "Dark Trap", at 140 BPM, in Am. */
const darkTrap = () => toneWav('dark_trap_140bpm_Am.wav');

/** A video a link fetches, suggesting its title, producer and link, and its file's BPM and key. */
const nightDrive = (): FetchedVideo => ({
  title: 'Night Drive',
  producer: 'Kofi Beats',
  sourceLink: 'https://www.youtube.com/watch?v=night-drive',
  file: toneWav('night_drive_90bpm_Cm.wav'),
});

/**
 * The POSTs that add a Beat, from a file or a fetched one, sent so far:
 * invalid details are refused before they're sent, which an empty Library
 * afterwards can't tell apart from the server refusing them.
 */
function addsSent(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(beats|fetches\/[^/]+\/beat)$/.test(new URL(r.url()).pathname)) {
      sent.push(r.url());
    }
  });
  return sent;
}

/** A form's Beat fields, by their labels. */
const fields = (form: Locator) => ({
  title: form.getByLabel('Title', { exact: true }),
  producer: form.getByLabel('Producer', { exact: true }),
  sourceLink: form.getByLabel('Source link', { exact: true }),
  bpm: form.getByLabel('BPM', { exact: true }),
  key: form.getByLabel('Key', { exact: true }),
  notes: form.getByLabel('Notes', { exact: true }),
});

test.describe('in the Beat Library', () => {
  /** The form adding a Beat, named for its file. */
  const form = (page: Page) => page.getByRole('form', { name: /^Add “/ });

  /** Picks a file to add, as Add Beat does. */
  async function pick(page: Page, file = darkTrap()) {
    await page.getByLabel('Add Beat', { exact: true }).setInputFiles(file);
  }

  /** The rows of the Beats the Library's table lists. */
  const listed = (page: Page) =>
    page
      .getByRole('table')
      .getByRole('row')
      .filter({ has: page.getByRole('cell') });

  test.beforeEach(async ({ page }) => {
    await page.goto('/beats');
    await expect(page.getByText('No Beats yet.', { exact: false })).toBeVisible();
  });

  test('adds a Beat from a file, with the details its name suggests', async ({ page, bandmate }) => {
    await pick(page);

    await expect(form(page).getByRole('heading')).toHaveText('Add “dark_trap_140bpm_Am.wav” 0:02');
    const f = fields(form(page));
    await expect(f.title).toHaveValue('Dark Trap');
    await expect(f.producer).toHaveValue('');
    await expect(f.bpm).toHaveValue('140');
    await expect(f.key).toHaveValue('Am');

    await f.producer.fill('Pryme');
    await f.notes.fill('Free for non-profit');
    await form(page).getByRole('button', { name: 'Add to Library' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect(listed(page)).toHaveCount(1);
    await expect(listed(page)).toContainText('Dark Trap');
    const [beat] = await bandmate.beats();
    expect(beat).toMatchObject({
      title: 'Dark Trap',
      producer: 'Pryme',
      bpm: 140,
      key: 'Am',
      notes: 'Free for non-profit',
      fileName: 'dark_trap_140bpm_Am.wav',
    });
    expect(beat.duration as number).toBeCloseTo(2, 1);
  });

  test('refuses invalid details without sending them', async ({ page, bandmate }) => {
    const sent = addsSent(page);
    await pick(page);
    const f = fields(form(page));

    // A BPM that isn't a whole number says so.
    await f.bpm.fill('fast');
    await form(page).getByRole('button', { name: 'Add to Library' }).click();
    await expect(page.getByRole('alert')).toHaveText('BPM must be a whole number');

    // A missing Title is the browser's to refuse.
    await f.bpm.fill('140');
    await f.title.fill('');
    await form(page).getByRole('button', { name: 'Add to Library' }).click();
    expect(await f.title.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);

    await expect(form(page)).toBeVisible();
    await settled(page);
    expect(sent).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
  });

  test('keeps the form and its details when the upload fails', async ({ page, bandmate }) => {
    const fault = await failRequests(page, { method: 'POST', url: '**/api/beats' }, { error: 'Disk full' });
    await pick(page);
    const f = fields(form(page));
    await f.producer.fill('Pryme');

    await form(page).getByRole('button', { name: 'Add to Library' }).click();

    await expect(page.getByRole('alert')).toHaveText('Disk full');
    await fault.spent;
    await expect(f.title).toHaveValue('Dark Trap');
    await expect(f.producer).toHaveValue('Pryme');
    expect(await bandmate.beats()).toEqual([]);

    // Trying again adds it.
    await form(page).getByRole('button', { name: 'Add to Library' }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await bandmate.beats()).toMatchObject([{ title: 'Dark Trap', producer: 'Pryme' }]);
  });

  test('Cancel drops the file without adding it', async ({ page, bandmate }) => {
    const sent = addsSent(page);
    await pick(page);
    await expect(form(page)).toBeVisible();

    await form(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('No Beats yet.', { exact: false })).toBeVisible();
    await settled(page);
    expect(sent).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
  });

  test('adds a Beat from a link, with the details the link suggests', async ({ page, bandmate }) => {
    const fetches = await stubLinkFetches(page, nightDrive());

    // An empty Library offers it twice: over the list and in its place.
    await page.getByRole('button', { name: 'Add from link' }).first().click();
    await page.getByLabel('Link to one video').fill('https://youtu.be/night-drive?si=tracking');
    await page.getByRole('button', { name: 'Fetch' }).click();

    await expect(form(page).getByRole('heading')).toHaveText('Add “night_drive_90bpm_Cm.wav” 0:02');
    const f = fields(form(page));
    await expect(f.title).toHaveValue('Night Drive');
    await expect(f.producer).toHaveValue('Kofi Beats');
    await expect(f.sourceLink).toHaveValue('https://www.youtube.com/watch?v=night-drive');
    await expect(f.bpm).toHaveValue('90');
    await expect(f.key).toHaveValue('Cm');
    // What was fetched can be heard before it's added.
    await expect(form(page).getByRole('button', { name: 'Play' })).toBeVisible();

    await f.title.fill('Night Drive (Remix)');
    await form(page).getByRole('button', { name: 'Add to Library' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect(listed(page)).toContainText('Night Drive (Remix)');
    expect(fetches.links).toEqual(['https://youtu.be/night-drive?si=tracking']);
    expect(fetches.added).toMatchObject([
      {
        id: 'stub-1',
        details: {
          title: 'Night Drive (Remix)',
          producer: 'Kofi Beats',
          sourceLink: 'https://www.youtube.com/watch?v=night-drive',
          bpm: 90,
          key: 'Cm',
        },
      },
    ]);
    // Added, it's no longer waiting, so there's nothing to discard. The stub
    // stands in for the server here, so it's what says so.
    await settled(page);
    expect(fetches.discarded).toEqual([]);
    expect(await bandmate.beats()).toMatchObject([{ title: 'Night Drive (Remix)', producer: 'Kofi Beats' }]);
  });

  test('Cancel discards a file fetched from a link', async ({ page, bandmate }) => {
    const fetches = await stubLinkFetches(page, nightDrive());
    await page.getByRole('button', { name: 'Add from link' }).first().click();
    await page.getByLabel('Link to one video').fill('https://youtu.be/night-drive');
    await page.getByRole('button', { name: 'Fetch' }).click();
    await expect(form(page)).toBeVisible();

    await form(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect.poll(() => fetches.discarded).toEqual(['stub-1']);
    expect(fetches.added).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
  });

  test("warns a link's Beat is already in it, and Open it opens that Beat", async ({ page, bandmate }) => {
    await uploadBeat(page.request, toneWav('night.wav'), {
      title: 'Night Drive',
      sourceLink: 'https://www.youtube.com/watch?v=night-drive',
    });
    await page.reload();
    await stubLinkFetches(page, nightDrive());

    await page.getByRole('button', { name: 'Add from link' }).click();
    await page.getByLabel('Link to one video').fill('https://youtu.be/night-drive');
    await page.getByRole('button', { name: 'Fetch' }).click();

    await expect(form(page).getByRole('status')).toHaveText('“Night Drive” is already in the Beat Library. Open it');
    await expect(form(page).getByRole('button', { name: 'Add anyway' })).toBeVisible();

    await form(page).getByRole('button', { name: 'Open it' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit “Night Drive”' })).toBeVisible();
    expect(await bandmate.beats()).toHaveLength(1);
  });
});

test.describe('in the Beat Picker', () => {
  /** The Beat Picker, over the Song page. */
  const picker = (page: Page) => page.getByRole('dialog', { name: 'Add a Beat' });

  /** The Picker's form adding a Beat. */
  const form = (page: Page) =>
    picker(page)
      .locator('form')
      .filter({ has: page.getByLabel('Title', { exact: true }) });

  /** Opens a new Song, with Track 1 and Track 2, Track 1 chosen, and its Beat Picker. */
  async function openPicker(page: Page, songId: number) {
    await page.goto(`/songs/${songId}`);
    await page.getByRole('button', { name: 'Add a Track' }).click();
    // A Track added is chosen; Track 1 is chosen back, so the Beat can't land on the bottom Track by default.
    await expect(page.getByRole('group', { name: 'Track Track 2' })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Choose Track 1' }).click();
    await expect(page.getByRole('group', { name: 'Track Track 1' })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Beat', exact: true }).click();
    await expect(picker(page)).toBeVisible();
  }

  /** Picks a file to add, as Upload new does. */
  async function pick(page: Page, file = darkTrap()) {
    await picker(page).getByLabel('Upload new').setInputFiles(file);
  }

  /** Fetches the stubbed link, as From link does. */
  async function fetchLink(page: Page) {
    await picker(page).getByRole('button', { name: 'From link' }).click();
    await picker(page).getByLabel('Link to one video').fill('https://youtu.be/night-drive');
    await picker(page).getByRole('button', { name: 'Fetch' }).click();
    await expect(form(page)).toBeVisible();
  }

  test('adds a Beat from a file to the Library and onto the Chosen Track', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    await openPicker(page, song.id);
    await pick(page);

    await expect(form(page).getByText('“dark_trap_140bpm_Am.wav” 0:02')).toBeVisible();
    const f = fields(form(page));
    await expect(f.title).toHaveValue('Dark Trap');
    await expect(f.bpm).toHaveValue('140');
    await expect(f.key).toHaveValue('Am');
    await f.producer.fill('Pryme');

    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();

    await expect(picker(page)).toHaveCount(0);
    const [beat] = await bandmate.beats();
    expect(beat).toMatchObject({ title: 'Dark Trap', producer: 'Pryme', bpm: 140, key: 'Am' });
    await expect.poll(() => beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [beat.id], 'Track 2': [] });
  });

  test('refuses invalid details without sending them', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    const sent = addsSent(page);
    await openPicker(page, song.id);
    await pick(page);
    const f = fields(form(page));

    await f.bpm.fill('fast');
    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();
    await expect(picker(page).getByRole('alert')).toHaveText('BPM must be a whole number');

    await f.bpm.fill('140');
    await f.title.fill('');
    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();
    expect(await f.title.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);

    await expect(form(page)).toBeVisible();
    await settled(page);
    expect(sent).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
    expect(await beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [], 'Track 2': [] });
  });

  test('keeps the form and its details when the upload fails', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    await openPicker(page, song.id);
    const fault = await failRequests(page, { method: 'POST', url: '**/api/beats' }, { error: 'Disk full' });
    await pick(page);
    const f = fields(form(page));
    await f.producer.fill('Pryme');

    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();

    await expect(picker(page).getByRole('alert')).toHaveText('Disk full');
    await fault.spent;
    await expect(f.title).toHaveValue('Dark Trap');
    await expect(f.producer).toHaveValue('Pryme');
    expect(await bandmate.beats()).toEqual([]);

    // Trying again adds it, and places it.
    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();
    await expect(picker(page)).toHaveCount(0);
    const [beat] = await bandmate.beats();
    expect(beat).toMatchObject({ title: 'Dark Trap', producer: 'Pryme' });
    await expect.poll(() => beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [beat.id], 'Track 2': [] });
  });

  test('Back returns to the Library list without adding the file', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    const sent = addsSent(page);
    await openPicker(page, song.id);
    await pick(page);
    await expect(form(page)).toBeVisible();

    await form(page).getByRole('button', { name: 'Back' }).click();

    await expect(form(page)).toHaveCount(0);
    await expect(picker(page).getByText('The Beat Library is empty.')).toBeVisible();
    await settled(page);
    expect(sent).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
    expect(await beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [], 'Track 2': [] });
  });

  test('adds a Beat from a link to the Library and onto the Chosen Track', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    await openPicker(page, song.id);
    const fetches = await stubLinkFetches(page, nightDrive());
    await fetchLink(page);

    await expect(form(page).getByText('“night_drive_90bpm_Cm.wav” 0:02')).toBeVisible();
    const f = fields(form(page));
    await expect(f.title).toHaveValue('Night Drive');
    await expect(f.producer).toHaveValue('Kofi Beats');
    await expect(f.sourceLink).toHaveValue('https://www.youtube.com/watch?v=night-drive');
    await expect(f.bpm).toHaveValue('90');
    await expect(f.key).toHaveValue('Cm');

    await form(page).getByRole('button', { name: 'Add to Library and Song' }).click();

    await expect(picker(page)).toHaveCount(0);
    expect(fetches.added).toMatchObject([{ id: 'stub-1', details: { title: 'Night Drive', bpm: 90, key: 'Cm' } }]);
    // Added, it's never discarded, though the Picker closed.
    await settled(page);
    expect(fetches.discarded).toEqual([]);
    const [beat] = await bandmate.beats();
    expect(beat).toMatchObject({ title: 'Night Drive', producer: 'Kofi Beats' });
    await expect.poll(() => beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [beat.id], 'Track 2': [] });
  });

  // #710 changes this on purpose: Back will discard the fetched file at once,
  // as Cancel in the Beat Library does.
  test('Back leaves a file fetched from a link waiting on the server, to expire', async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    await openPicker(page, song.id);
    const fetches = await stubLinkFetches(page, nightDrive());
    await fetchLink(page);

    await form(page).getByRole('button', { name: 'Back' }).click();
    await expect(form(page)).toHaveCount(0);
    // Nor does closing the Picker discard it.
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);

    // Opening the Picker again lists the Library, a request made after any
    // discard would have been.
    const listed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/beats');
    await page.getByRole('button', { name: 'Beat', exact: true }).click();
    await listed;
    expect(fetches.discarded).toEqual([]);
    expect(fetches.added).toEqual([]);
    expect(await bandmate.beats()).toEqual([]);
  });

  test("warns a link's Beat is already in the Library, and Use it places that Beat", async ({ page, bandmate }) => {
    const song = await bandmate.song({ title: 'Anthem' });
    const existing = await uploadBeat(page.request, toneWav('night.wav'), {
      title: 'Night Drive',
      sourceLink: 'https://www.youtube.com/watch?v=night-drive',
    });
    await openPicker(page, song.id);
    const fetches = await stubLinkFetches(page, nightDrive());
    await fetchLink(page);

    await expect(form(page).getByRole('status')).toHaveText('“Night Drive” is already in the Beat Library. Use it');
    await expect(form(page).getByRole('button', { name: 'Add anyway' })).toBeVisible();

    await form(page).getByRole('button', { name: 'Use it' }).click();

    await expect(picker(page)).toHaveCount(0);
    await expect.poll(() => beatsOnTracks(page.request, song.id)).toEqual({ 'Track 1': [existing.id], 'Track 2': [] });
    expect(fetches.added).toEqual([]);
    expect(await bandmate.beats()).toHaveLength(1);
  });
});
