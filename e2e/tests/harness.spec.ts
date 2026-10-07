import { failRequests, holdRequests, loseAnswers } from '../faults';
import { expect, test } from '../fixtures';

// The suite's own helpers, shown working on the Songs page, so a test of
// another page can lean on them: the demo Backup, and each kind of fault.

test('the demo Backup restores its Songs and Beat', async ({ page, library }) => {
  const songs = await library.restoreDemo();

  expect(songs).toHaveLength(7);
  expect(songs.map((s) => s.title)).toContain('Lorem Ipsum');
  expect(await library.beats()).toHaveLength(1);

  await page.goto('/');
  await expect(page.getByRole('table').getByRole('link', { name: 'Lorem Ipsum', exact: true })).toBeVisible();
});

test('a request failed by a fault shows its error, and the next goes through', async ({ page, library }) => {
  await library.song({ title: 'Anthem' });
  const fault = await failRequests(page, { method: 'GET', url: '**/api/songs?*' }, { error: 'Something broke' });

  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Something broke');
  await fault.spent;
  expect(fault.count).toBe(1);

  await page.reload();
  await expect(page.getByRole('link', { name: 'Anthem', exact: true })).toBeVisible();
});

test("a request whose answer is lost reaches the server, though the app can't tell", async ({ page, library }) => {
  await page.goto('/');
  await expect(page.getByText('No Songs yet.')).toBeVisible();
  const fault = await loseAnswers(page, { method: 'POST', url: '**/api/songs' });

  await page.getByRole('button', { name: 'Write your first Song' }).click();

  await expect(page.getByRole('alert')).toHaveText("Can't reach Bandmate. Check your connection.");
  await fault.spent;
  expect(await library.songs()).toHaveLength(1);
});

test('a held request waits until released', async ({ page, library }) => {
  await library.song({ title: 'Anthem' });
  const hold = await holdRequests(page, { method: 'GET', url: '**/api/folders' });

  await page.goto('/');
  await hold.reached;
  await expect(page.getByText('Loading…')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anthem', exact: true })).toHaveCount(0);

  await hold.release();
  await expect(page.getByRole('link', { name: 'Anthem', exact: true })).toBeVisible();
  expect(hold.held).toHaveLength(1);
});
