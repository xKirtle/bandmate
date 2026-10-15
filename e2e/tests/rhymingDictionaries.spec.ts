import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

// Rhyming dictionaries, downloaded to each device in Settings' Rhyming dictionaries card:
// nothing downloaded until one is, Rhymes from those that are, kept across
// reloads, and the Rhymes card's links to download the rest.

/** The Rhymes card, in the side column while Rhyme mode is on. */
const rhymesCard = (page: Page) => page.getByRole('region', { name: 'Rhymes', exact: true });

/** Settings' Rhyming dictionaries card. */
const dictionariesCard = (page: Page) => page.getByRole('region', { name: 'Rhyming dictionaries' });

/** A Language's row in the Rhyming dictionaries card. */
const dictionary = (page: Page, name: string) => dictionariesCard(page).getByRole('listitem').filter({ hasText: name });

/** Opens a Song in Rhyme mode, and looks up a word in the Rhymes card. */
async function lookUp(page: Page, songId: number, word: string) {
  await page.goto(`/songs/${songId}`);
  await page.getByRole('region', { name: 'Lyric Sheet' }).getByRole('button', { name: 'Rhymes', exact: true }).click();
  await rhymesCard(page).getByRole('searchbox', { name: 'Rhymes for' }).fill(word);
}

/** Downloads a Language's rhyming dictionary in Settings. */
async function download(page: Page, name: string) {
  await page.goto('/settings');
  await dictionary(page, name).getByRole('button', { name: 'Download', exact: true }).click();
  await expect(dictionary(page, name)).toContainText('Downloaded, updated');
}

/** Counts the downloads of Language data the page asks for. */
function countDownloads(page: Page) {
  const asked: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/languages\/[\w-]+$/.test(path)) asked.push(path);
  });
  return asked;
}

test('nothing is downloaded until a dictionary is asked for, and the card links to Settings', async ({
  page,
  bandmate,
}) => {
  const asked = countDownloads(page);
  const song = await bandmate.song({ title: 'Anthem' });

  await lookUp(page, song.id, 'night');

  const link = rhymesCard(page).getByRole('link', { name: 'Download the English rhyming dictionary in Settings' });
  await expect(link).toBeVisible();
  expect(asked).toEqual([]);
  await link.click();
  await expect(page).toHaveURL(/\/settings#rhyming-dictionaries$/);
  await expect(dictionary(page, 'English')).toContainText('Not downloaded');
  await expect(dictionary(page, 'English')).toContainText('KB');
});

test('a downloaded dictionary gives Rhymes, after a reload and without Bandmate', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await download(page, 'English');

  await lookUp(page, song.id, 'night');
  await expect(
    rhymesCard(page)
      .getByRole('listitem')
      .filter({ hasText: /^\s*bright\b/ }),
  ).toBeVisible();

  await page.route('**/api/languages/**', (route) => route.abort());
  await lookUp(page, song.id, 'night');
  await expect(
    rhymesCard(page)
      .getByRole('listitem')
      .filter({ hasText: /^\s*bright\b/ }),
  ).toBeVisible();
});

test('a dictionary removed is downloaded no more', async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Anthem' });
  await download(page, 'English');

  await dictionary(page, 'English').getByRole('button', { name: 'Remove' }).click();
  await expect(dictionary(page, 'English')).toContainText('Not downloaded');

  await lookUp(page, song.id, 'night');
  await expect(
    rhymesCard(page).getByRole('link', { name: 'Download the English rhyming dictionary in Settings' }),
  ).toBeVisible();
});

test("a word in no downloaded dictionary asks to download the Song's other Languages", async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Saudade', languages: ['en', 'pt-PT'] });
  await download(page, 'English');

  await lookUp(page, song.id, 'saudade');

  await expect(rhymesCard(page)).toContainText('Not in English.');
  await expect(
    rhymesCard(page).getByRole('link', { name: 'Download the Portuguese (Portugal) rhyming dictionary in Settings' }),
  ).toBeVisible();
});

test("a word in none of the Song's dictionaries has no Rhymes, and says so", async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Saudade', languages: ['pt-PT', 'en'] });
  await download(page, 'English');
  await download(page, 'Portuguese (Portugal)');

  await lookUp(page, song.id, 'saudadezinha');

  await expect(rhymesCard(page)).toContainText('No Rhymes: “saudadezinha” isn’t in the Portuguese (Portugal) dictionary.');
  await rhymesCard(page).getByRole('tab', { name: 'English' }).click();
  await expect(rhymesCard(page)).toContainText('No Rhymes: “saudadezinha” isn’t in the English dictionary.');
});

test("the Language switch links to Settings for a Language that isn't downloaded", async ({ page, bandmate }) => {
  const song = await bandmate.song({ title: 'Saudade', languages: ['en', 'pt-PT'] });
  await download(page, 'English');

  await lookUp(page, song.id, 'night');
  await rhymesCard(page).getByRole('tab', { name: 'Portuguese (Portugal)' }).click();

  await expect(rhymesCard(page)).toContainText('Portuguese (Portugal) isn’t downloaded on this device.');
  await expect(rhymesCard(page).getByRole('link', { name: 'Download it in Settings' })).toBeVisible();
});

/**
 * Keeps a dictionary on this device as a Bandmate before Portuguese became
 * Portuguese (Portugal) did, under `pt`: from a page of Bandmate's that
 * doesn't run the app, so the app finds it there on its next start.
 */
async function keepOldPortuguese(page: Page) {
  await page.goto('/favicon.svg');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('bandmate.dictionaries', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('setUp', { keyPath: 'code' });
          request.result.createObjectStore('data', { keyPath: 'code' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['setUp', 'data'], 'readwrite');
          tx.objectStore('setUp').put({ code: 'pt', updatedAt: '2026-01-02T03:04:05.000Z' });
          tx.objectStore('data').put({ code: 'pt', etag: '"old"', text: 'coração\ncanção\n' });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('a Portuguese dictionary downloaded before it was Portuguese (Portugal) counts as not downloaded', async ({
  page,
  bandmate,
}) => {
  const song = await bandmate.song({ title: 'Saudade', languages: ['pt-PT'] });
  await keepOldPortuguese(page);

  await lookUp(page, song.id, 'coração');

  await expect(
    rhymesCard(page).getByRole('link', { name: 'Download the Portuguese (Portugal) rhyming dictionary in Settings' }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(dictionary(page, 'Portuguese (Portugal)')).toContainText('Not downloaded');

  await download(page, 'Portuguese (Portugal)');
  await lookUp(page, song.id, 'coração');
  await expect(
    rhymesCard(page)
      .getByRole('listitem')
      .filter({ hasText: /^\s*canção\b/ }),
  ).toBeVisible();
});
