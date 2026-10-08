import { expect, type Locator, type Page } from '@playwright/test';
import type { Bandmate, Clip, Song } from './bandmate';

// The Song page, as its tests find it: the Timeline and its Clips, the Lyric
// Sheet's Cues, the tuning field it shares with the Chord Finder, and the
// server's Timeline and Cues to read back.

/** The demo Backup's hero Song, restored, with its Beat's Clip and a Clip of two Takes on the Timeline. */
export async function heroSong(bandmate: Bandmate): Promise<Song> {
  const hero = (await bandmate.restoreDemo()).find((s) => s.title === 'Lorem Ipsum');
  if (!hero) throw new Error('The demo Backup has no "Lorem Ipsum"');
  return bandmate.getSong(hero.id);
}

/** The docked Timeline. */
export const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline' });

/** The Timeline's ruler, whose value is the playhead, in whole seconds. */
export const ruler = (page: Page) => timeline(page).getByRole('slider', { name: 'Position' });

/** The Timeline's Play button, shown while it's stopped. */
export const playButton = (page: Page) => timeline(page).getByRole('button', { name: 'Play', exact: true });

/** The Timeline's Pause button, shown while it plays. */
export const pauseButton = (page: Page) => timeline(page).getByRole('button', { name: 'Pause', exact: true });

/** The Timeline's Loop switch. */
export const loopButton = (page: Page) => timeline(page).getByRole('button', { name: 'Loop', exact: true });

/** The Timeline's Record button, shown while it isn't recording. */
export const recordButton = (page: Page) => timeline(page).getByRole('button', { name: 'Record', exact: true });

// The top of the ruler, where a Loop is set by dragging, is pointer only and
// isn't named for a screen reader, so it's found by the hint it shows on hover.

/** The top of the ruler, dragged along to set a Loop. */
export const loopBar = (page: Page) => timeline(page).getByTitle('Drag to set a Loop');

/** One of the Loop's edges, dragged along the top of the ruler to move it. */
export const loopEdge = (page: Page, edge: 'start' | 'end') =>
  timeline(page).getByTitle(`Drag to move the Loop's ${edge}`);

/** The Lyric Sheet's Sync lyrics switch, which switches Sync mode on and off. */
export const syncButton = (page: Page) => page.getByRole('button', { name: 'Sync lyrics' });

/** Where the playhead is now, in whole seconds, as the ruler says. */
export async function playhead(page: Page): Promise<number> {
  return Number(await ruler(page).getAttribute('aria-valuenow'));
}

/** Waits for the playhead to reach a time, in whole seconds, e.g. while playing. */
export async function playheadReaches(page: Page, time: number, { timeout = 15_000 } = {}) {
  await expect.poll(() => playhead(page), { timeout }).toBeGreaterThanOrEqual(time);
}

/** Moves the playhead from 0:00 to a whole number of seconds, 5 s at a time from the ruler. */
export async function seek(page: Page, to: number) {
  expect(to % 5).toBe(0);
  for (let at = 0; at < to; at += 5) await ruler(page).press('ArrowRight');
  await expect(ruler(page)).toHaveAttribute('aria-valuenow', String(to));
}

/** A Clip on the Timeline, by its title, e.g. "Take 2". */
export const clip = (page: Page, title: string) =>
  timeline(page).getByRole('group', {
    name: new RegExp(`^${title}(, selected)?, \\d`),
  });

/** A Clip on the Timeline, by the whole of what it's called, e.g. "Take 2, selected, 0:10 to 0:25". */
export const namedClip = (page: Page, name: string) => timeline(page).getByRole('group', { name, exact: true });

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

/** A point on the page, or how far across and down to go from one, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Presses at a point on the page and drags `by` pixels across and down from
 * it, in steps as a hand would, then lets go.
 */
export async function drag(page: Page, from: Point, by: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 5 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 5 });
  await page.mouse.up();
}

/** The middle of something on screen. */
export async function middleOf(target: Locator): Promise<Point> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses something on screen in its middle and drags it `by` pixels across and down. */
export async function dragMiddleOf(page: Page, target: Locator, by: Point) {
  await drag(page, await middleOf(target), by);
}

// A Clip's gain line and fade dots aren't named for a screen reader, so
// they're found by the hint each shows on hover.

/** A Clip's gain line. */
export const gainLine = (target: Locator) => target.getByTitle(/^Gain .*: drag to change it/);

/** A Clip's fade in or fade out dot. */
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

/** Whether the server has a Song's Loop on. */
export async function serverLoopOn(bandmate: Bandmate, songId: number): Promise<boolean> {
  return (await bandmate.timeline(songId)).loop?.on ?? false;
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

/** A tuning field's notes for a custom tuning, on the Song page or the Chord Finder's. */
export const customTuningNotes = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Custom tuning: six notes, low string to high' });

/** Picks Custom in the tuning field, focusing its notes to type, and returns them. */
export async function pickCustomTuning(page: Page): Promise<Locator> {
  await page.getByRole('combobox', { name: 'Tuning' }).click();
  await page.getByRole('option', { name: 'Custom' }).click();
  await expect(customTuningNotes(page)).toBeFocused();
  return customTuningNotes(page);
}
