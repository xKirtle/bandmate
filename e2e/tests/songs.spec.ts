import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

// The Songs page: how it loads, what it lists, and what its search and
// filters keep. On a desktop, it lists them in a table.

/** The Songs page's table. */
const table = (page: Page) => page.getByRole('table');

/** The titles listed, Folders' and Songs', in order. */
const listed = (page: Page) => table(page).getByRole('link');

/** The filter bar, over the table. */
const filters = (page: Page) => page.getByRole('group', { name: 'Filter Songs' });

/** A Song's or a Folder's row in the table. */
const row = (page: Page, title: string) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: title, exact: true }) });

test('the top level lists the Folders first, then the Songs in no Folder', async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  await library.folder('Archive');
  await library.song({ title: 'Inside Song', folder: rehearsals });
  await library.song({ title: 'Anthem' });
  await library.song({ title: 'Ballad' });

  // Sorted by title, the Folders still come first, by name.
  await page.goto('/?sort=title');

  await expect(page.getByRole('heading', { level: 1, name: 'Songs' })).toBeVisible();
  await expect(listed(page)).toHaveText(['Archive', 'Rehearsals', 'Anthem', 'Ballad']);
  await expect(row(page, 'Rehearsals')).toContainText('1 Song');
  await expect(row(page, 'Archive')).toContainText('0 Songs');
  // Only a search or filter shows which Folder a Song is in.
  await expect(table(page).getByRole('columnheader', { name: 'Folder' })).toHaveCount(0);
});

test('a search lists every Song it matches, across Folders, each showing its Folder', async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  const demos = await library.folder('Demos');
  await library.song({ title: 'Night Drive', folder: rehearsals });
  await library.song({ title: 'Night Swim', folder: demos });
  await library.song({ title: 'Nightfall' });
  await library.song({ title: 'Morning' });

  await page.goto('/?sort=title');
  await page.getByRole('searchbox', { name: 'Search Songs by title' }).fill('night');

  // The Folders give way to one list of Songs.
  await expect(listed(page)).toHaveText(['Night Drive', 'Night Swim', 'Nightfall']);
  await expect(table(page).getByRole('columnheader', { name: 'Folder' })).toBeVisible();
  await expect(row(page, 'Night Drive')).toContainText('Rehearsals');
  await expect(row(page, 'Night Swim')).toContainText('Demos');
  await expect(row(page, 'Nightfall')).toContainText('—');
  await expect(page).toHaveURL(/[?&]q=night(&|$)/);

  // The search is kept in the URL, so it's back on a reload.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search Songs by title' })).toHaveValue('night');
  await expect(listed(page)).toHaveText(['Night Drive', 'Night Swim', 'Nightfall']);
});

test('filtering by Status lists the Songs with those Statuses, across Folders', async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  await library.song({ title: 'Idea One', status: 'idea' });
  await library.song({ title: 'Draft One', status: 'drafting' });
  await library.song({ title: 'Draft Two', status: 'drafting', folder: rehearsals });
  await library.song({ title: 'Done One', status: 'finished' });

  await page.goto('/?sort=title');
  await filters(page).getByRole('button', { name: 'Status', exact: true }).click();
  await page.getByRole('dialog', { name: 'Status' }).getByRole('checkbox', { name: 'drafting' }).check();

  await expect(listed(page)).toHaveText(['Draft One', 'Draft Two']);
  await expect(row(page, 'Draft Two')).toContainText('Rehearsals');
  await expect(filters(page).getByRole('button', { name: 'Status: Drafting' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]status=drafting(&|$)/);

  // Statuses picked together list the Songs with any of them.
  await page.getByRole('dialog', { name: 'Status' }).getByRole('checkbox', { name: 'finished' }).check();
  await expect(listed(page)).toHaveText(['Done One', 'Draft One', 'Draft Two']);
  await expect(filters(page).getByRole('button', { name: 'Status: Drafting, Finished' })).toBeVisible();
});

test('filtering by Tag lists the Songs carrying it, across Folders', async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  await library.song({ title: 'Live Opener', tags: ['live', 'loud'] });
  await library.song({ title: 'Live Closer', tags: ['live'], folder: rehearsals });
  await library.song({ title: 'Studio Only', tags: ['loud'] });
  await library.song({ title: 'Untagged' });

  await page.goto('/?sort=title');
  await filters(page).getByRole('button', { name: 'Tags', exact: true }).click();
  const tags = page.getByRole('dialog', { name: 'Tags' });
  await tags.getByRole('checkbox', { name: 'live' }).check();

  await expect(listed(page)).toHaveText(['Live Closer', 'Live Opener']);
  await expect(row(page, 'Live Closer')).toContainText('Rehearsals');
  await expect(page).toHaveURL(/[?&]tag=live(&|$)/);

  // Tags picked together list the Songs carrying all of them.
  await tags.getByRole('checkbox', { name: 'loud' }).check();
  await expect(listed(page)).toHaveText(['Live Opener']);
  await expect(filters(page).getByRole('button', { name: 'Tags: live, loud' })).toBeVisible();
});

test('filters that match nothing say so, and clear', async ({ page, library }) => {
  await library.song({ title: 'Idea One', status: 'idea' });

  await page.goto('/?status=finished');
  await expect(page.getByText('No Songs match.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await expect(listed(page)).toHaveText(['Idea One']);
  await expect(page).toHaveURL(/\/$/);
});

test('inside a Folder, only its Songs are listed, with the way back to every Song', async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  await library.folder('Archive');
  await library.song({ title: 'Opener', folder: rehearsals });
  await library.song({ title: 'Closer', folder: rehearsals });
  await library.song({ title: 'Loose' });

  await page.goto('/?sort=title');
  await page.getByRole('link', { name: 'Rehearsals', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/folders/${rehearsals.id}\\?sort=title$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Rehearsals' })).toBeVisible();
  await expect(listed(page)).toHaveText(['Closer', 'Opener']);
  // No Folders inside a Folder, so no New folder.
  await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0);

  // New Song makes it in the Folder.
  await page.getByRole('button', { name: 'New Song' }).click();
  await expect(page).toHaveURL(/\/songs\/\d+$/);
  const made = (await library.songs()).find((s) => s.title === 'Untitled Song');
  expect(made?.folderId).toBe(rehearsals.id);

  await page.goBack();
  await page.getByRole('link', { name: 'Songs', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Songs' })).toBeVisible();
  await expect(listed(page)).toHaveText(['Archive', 'Rehearsals', 'Loose']);
});

test("a Folder that doesn't exist says it's missing", async ({ page, library }) => {
  const rehearsals = await library.folder('Rehearsals');
  await library.song({ title: 'Opener', folder: rehearsals });

  await page.goto('/folders/999999');

  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
  await expect(page.getByText("This Folder doesn't exist.")).toBeVisible();
  // Nothing to search, filter or make in it.
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Song' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Go to Songs' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Songs' })).toBeVisible();
  await expect(listed(page)).toHaveText(['Rehearsals']);
});

test('an empty library clears filters left in the URL, so the first Song made shows', async ({ page, library }) => {
  await page.goto('/?q=nothing&status=finished&tag=live&hasMaster=true');

  await expect(page.getByText('No Songs yet.')).toBeVisible();
  // With no Songs, there's nothing to search or filter.
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole('button', { name: 'Write your first Song' }).click();
  await expect(page).toHaveURL(/\/songs\/\d+$/);
  expect(await library.songs()).toHaveLength(1);

  // Back on the Songs page, the Song just made shows: no filter hides it.
  await page.goBack();
  await expect(listed(page)).toHaveText(['Untitled Song']);
});
