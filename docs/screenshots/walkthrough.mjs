// Records walkthrough.mp4, a silent video of a song being written, synced,
// recorded and read in one sitting, on an empty Bandmate. It restores the demo
// Backup, gives it believable words, and refuses to run on a Bandmate with
// Songs in it. See README.md beside it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.env.BANDMATE_URL ?? "http://localhost:8080";
const out = import.meta.dirname;
const work = mkdtempSync(join(tmpdir(), "bandmate-walkthrough-"));

/** Calls Bandmate's API with a JSON body, and gives what it answers. */
async function api(method, path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: body && { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/** Restores the demo Backup, and gives its Songs and Beat words of their own. */
async function seed() {
  if ((await api("GET", "/songs")).length > 0)
    throw new Error(`${base} has Songs in it: this needs an empty Bandmate`);

  const upload = await fetch(`${base}/api/backups/upload`, {
    method: "POST",
    body: readFileSync(join(out, "demo.bandmate")),
  });
  const { id } = await upload.json();
  const ids = async (kind) =>
    (await api("GET", `/backups/${id}/${kind}`)).map((item) => item.id);
  await api("POST", `/backups/${id}/restore`, {
    songs: await ids("songs"),
    beats: await ids("beats"),
  });

  const titles = {
    "Lorem Ipsum": "Last Train Home",
    "Consectetur Adipiscing": "Paper Boats",
    "Ullamco Laboris": "Slow Burn",
    "Magna Aliqua": "Salt and Rain",
    "Tempor Incididunt": "Kitchen Light",
    "Sed Do Eiusmod": "Northbound",
    "Dolor Sit Amet": "Hold the Door",
  };
  const songs = await api("GET", "/songs");
  for (const song of songs)
    await api("PATCH", `/songs/${song.id}`, { title: titles[song.title] });
  for (const beat of await api("GET", "/beats"))
    await api("PATCH", `/beats/${beat.id}`, { title: "Night Drive" });

  const hero = songs.find((song) => song.title === "Lorem Ipsum");
  await api("PATCH", `/songs/${hero.id}`, { notes: "Try it a little slower." });
  const words = {
    5: "[Am] [F] [C] [G]",
    // Three Lines: the fourth is written on camera.
    6: `[Am]Streetlights on the [F]empty road
Hum a [C]tune I used to [G]know
[Am]One more mile, one [F]more goodbye`,
    7: `[F]Take me [C]back the way I came
[G]Every station [Am]sounds the same
[F]Hold the [C]line and call my name
[G]On the last train [E]home`,
    10: `[F]Slow it [C]down and let it go
[G]All the towns I'll [Am]never know
[F]Leave a [C]light on in the snow
[G]For the last train [E]home`,
    8: `[Am]Coffee cold and [F]window seat
[C]Rails are ticking [G]out a beat
[Am]Every sign I [F]used to read
[C]Fading out be[G]hind me`,
    9: `[Dm]If I never [Am]make it back
[F]Keep my coat up[C]on the rack
[Dm]I'll be somewhere [Am]down the track
[F]Singing it to [E]you`,
    11: `[Am]Long way round, [G]long way round
[F]Nothing lost and [E]nothing found`,
  };
  for (const [alternate, text] of Object.entries(words))
    await api("PUT", `/songs/${hero.id}/alternates/${alternate}/text`, {
      text,
    });
  return `${base}/songs/${hero.id}`;
}

const heroURL = await seed();

// A rising and falling signal, for a Take that looks sung rather than a solid
// block of a test tone.
const mic = join(work, "mic.wav");
execFileSync("ffmpeg", [
  ...["-y", "-loglevel", "error", "-f", "lavfi"],
  ...["-i", "anoisesrc=d=30:c=pink:a=0.7,tremolo=f=1.7:d=0.95,lowpass=f=2500"],
  mic,
]);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${mic}`,
  ],
});
// 1920 by 1200 once scaled, with room for the Lyric Sheet over the Timeline.
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 4 / 3,
  colorScheme: "dark",
  permissions: ["microphone"],
});

// The browser draws no pointer in a screencast, so the page draws one, which
// follows the mouse Playwright moves and dips as it's pressed.
await context.addInitScript(() => {
  const draw = () => {
    if (document.getElementById("walkthrough-pointer")) return;
    const pointer = document.createElement("div");
    pointer.id = "walkthrough-pointer";
    pointer.style.cssText =
      "position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;" +
      "pointer-events:none;transform:translate(720px,450px);";
    pointer.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"
      style="transition:transform 80ms;transform-origin:4px 3px">
      <path d="M4 3l6.5 17 2.6-7.2L20 10.2z" fill="#fff" stroke="#111"
      stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    document.documentElement.append(pointer);
    const arrow = pointer.firstElementChild;
    addEventListener(
      "mousemove",
      ({ clientX, clientY }) => {
        pointer.style.transform = `translate(${clientX}px,${clientY}px)`;
      },
      true,
    );
    addEventListener(
      "mousedown",
      () => (arrow.style.transform = "scale(0.8)"),
      true,
    );
    addEventListener("mouseup", () => (arrow.style.transform = ""), true);
  };
  if (document.documentElement) draw();
  else addEventListener("DOMContentLoaded", draw);
});

const page = await context.newPage();
const timeline = page.getByRole("region", { name: "Timeline" });
const record = timeline.getByRole("button", { name: "Record", exact: true });
const stop = timeline.getByRole("button", { name: "Stop", exact: true });

let at = { x: 720, y: 450 };

/** Moves the pointer to the middle of what's given, easing in and out. */
async function moveTo(target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = 32;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const eased = t * t * (3 - 2 * t);
    await page.mouse.move(
      at.x + (to.x - at.x) * eased,
      at.y + (to.y - at.y) * eased,
    );
    await page.waitForTimeout(12);
  }
  at = to;
}

/** Moves the pointer to what's given and clicks it, as someone would. */
async function click(target) {
  await moveTo(target);
  await page.waitForTimeout(180);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
}

// Off camera: the rhyming dictionary, and past the offer to calibrate, which
// stops the first Take, so the one on camera just records.
await page.goto(`${base}/settings`);
await page.waitForLoadState("networkidle");
await page
  .getByRole("list", { name: "Rhyming dictionaries" })
  .getByRole("listitem")
  .filter({ hasText: "English" })
  .getByRole("button", { name: "Download" })
  .click();
await page.getByText(/^Downloaded, updated/).waitFor();
await page.goto(heroURL);
await page.waitForLoadState("networkidle");
await record.click();
await page
  .getByRole("dialog", { name: "Calibrate the latency" })
  .getByRole("button", { name: /^Skip, use the browser's \d+ ms$/ })
  .click();
await stop.waitFor();
// Too short to be kept as a Take.
await stop.click();
await record.waitFor();
await page.waitForTimeout(600);

await page.goto(base);
await page.waitForLoadState("networkidle");
await page.mouse.move(at.x, at.y);

/**
 * Records until it's stopped, as a frame each time the page paints, stamped
 * with when it painted; each frame shows until the next.
 */
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = join(work, `frame-${frames.length}.jpg`);
  writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, time: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92 });

// The Songs, then into one.
await page.waitForTimeout(1200);
await moveTo(page.getByRole("link", { name: /Salt and Rain/ }));
await page.waitForTimeout(350);
await click(page.getByRole("link", { name: /Last Train Home/ }));
await page.getByRole("region", { name: "Lyric Sheet" }).waitFor();
await page.waitForTimeout(900);

// Writing the verse's last Line, with Rhymes for the Line before open.
await click(page.getByRole("button", { name: "Rhymes", exact: true }));
await page.waitForTimeout(300);
const verse = page.getByRole("article", { name: "Verse 1" });
await click(verse.locator("textarea"));
await page.keyboard.press("Control+End");
const rhymes = page.getByRole("region", { name: "Rhymes" });
await rhymes.getByRole("heading", { name: "Perfect" }).waitFor();
await page.waitForTimeout(1300);
await page.keyboard.press("Enter");
await page.keyboard.type("In the [C]dark the windows [G]fly", { delay: 62 });
await page.waitForTimeout(1100);

// Syncing it, from the Line before, then on into the Bridge.
await click(page.getByRole("button", { name: "Sync lyrics" }));
await page.waitForTimeout(400);
await click(page.getByRole("button", { name: /^Play from .* at 0:15\.0$/ }));
const playing = Date.now();
await page.waitForTimeout(5000 - (Date.now() - playing));
await page.keyboard.press("Enter");
await page.waitForTimeout(2400);
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
await page.keyboard.press("Space");
await page.waitForTimeout(300);
await click(page.getByRole("button", { name: "Sync lyrics" }));
await page.waitForTimeout(300);

// A Take on Lead vox.
await click(timeline.getByText("Lead vox", { exact: true }));
await page.waitForTimeout(300);
await click(record);
await stop.waitFor();
await page.waitForTimeout(3200);
await click(stop);
await record.waitFor();
await page.waitForTimeout(700);

// Read mode, scrolled up off the Timeline, then playing from the verse.
await click(page.getByRole("radio", { name: "Read" }).locator(".."));
await page.waitForTimeout(600);
for (let notch = 0; notch < 14; notch++) {
  await page.mouse.wheel(0, 28);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(500);
await click(page.getByText("Hum a", { exact: false }).first());
await page.waitForTimeout(7000);
await page.keyboard.press("Space");
await page.waitForTimeout(900);

await cdp.send("Page.stopScreencast");
await browser.close();

const list = frames.map(
  ({ file, time }, i) =>
    `file '${file}'\nduration ${(frames[i + 1]?.time ?? time + 0.5) - time}\n`,
);
const listed = join(work, "frames.txt");
writeFileSync(listed, list.join("") + `file '${frames.at(-1).file}'\n`);
execFileSync("ffmpeg", [
  ...["-y", "-loglevel", "error", "-f", "concat", "-safe", "0"],
  ...["-i", listed],
  ...["-vf", "fps=30,scale=1920:-2:flags=lanczos,format=yuv420p"],
  ...["-c:v", "libx264", "-preset", "slow", "-crf", "22"],
  ...["-movflags", "+faststart", "-an", join(out, "walkthrough.mp4")],
]);
rmSync(work, { recursive: true, force: true });
