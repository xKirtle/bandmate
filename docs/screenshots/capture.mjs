// Captures the README's and the docs site's screenshots from a Bandmate the demo Backup,
// demo.bandmate, was just restored into. See README.md beside it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.env.BANDMATE_URL ?? "http://localhost:8080";
const out = import.meta.dirname;

const songs = await (await fetch(`${base}/api/songs`)).json();
// The hero Song's title in the demo.
const hero = songs.find((s) => s.title === "Lorem Ipsum");
if (!hero)
  throw new Error(
    `${base} has no Song titled Lorem Ipsum: restore the demo first`,
  );
const heroURL = `${base}/songs/${hero.id}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: [
    // The Timeline plays without a click first.
    "--autoplay-policy=no-user-gesture-required",
    // A fake microphone, playing a tone, for Recording settings' level meter.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
// Shot at twice the CSS pixels, so the images stay sharp on HiDPI screens.
const desktop = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
};
const work = mkdtempSync(join(tmpdir(), "bandmate-screenshots-"));

/** Screenshots the page as name.png, with Playwright's screenshot options. */
async function save(page, name, options = {}) {
  await page.screenshot({ ...options, path: join(out, `${name}.png`) });
}

/** Opens a page in a new dark-theme browser context. */
async function open(url, options = desktop) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  return page;
}

/** Switches the Song page to Read mode. */
async function readMode(page) {
  await page.getByRole("radio", { name: "Read" }).check();
}

/**
 * Scrolls the Song page to put the Lyric Sheet at the top, from its first row:
 * the heading in Write mode, the Chords and Transpose in Read mode, where the
 * heading is for screen readers only.
 */
async function scrollToLyricSheet(page) {
  const sheet = await page
    .getByRole("region", { name: "Lyric Sheet" })
    .boundingBox();
  await page.evaluate((top) => window.scrollTo(0, top - 8), sheet.y);
}

/** Starts the Timeline playing, from where the playhead is. */
async function play(page) {
  await page.getByRole("button", { name: "Play", exact: true }).click();
}

// The Song list.
{
  const page = await open(base);
  const table = await page.locator("table").boundingBox();
  await save(page, "song-list", {
    clip: { x: 0, y: 0, width: 1440, height: table.y + table.height + 32 },
  });
  await page.context().close();
}

// The hero Song in Write mode, with the Timeline open.
{
  const page = await open(heroURL);
  await save(page, "write-mode");
  await page.context().close();
}

// The numbered shots, for the feature tour (site/features.md): each number is
// placed beside what it names as the page is captured, so it follows the UI
// as it changes. The tour's key under each shot says what the numbers are.

/** Where an element's text ends, on its last line: the place for a number. */
async function textEnd(locator) {
  return locator.evaluate((el) => {
    if (!(
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    )) {
      // The text's own boxes, not its elements': an icon, or a block as wide
      // as a table's cell, would be measured too.
      const boxes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        boxes.push(...[...range.getClientRects()].filter((box) => box.width));
      }
      // The right-most box on the last line.
      const bottom = Math.max(...boxes.map((box) => box.bottom));
      const line = boxes
        .filter((box) => box.bottom > bottom - box.height / 2)
        .reduce((a, b) => (b.right > a.right ? b : a));
      return { x: line.right, y: line.y + line.height / 2 };
    }
    // A field's text has no box of its own: measure its first line in the
    // field's font.
    const style = getComputedStyle(el);
    const context = document.createElement("canvas").getContext("2d");
    context.font = style.font;
    const box = el.getBoundingClientRect();
    return {
      x:
        box.x +
        parseFloat(style.paddingLeft) +
        context.measureText(el.value.split("\n")[0]).width,
      y:
        box.y + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2,
    };
  });
}

/** Beside the middle of an element's right edge. */
async function rightOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

/** Beside the middle of an element's left edge. */
async function leftOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x - 48, y: box.y + box.height / 2 };
}

/** Under the middle of an element. */
async function below(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2 - 24, y: box.y + box.height + 22 };
}

/** Over the middle of an element, at a given height. */
async function above(locator, y) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2 - 24, y };
}

/** On an element's top-right corner. */
async function corner(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width - 14, y: box.y + 2 };
}

/** On the middle of an element's left edge. */
async function onLeft(locator) {
  const box = await locator.boundingBox();
  return { x: box.x - 24, y: box.y + box.height / 2 };
}

/**
 * Numbers the places, from 1, or from first: each a circle in the accent
 * with its left side 8px past the place, and centred on it.
 */
async function number(page, places, { first = 1, into } = {}) {
  // A menu or dialog sits in the browser's top layer, above anything in the
  // page however high its z-index, so its numbers go in it.
  await (into ?? page.locator("body")).evaluate(
    (host, { places, first }) => {
      // In the page, placed on the viewport; in a menu or dialog, on its box.
      const page = host === document.body;
      const origin = page
        ? { left: 0, top: 0 }
        : {
            left: host.getBoundingClientRect().left + host.clientLeft,
            top: host.getBoundingClientRect().top + host.clientTop,
          };
      places.forEach(({ x, y }, i) => {
        const mark = document.createElement("div");
        mark.textContent = first + i;
        Object.assign(mark.style, {
          position: page ? "fixed" : "absolute",
          left: `${x + 8 - origin.left}px`,
          top: `${y - 16 - origin.top}px`,
          width: "32px",
          height: "32px",
          display: "grid",
          placeItems: "center",
          borderRadius: "999px",
          background: "var(--accent)",
          color: "var(--accent-text)",
          outline: "3px solid var(--bg)",
          font: "700 18px system-ui, sans-serif",
          zIndex: 10000,
        });
        host.append(mark);
      });
    },
    { places, first },
  );
}

// The hero Song in Write mode, with the Chorus's Alternates open.
{
  // Tall enough that the Timeline sits below the shot.
  const page = await open(heroURL, {
    ...desktop,
    viewport: { width: 1440, height: 2000 },
  });
  const intro = page.getByRole("article", { name: "Intro" });
  const verse = page.getByRole("article", { name: "Verse 1" });
  const chorus = page.getByRole("article", { name: "Chorus" });
  const scrapbook = page.locator("summary", { hasText: "Scrapbook" });
  await chorus.getByRole("button", { name: /^Alternates/ }).click();

  await number(page, [
    await below(page.getByRole("combobox", { name: "Status" })),
    await rightOf(page.getByRole("button", { name: /^Notes/ })),
    await below(
      page.getByRole("radio", { name: "Read" }).locator("xpath=../.."),
    ),
    await textEnd(verse.getByRole("combobox")),
    await textEnd(verse.locator("textarea")),
    await textEnd(intro.locator("textarea")),
    await textEnd(chorus.getByPlaceholder("Softer")),
    await rightOf(
      page.getByRole("button", { name: /^Cue for Line 1 of Verse 1/ }),
    ),
    await textEnd(scrapbook),
  ]);

  // From the nav rail to the Scrapbook's edge, down to the Chorus's foot.
  const nav = await page.getByRole("navigation").first().boundingBox();
  const side = await page.locator("details", { has: scrapbook }).boundingBox();
  const end = await chorus.boundingBox();
  const left = nav.x + nav.width;
  await save(page, "write-mode-labelled", {
    clip: {
      x: left,
      y: 0,
      width: side.x + side.width + 24 - left,
      height: end.y + end.height + 8,
    },
  });
  await page.context().close();
}

// The Timeline, with a Loop from 0:20 to 0:40 on, the playhead in it, and
// the Take's Clip selected.
{
  const page = await open(heroURL);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const ruler = timeline.locator(".ruler");
  /** Where a time's label sits on the ruler. */
  const at = async (time) =>
    (await ruler.getByText(time, { exact: true }).boundingBox()).x;

  // A Loop is kept with the Song: clear one an earlier capture left.
  const clear = timeline.locator(".loop-clear");
  if (await clear.count()) await clear.evaluate((button) => button.click());
  // Drawn by dragging along the bar over the ruler, which turns it on.
  const bar = await timeline.locator(".loop-bar").boundingBox();
  const y = bar.y + bar.height / 2;
  await page.mouse.move(await at("0:20"), y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(await at("0:40"), y, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  const loop = timeline.getByRole("button", { name: "Loop", exact: true });
  await page.waitForTimeout(300);
  if ((await loop.getAttribute("aria-pressed")) !== "true") await loop.click();
  const rule = await ruler.boundingBox();
  await page.mouse.click(await at("0:30"), rule.y + rule.height / 2);
  const take = timeline.getByRole("group", { name: /^Take 2/ });
  const clip = await take.boundingBox();
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height - 6);

  // One row of numbers over the transport, above the Timeline's top edge.
  const row =
    (
      await timeline
        .getByRole("button", { name: "Play", exact: true })
        .boundingBox()
    ).y - 18;
  await number(page, [
    await above(
      timeline.getByRole("button", { name: "Play", exact: true }),
      row,
    ),
    await above(loop, row),
    await corner(timeline.locator(".loop")),
    await above(
      timeline.getByRole("button", { name: "Record", exact: true }),
      row,
    ),
    await above(timeline.getByRole("button", { name: "Not calibrated" }), row),
    await above(timeline.getByRole("button", { name: "Undo" }), row),
    await above(
      timeline.getByRole("button", { name: "More Timeline actions" }),
      row,
    ),
    await corner(timeline.getByRole("button", { name: "Add a Track" })),
    await onLeft(timeline.getByRole("group", { name: "Track Lead vox" })),
    await corner(timeline.getByRole("group", { name: /^Lorem Click/ })),
    await corner(take),
  ]);

  // The Lyric Sheet behind the numbers over the transport is painted over.
  const box = await timeline.boundingBox();
  await page.evaluate((top) => {
    const strip = document.createElement("div");
    Object.assign(strip.style, {
      position: "fixed",
      inset: `0 0 auto 0`,
      height: `${top}px`,
      background: "var(--bg)",
      zIndex: 9999,
    });
    document.body.append(strip);
  }, box.y);
  await save(page, "timeline-labelled", {
    clip: {
      x: box.x,
      y: box.y - 36,
      width: box.width,
      height: box.height + 36,
    },
  });
  // The Loop is kept with the Song, so clear it before the shots after this.
  await clear.evaluate((button) => button.click());
  await page.waitForTimeout(500);
  await page.context().close();
}

// A Take's menu on the Timeline, with Retake, its Takes and Nudge.
{
  const page = await open(heroURL);
  const timeline = page.getByRole("region", { name: "Timeline" });
  const take = timeline.getByRole("group", { name: /^Take 2/ });
  await take.hover();
  await take.getByRole("button", { name: /^More actions for/ }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  // Measured once it has finished opening, as it grows into place.
  await page.waitForTimeout(500);
  await number(
    page,
    [
      await textEnd(
        menu.getByRole("menuitem", { name: "Retake", exact: true }),
      ),
      await textEnd(menu.getByRole("menuitem", { name: "Takes", exact: true })),
      await textEnd(menu.getByRole("menuitem", { name: "Nudge", exact: true })),
    ],
    { into: menu },
  );
  // The menu and the Clip it opened from.
  const list = await menu.boundingBox();
  const clip = await take.boundingBox();
  const top = list.y - 16;
  await save(page, "take-menu-labelled", {
    clip: {
      x: list.x - 16,
      y: top,
      width: list.width + 32,
      height: clip.y + clip.height + 16 - top,
    },
  });
  await page.context().close();
}

// Recording settings, from the Timeline's menu, hearing Chromium's fake
// microphone.
{
  const page = await open(heroURL, { ...desktop, permissions: ["microphone"] });
  const timeline = page.getByRole("region", { name: "Timeline" });
  await timeline.getByRole("button", { name: "More Timeline actions" }).click();
  await page.getByRole("menuitem", { name: /^Recording settings/ }).click();
  const settings = page.getByRole("dialog", { name: "Recording settings" });
  await settings.waitFor();
  // Long enough for the level meter to move.
  await page.waitForTimeout(1500);
  await number(
    page,
    [
      await textEnd(settings.getByText("Input", { exact: true })),
      await textEnd(settings.getByText(/out of the red/)),
      await rightOf(settings.getByRole("button", { name: /^Calibrate/ })),
    ],
    { first: 4, into: settings },
  );
  const box = await settings.boundingBox();
  await save(page, "recording-settings-labelled", {
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  await page.context().close();
}

// The Beat Library.
{
  const page = await open(`${base}/beats`);
  const row = page.getByRole("row").nth(1);
  const search = await page.getByRole("searchbox").boundingBox();
  await number(page, [
    await leftOf(page.getByRole("button", { name: "Add from link" })),
    // Inside the search's empty end, beside the filters.
    { x: search.x + search.width - 48, y: search.y + search.height / 2 },
    await textEnd(row.getByRole("cell", { name: "Lorem Click", exact: true })),
    await textEnd(
      row.getByRole("cell", { name: "Bandmate demo", exact: true }),
    ),
    await textEnd(row.getByRole("cell", { name: "Lorem Ipsum", exact: true })),
    await below(row.getByRole("button").last()),
  ]);
  const table = await page.locator("table").boundingBox();
  await save(page, "beat-library-labelled", {
    clip: {
      x: table.x - 24,
      y: 0,
      width: table.width + 48,
      height: table.y + table.height + 48,
    },
  });
  await page.context().close();
}

// Settings' Backups, holding the demo Backup restored from.
{
  const page = await open(`${base}/settings/backups`);
  const backup = page.getByRole("listitem").first();
  await number(page, [
    await below(page.getByText("Upload", { exact: true })),
    await below(page.getByRole("button", { name: "New Backup" })),
    await textEnd(backup.locator("strong, b, h3, span").first()),
    await leftOf(backup.getByRole("button", { name: /^Restore/ })),
  ]);
  const list = await page.getByRole("list").first().boundingBox();
  await save(page, "backups-labelled", {
    clip: {
      x: list.x - 24,
      y: 0,
      width: list.width + 48,
      height: list.y + list.height + 32,
    },
  });
  await page.context().close();
}

// The Lyric Sheet on a phone.
{
  const page = await open(heroURL, {
    colorScheme: "dark",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await readMode(page);
  await scrollToLyricSheet(page);
  await save(page, "phone-lyric-sheet");
  await page.context().close();
}

// Read mode, with the Line playing highlighted.
{
  const page = await open(heroURL);
  await readMode(page);
  await play(page);
  // Into Verse 1's second Line, cued at 0:10.
  await page.waitForTimeout(11_500);
  await save(page, "read-mode");
  await page.context().close();
}

// Sync mode cueing the Bridge's Lines, as an animated WebP.
{
  // Narrower than the stills, still laid out for desktop, so the animation can
  // be small and still readable.
  const page = await open(heroURL, {
    ...desktop,
    viewport: { width: 1100, height: 880 },
  });
  await page.getByRole("button", { name: "Sync lyrics" }).click();
  // Play from Verse 2's last Line, cued at 1:00, so from 0:59. The Lyric
  // Sheet follows the Line up next: the Bridge's first, the first uncued.
  await page.getByRole("button", { name: /^Play from .* at 1:00\.0$/ }).click();
  const playing = Date.now();
  /** When the playhead reaches seconds on the Timeline, as a time on the clock. */
  const at = (seconds) => playing + (seconds - 59) * 1000;
  const start = at(64);
  const end = at(71.5);

  // Chromium's screencast sends a frame each time the page paints, stamped
  // with when it painted. Each frame shows until the next.
  const shot = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(work, `frame-${shot.length}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shot.push({ file, time: metadata.timestamp * 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await page.waitForTimeout(start - 500 - Date.now());
  await cdp.send("Page.startScreencast", { format: "png" });

  // Cue three Bridge Lines a bar (2.5 s) apart, from 1:05, and stop with
  // the fourth up next: once every Line is cued, the first comes up next,
  // and the Lyric Sheet scrolls back up to it.
  for (const cue of [65, 67.5, 70].map(at)) {
    await page.waitForTimeout(cue - Date.now());
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(end - Date.now());
  await cdp.send("Page.stopScreencast");
  await page.context().close();

  // From the frame on screen at the start to the last before the end.
  const first = shot.findLastIndex(({ time }) => time <= start);
  const frames = shot
    .slice(Math.max(first, 0))
    .filter(({ time }) => time < end);
  frames[0].time = start;
  const list = frames.map(
    ({ file, time }, i) =>
      `file '${file}'\nduration ${((frames[i + 1]?.time ?? end) - time) / 1000}\n`,
  );
  writeFileSync(
    join(work, "frames.txt"),
    list.join("") + `file '${frames.at(-1).file}'\n`,
  );
  execFileSync("ffmpeg", [
    ...[
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      join(work, "frames.txt"),
    ],
    ...["-vf", "fps=30,scale=1400:-1:flags=lanczos"],
    ...["-c:v", "libwebp_anim", "-lossless", "1", "-compression_level", "6"],
    ...["-loop", "0", join(out, "sync-mode.webp")],
  ]);
}

await browser.close();
rmSync(work, { recursive: true });
