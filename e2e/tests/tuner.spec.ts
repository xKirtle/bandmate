import type { Page } from "@playwright/test";
import { failRequests } from "../faults";
import { expect, test } from "../fixtures";

// The Tuner's page: the device's Tuning, the Chord Finder's too, and its six
// strings, each played from the guitar's recorded samples when tapped.

const nav = (page: Page) => page.getByRole("navigation", { name: "Library" });
const tuning = (page: Page) => page.getByRole("combobox", { name: "Tuning" });
const strings = (page: Page) =>
  page.getByRole("button", { name: /^Hear the \d\w\w string, / });

async function pickTuning(page: Page, name: string) {
  await tuning(page).click();
  await page.getByRole("option", { name, exact: true }).click();
}

/** Keeps the playback rate of every sample the page starts playing, in order. */
async function keepPlayed(page: Page) {
  await page.addInitScript(() => {
    const played: number[] = [];
    Object.assign(window, { played });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      played.push(this.playbackRate.value);
      return start.apply(this, args);
    };
  });
  return () =>
    page.evaluate(() => [
      ...(window as unknown as { played: number[] }).played,
    ]);
}

for (const width of [1280, 320]) {
  test(`at ${width}px, the navigation leads to the Tuner, between Chords and Settings, and it fits`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    const links = nav(page).getByRole("link");
    await expect(links).toHaveText([
      "Songs",
      "Beats",
      "Chords",
      "Tuner",
      "Settings",
    ]);

    await links.filter({ hasText: "Tuner" }).click();
    await expect(page).toHaveURL(/\/tuner$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tuner");
    await expect(links.filter({ hasText: "Tuner" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Every tab, label and all, and every string, inside the window, with nothing scrolling sideways.
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(strings(page)).toHaveCount(6);
    for (const string of await strings(page).all()) {
      const box = (await string.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("the Tuner shows the Tuning’s six strings, low to high, each with its note", async ({
  page,
}) => {
  await page.goto("/tuner");
  await expect(tuning(page)).toHaveText("Standard");
  await expect(strings(page)).toHaveText([
    "E2 6th",
    "A2 5th",
    "D3 4th",
    "G3 3rd",
    "B3 2nd",
    "E4 1st",
  ]);

  await pickTuning(page, "Drop C");
  await expect(strings(page).first()).toHaveAccessibleName(
    "Hear the 6th string, C2",
  );
  await expect(strings(page)).toHaveText([
    "C2 6th",
    "G2 5th",
    "C3 4th",
    "F3 3rd",
    "A3 2nd",
    "D4 1st",
  ]);
});

test("the Tuner and the Chord Finder share the device’s Tuning, custom ones included, either way round", async ({
  page,
}) => {
  await page.goto("/chords");
  await pickTuning(page, "Drop D");
  await nav(page).getByRole("link", { name: "Tuner" }).click();
  await expect(tuning(page)).toHaveText("Drop D");
  await expect(strings(page).first()).toHaveAccessibleName(
    "Hear the 6th string, D2",
  );

  await tuning(page).click();
  await page.getByRole("option", { name: "Custom" }).click();
  const notes = page.getByRole("textbox", {
    name: "Custom tuning: six notes, low string to high",
  });
  await notes.fill("c g d g b d");
  await notes.press("Enter");
  await expect(strings(page)).toHaveText([
    "C2 6th",
    "G2 5th",
    "D3 4th",
    "G3 3rd",
    "B3 2nd",
    "D4 1st",
  ]);
  await nav(page).getByRole("link", { name: "Chords" }).click();
  await expect(tuning(page)).toHaveText("Custom");
  await expect(notes).toHaveValue("C G D G B D");

  // And after a reload, kept on this device.
  await page.goto("/tuner");
  await expect(notes).toHaveValue("C G D G B D");
});

test("a Tuning the Chord Finder kept before the Tuner carries over to it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("bandmate.chordFinder.tuning", "DADGAD"),
  );
  await page.goto("/tuner");
  await expect(tuning(page)).toHaveText("DADGAD");
});

test("tapping a string plays its note once, from the guitar, even with the piano picked; tapping again replays it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("bandmate.chordFinder.instrument", "piano"),
  );
  const played = await keepPlayed(page);
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith(".mp3")) asked.push(new URL(r.url()).pathname);
  });
  await page.goto("/tuner");
  await expect
    .poll(
      () => asked.filter((path) => path.includes("/samples/guitar/")).length,
    )
    .toBe(30);
  await pickTuning(page, "Drop D");

  // Drop D's low string is D2, the low E's open string pitched down two semitones.
  const low = page.getByRole("button", { name: "Hear the 6th string, D2" });
  await low.click();
  await expect.poll(played).toHaveLength(1);
  expect((await played())[0]).toBeCloseTo(2 ** (-2 / 12), 5);
  // The high string is E4, its own open string as recorded.
  await page.getByRole("button", { name: "Hear the 1st string, E4" }).click();
  await expect.poll(played).toHaveLength(2);
  expect((await played())[1]).toBeCloseTo(1, 5);
  await low.click();
  await expect.poll(played).toHaveLength(3);
  expect((await played())[2]).toBeCloseTo(2 ** (-2 / 12), 5);

  expect(asked.some((path) => path.includes("/samples/piano/"))).toBe(false);
});

test("a string whose samples didn’t load says so in a toast, and the next tap tries again", async ({
  page,
}) => {
  // The page's opening tries, and fails, and so does a tap.
  const fault = await failRequests(
    page,
    { url: "**/samples/guitar/**/*.mp3" },
    { times: 60, status: 0 },
  );
  await page.goto("/tuner");
  await expect.poll(() => fault.count).toBe(30);
  await strings(page).first().click();
  await fault.spent;
  const toast = page.getByRole("alert").filter({ hasText: "Guitar" });
  await expect(toast).toContainText("Couldn't be heard");

  await strings(page).first().click();
  await expect(toast).toHaveCount(0);
});
