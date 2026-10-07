// Captures the README's screenshots from a Bandmate the demo Backup,
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
  throw new Error(`${base} has no Song titled Lorem Ipsum: restore the demo first`);
const heroURL = `${base}/songs/${hero.id}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  // The Timeline plays without a click first.
  args: ["--autoplay-policy=no-user-gesture-required"],
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

/**
 * Where a field's line of text ends, or an element's text, in the page: the
 * place to put a label right after it.
 */
async function textEnd(locator, line = 0) {
  return locator.evaluate((el, line) => {
    if (!("value" in el)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      return { x: text.right, y: text.y + text.height / 2 };
    }
    // A field's text has no box of its own: measure it in the field's font.
    const style = getComputedStyle(el);
    const context = document.createElement("canvas").getContext("2d");
    context.font = style.font;
    const box = el.getBoundingClientRect();
    return {
      x:
        box.x +
        parseFloat(style.paddingLeft) +
        context.measureText(el.value.split("\n")[line]).width,
      y:
        box.y +
        parseFloat(style.paddingTop) +
        parseFloat(style.lineHeight) * (line + 0.5),
    };
  }, line);
}

/** Beside the middle of an element's right edge. */
async function rightOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

/** Under the middle of an element. */
async function below(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2 - 24, y: box.y + box.height + 22 };
}

// The hero Song in Write mode with the Chorus's Alternates open, numbered for
// the feature tour's key (site/features.md): each number is placed beside
// what it names when it's captured, so it follows the UI as it changes.
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

  // In the key's order.
  const marks = [
    await below(page.getByRole("combobox", { name: "Status" })),
    await rightOf(page.getByRole("button", { name: /^Notes/ })),
    await below(page.getByRole("radio", { name: "Read" }).locator("xpath=../..")),
    await textEnd(verse.getByRole("combobox")),
    await textEnd(verse.locator("textarea")),
    await textEnd(intro.locator("textarea")),
    await textEnd(chorus.getByPlaceholder("Softer")),
    await rightOf(page.getByRole("button", { name: /^Cue for Line 1 of Verse 1/ })),
    await textEnd(scrapbook),
  ];
  await page.evaluate((marks) => {
    marks.forEach(({ x, y }, i) => {
      const mark = document.createElement("div");
      mark.textContent = i + 1;
      Object.assign(mark.style, {
        position: "absolute",
        left: `${x + 8}px`,
        top: `${y - 16}px`,
        width: "32px",
        height: "32px",
        display: "grid",
        placeItems: "center",
        borderRadius: "999px",
        background: "var(--accent)",
        color: "var(--accent-text)",
        outline: "3px solid var(--bg)",
        font: "700 18px system-ui, sans-serif",
        zIndex: 1000,
      });
      document.body.append(mark);
    });
  }, marks);

  // From the nav rail to the Scrapbook's edge, down to the Chorus's foot.
  const nav = await page.getByRole("navigation").first().boundingBox();
  const side = await page
    .locator("details", { has: scrapbook })
    .boundingBox();
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
