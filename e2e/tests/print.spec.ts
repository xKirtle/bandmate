import type { Locator, Page } from '@playwright/test';
import type { Bandmate } from '../bandmate';
import { expect, test } from '../fixtures';

// A Song's Print from Read mode: the browser's own print, under print media,
// shows the title, the Details line and the Lyric Sheet as Read mode shows it
// on this device, black on white at paper's own sizes, and nothing else.

/** A finished Song, which opens in Read mode, with Details, Notes, Tags, a Master, a Scrapbook Section and two Sections. */
async function standSong(bandmate: Bandmate) {
  const song = await bandmate.song({ title: 'Music Stand', status: 'finished', tags: ['live'] });
  await bandmate.setDetails(song.id, { key: 'G', capo: 2, bpm: 92, notes: 'Only for me' });
  const verse = (await bandmate.addSection(song.id, 'Verse')).sections.at(-1)!;
  await bandmate.setLines(song.id, verse.alternates[0].id, '[G]Hello [C]world');
  const chorus = (await bandmate.addSection(song.id, 'Chorus')).sections.at(-1)!;
  await bandmate.setLines(song.id, chorus.alternates[0].id, '[D] [G]\nSing it out');
  const idea = (await bandmate.addSection(song.id, 'Idea', 'scrapbook')).sections.at(-1)!;
  await bandmate.setLines(song.id, idea.alternates[0].id, 'A scrapped line');
  await bandmate.master(song.id, 'Final mix');
  return song;
}

/** Keeps choices on this device, as the Reading menu and Settings do: how the Song reads, and how it looks. */
async function onThisDevice(page: Page, kept: Record<string, string>) {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.evaluate((kept) => {
    for (const [key, value] of Object.entries(kept)) localStorage.setItem(key, value);
  }, kept);
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Lyric Sheet' });
const chart = (page: Page) => page.getByRole('region', { name: 'Chord Chart' });
const chordOf = (page: Page, name: string) => sheet(page).locator('.chord span', { hasText: new RegExp(`^${name}$`) });

const style = (el: Locator, property: string) =>
  el.evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property);

/** The Song page printed, as it lays out under print media. */
async function printed(page: Page, songId: number) {
  await page.goto(`/songs/${songId}`);
  await expect(sheet(page).getByRole('region', { name: 'Verse' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
}

test('printing from Read mode shows only the title, the Details line and the Lyric Sheet as Read mode shows it', async ({
  page,
  bandmate,
}) => {
  const song = await standSong(bandmate);
  await onThisDevice(page, { [`bandmate.transpose.${song.id}`]: '2', 'bandmate.chordChart': 'pinned' });
  await printed(page, song.id);

  await expect(page.getByRole('heading', { name: 'Music Stand', level: 1 })).toBeVisible();
  // The Key as written, with the amount beside it, never the Key the Chords are shown in.
  await expect(page.getByText('G · transposed +2 · Capo 2 · 92 BPM', { exact: true })).toBeVisible();
  await expect(page.getByText('A (written G)', { exact: false })).toBeHidden();

  // The Lyric Sheet, its Chords transposed, Labels and Chord Lines with it.
  for (const label of ['Verse', 'Chorus']) {
    await expect(sheet(page).getByRole('heading', { name: label })).toBeVisible();
  }
  await expect(sheet(page).getByText('Hello')).toBeVisible();
  await expect(sheet(page).getByText('Sing it out')).toBeVisible();
  for (const name of ['A', 'D', 'E']) await expect(chordOf(page, name).first()).toBeVisible();
  await expect(chordOf(page, 'G')).toHaveCount(0);

  // The Chord Chart shown, pinned or not, prints above the Lyric Sheet, in the flow of the page.
  await expect(chart(page)).toBeVisible();
  await expect(chart(page)).toContainText('A');
  expect(await style(chart(page), 'position')).toBe('static');
  const chartBox = (await chart(page).boundingBox())!;
  const verseBox = (await sheet(page).getByRole('region', { name: 'Verse' }).boundingBox())!;
  expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(verseBox.y);

  // Nothing else on the page prints.
  const leftOut = [
    page.getByRole('navigation', { name: 'Library' }),
    page.getByRole('region', { name: 'Timeline' }),
    page.getByRole('heading', { name: 'Master' }),
    page.getByText('Final mix'),
    page.getByText('A scrapped line'),
    page.getByRole('radio', { name: 'Read' }),
    page.getByRole('button', { name: 'Undo', exact: true }),
    page.getByRole('button', { name: /Reading/ }),
    page.getByRole('button', { name: 'Auto-scroll' }),
    page.getByRole('button', { name: 'Notes' }),
    page.getByText('live', { exact: true }),
    page.getByText(/^Edited/),
    page.getByText('finished', { exact: true }),
  ];
  for (const what of leftOut) await expect(what).toBeHidden();

  // A Section stays whole on a page, and each page is numbered: what's
  // broken across pages is the browser's, so this checks what it's asked.
  expect(await style(sheet(page).getByRole('region', { name: 'Verse' }), 'break-inside')).toBe('avoid');
});

test('the print is black on white in any Palette, one column, at the same sizes whatever the Lyric Size and Chart Size', async ({
  page,
  bandmate,
}) => {
  const song = await standSong(bandmate);
  const looks = async () => {
    const line = sheet(page).getByText('Sing it out');
    const chord = chordOf(page, 'D').first();
    return {
      page: await style(page.locator('body'), 'background-color'),
      line: await style(line, 'color'),
      chord: await style(chord, 'color'),
      label: await style(sheet(page).getByRole('heading', { name: 'Verse' }), 'color'),
      chordWeight: await style(chord, 'font-weight'),
      lineWeight: await style(line, 'font-weight'),
      lineSize: await style(line, 'font-size'),
      chordSize: await style(chord, 'font-size'),
      chartWidth: (await chart(page).getByRole('listitem').first().boundingBox())!.width,
    };
  };

  await onThisDevice(page, {
    'bandmate.palette': 'ink',
    'bandmate.theme': 'dark',
    'bandmate.lyricSize': '175',
    'bandmate.chartSize': '150',
  });
  await printed(page, song.id);
  const dark = await looks();
  expect(dark).toMatchObject({
    page: 'rgb(255, 255, 255)',
    line: 'rgb(0, 0, 0)',
    chord: 'rgb(0, 0, 0)',
    label: 'rgb(0, 0, 0)',
    chordWeight: '700',
    lineWeight: '400',
  });

  // One column: the Lyric Sheet under the title, across the page.
  const title = (await page.getByRole('heading', { name: 'Music Stand', level: 1 }).boundingBox())!;
  const lyrics = (await sheet(page).boundingBox())!;
  expect(Math.abs(lyrics.x - title.x)).toBeLessThan(16);

  await page.emulateMedia({ media: 'screen' });
  await onThisDevice(page, {
    'bandmate.palette': 'olive',
    'bandmate.theme': 'light',
    'bandmate.lyricSize': '50',
    'bandmate.chartSize': '50',
  });
  await printed(page, song.id);
  expect(await looks()).toEqual(dark);
});

test('printing from Read mode leaves hidden Chords and a hidden Chord Chart off the paper, and any dialog open', async ({
  page,
  bandmate,
}) => {
  const song = await standSong(bandmate);
  await onThisDevice(page, { [`bandmate.chordsHidden.${song.id}`]: '1' });
  await page.goto(`/songs/${song.id}`);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });

  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  await expect(sheet(page).getByText('Sing it out')).toBeVisible();
  await expect(sheet(page).locator('.chord')).toHaveCount(0);
  await expect(chart(page)).toBeHidden();
});
