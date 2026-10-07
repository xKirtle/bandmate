import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { Bandmate, Song } from './bandmate';

// The Song page, as its tests find it: the Timeline and its Clips, the Lyric
// Sheet's Cues, and the server's Timeline and Cues to read back.

/** The demo Backup's hero Song, restored, with its Beat's Clip and a Clip of two Takes on the Timeline. */
export async function heroSong(bandmate: Bandmate): Promise<Song> {
  const hero = (await bandmate.restoreDemo()).find((s) => s.title === 'Lorem Ipsum');
  if (!hero) throw new Error('The demo Backup has no "Lorem Ipsum"');
  return bandmate.getSong(hero.id);
}

/** The docked Timeline. */
export const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

/** A Clip on the Timeline, by its title, e.g. "Take 2". */
export const clip = (page: Page, title: string) =>
  timeline(page).getByRole('group', {
    name: new RegExp(`^${title}(, selected)?, \\d`),
  });

/** Where a Clip is on the Timeline, as it says: e.g. "0:04 to 0:25". */
export async function extentOf(target: Locator): Promise<string> {
  const name = (await target.getAttribute('aria-label')) ?? '';
  return /(\d+:\d\d to \d+:\d\d)/.exec(name)?.[1] ?? '';
}

/**
 * Drags a Clip by its body, moving it, or by its end, trimming it, `by`
 * pixels along the Timeline, in steps as a hand would.
 */
export async function dragClip(page: Page, target: Locator, by: number, from: 'body' | 'end' = 'body') {
  const box = await target.boundingBox();
  if (!box) throw new Error('The Clip is not on screen');
  // The end's trim edge is a few pixels wide, inside the Clip.
  const x = from === 'body' ? box.x + box.width / 2 : box.x + box.width - 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by / 2, y, { steps: 5 });
  await page.mouse.move(x + by, y, { steps: 5 });
  await page.mouse.up();
}

/** A Line's Cue time in the Lyric Sheet's gutter, e.g. of "Line 1 of Verse 1", outside Sync mode. */
export const cueOf = (page: Page, line: string) => page.getByRole('button', { name: `Cue for ${line}:`, exact: false });

/**
 * The name a Line's Cue time has with this Cue, e.g. 5.1 as "0:05.1",
 * whether or not it goes on to say it's out of order.
 */
export const cueName = (line: string, cue: string) =>
  new RegExp(`^Cue for ${line}: ${cue.replaceAll('.', '\\.')}\\. (Out of order\\. .*)?Change it$`);

/** A Clip as the server has it. */
export interface ServerClip {
  id: number;
  name: string | null;
  start: number;
  offset: number;
  length: number;
}

/** The Song's Timeline as the server has it: its Tracks' names and Clips. */
export async function serverTimeline(
  request: APIRequestContext,
  songId: number,
): Promise<{
  version: number;
  tracks: { name: string; clips: ServerClip[] }[];
}> {
  const res = await request.get(`/api/songs/${songId}/timeline`);
  expect(res.ok()).toBe(true);
  return res.json();
}

/** The Clips on a Track, as the server has them. */
export async function serverClips(request: APIRequestContext, songId: number, track: string): Promise<ServerClip[]> {
  const t = (await serverTimeline(request, songId)).tracks.find((x) => x.name === track);
  if (!t) throw new Error(`No Track "${track}"`);
  return t.clips;
}

interface CuedSong {
  arrangement: number[];
  sections: {
    id: number;
    label: string;
    alternates: { active: boolean; lines: { cue: number | null }[] }[];
  }[];
}

/** The Cues of a Section's active Lines, in order, as the server has them. */
export async function serverCues(bandmate: Bandmate, songId: number, section: string): Promise<(number | null)[]> {
  const song = (await bandmate.getSong(songId)) as unknown as CuedSong;
  const found = song.sections.find((s) => s.label === section);
  if (!found) throw new Error(`No Section "${section}"`);
  return found.alternates.find((a) => a.active)!.lines.map((l) => l.cue);
}

/**
 * Brings a tab back to the front, as switching back to it does, which shows
 * what changed meanwhile. A headless browser keeps every tab visible, so the
 * page is told its visibility changed, as the browser tells it.
 */
export async function comeBackTo(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}
