import type { Locator, Page } from '@playwright/test';
import type { Bandmate, Clip, Song } from './bandmate';

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
  await drag(page, { x, y: box.y + box.height / 2 }, { x: by, y: 0 });
}

/**
 * Presses at a point on the page and drags `by` pixels across and down from
 * it, in steps as a hand would, then lets go.
 */
export async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 5 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 5 });
  await page.mouse.up();
}

/**
 * Drags something on a Clip by its middle, `by` pixels across and down: its
 * gain line or a fade dot, found by the hint it shows on hover, as neither
 * is named for a screen reader.
 */
export async function dragBy(page: Page, target: Locator, by: { x: number; y: number }) {
  const box = await target.boundingBox();
  if (!box) throw new Error('It is not on screen');
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, by);
}

/** A Clip's gain line, by the hint it shows on hover. */
export const gainLine = (target: Locator) => target.getByTitle(/^Gain .*: drag to change it/);

/** A Clip's fade in or fade out dot, by the hint it shows on hover. */
export const fadeDot = (target: Locator, end: 'Fade in' | 'Fade out') => target.getByTitle(new RegExp(`^${end}\\b`));

/** A Line's Cue time in the Lyric Sheet's gutter, e.g. of "Line 1 of Verse 1", outside Sync mode. */
export const cueOf = (page: Page, line: string) => page.getByRole('button', { name: `Cue for ${line}:`, exact: false });

/**
 * The name a Line's Cue time has with this Cue, e.g. 5.1 as "0:05.1",
 * whether or not it goes on to say it's out of order.
 */
export const cueName = (line: string, cue: string) =>
  new RegExp(`^Cue for ${line}: ${cue.replaceAll('.', '\\.')}\\. (Out of order\\. .*)?Change it$`);

/** The Clips on a Track, by its name, as the server has them. */
export async function serverClips(bandmate: Bandmate, songId: number, track: string): Promise<Clip[]> {
  const found = (await bandmate.timeline(songId)).tracks.find((t) => t.name === track);
  if (!found) throw new Error(`No Track "${track}"`);
  return found.clips;
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

/**
 * Whether leaving or reloading the page would ask first, as it does while
 * edits aren't saved. The page is sent the beforeunload the browser sends,
 * and the browser would ask if it was cancelled.
 */
export async function warnsOnLeaving(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    return leaving.defaultPrevented;
  });
}
