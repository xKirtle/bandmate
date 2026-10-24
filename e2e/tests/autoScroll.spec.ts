import type { Page } from "@playwright/test";
import type { Bandmate } from "../bandmate";
import { expect, test } from "../fixtures";
import { heroSong, playButton, timeline } from "../songPage";

// Auto-scroll in Read mode: its button and key start and pause it, its pill
// pauses it while it runs, and it stops at the end of the Lyric Sheet, as
// the Timeline plays, and on leaving Read mode.

/** The Lyric Sheet's Auto-scroll button, beside Reading. */
const autoScrollButton = (page: Page) =>
  page
    .getByRole("region", { name: "Lyric Sheet" })
    .getByRole("button", { name: "Auto-scroll", exact: true });

/** The pill floating at the foot of the window while Auto-scroll runs. */
const pill = (page: Page) => page.getByRole("group", { name: "Auto-scroll" });

const scrolled = (page: Page) => page.evaluate(() => scrollY);

/** A finished Song, which opens in Read mode, with Lines enough to scroll through. */
async function longSong(bandmate: Bandmate) {
  const song = await bandmate.song({ title: "Long Road", status: "finished" });
  for (const label of ["Verse 1", "Chorus", "Verse 2", "Bridge"]) {
    const sheet = await bandmate.addSection(song.id, label);
    const section = sheet.sections.find((s) => s.label === label)!;
    const lines = Array.from(
      { length: 12 },
      (_, i) => `${label}, the road goes on, line ${i + 1}`,
    );
    await bandmate.setLines(
      song.id,
      section.alternates[0].id,
      lines.join("\n"),
    );
  }
  return song;
}

test("Auto-scroll starts from its button, scrolls on its own, and its pill pauses it", async ({
  page,
  bandmate,
}) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(autoScrollButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(pill(page)).toHaveCount(0);

  await autoScrollButton(page).click();
  await expect(autoScrollButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => scrolled(page)).toBeGreaterThan(10);

  await pill(page).getByRole("button", { name: "Pause Auto-scroll" }).click();
  await expect(pill(page)).toHaveCount(0);
  const paused = await scrolled(page);
  await page.waitForTimeout(500);
  expect(await scrolled(page)).toBe(paused);
});

test("A starts and pauses Auto-scroll, but not in a text field", async ({
  page,
  bandmate,
}) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await expect(autoScrollButton(page)).toBeVisible();

  await page.keyboard.press("a");
  await expect(pill(page)).toBeVisible();
  await page.keyboard.press("a");
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press("?");
  const search = page.getByRole("dialog").getByRole("searchbox");
  await search.fill("auto");
  await expect(
    page.getByRole("dialog").getByText("Start or pause Auto-scroll"),
  ).toBeVisible();
  await search.press("a");
  await expect(search).toHaveValue("autoa");
  await expect(pill(page)).toHaveCount(0);
});

test("Auto-scroll stops at the end of the Lyric Sheet, and starts from the top there", async ({
  page,
  bandmate,
}) => {
  const song = await longSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  // The last Line a little below the docked Timeline's top edge, hidden by it.
  const last = page.getByText("Bridge, the road goes on, line 12");
  const lastBottom = async () => {
    const box = (await last.boundingBox())!;
    return box.y + box.height;
  };
  const timelineTop = async () => (await timeline(page).boundingBox())!.y;
  const below = (await lastBottom()) - (await timelineTop()) - 60;
  await page.evaluate(
    (by) => scrollBy({ top: by, behavior: "instant" }),
    below,
  );

  await page.keyboard.press("a");
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 10_000 });
  // Stopped with the last Line in view, just above the Timeline.
  expect(await lastBottom()).toBeLessThanOrEqual((await timelineTop()) + 1);
  expect(await lastBottom()).toBeGreaterThan((await timelineTop()) - 10);

  await page.keyboard.press("a");
  await expect(pill(page)).toBeVisible();
  expect(await scrolled(page)).toBeLessThan(20);
});

test("Auto-scroll stops as the Timeline plays, and on leaving Read mode", async ({
  page,
  bandmate,
}) => {
  const song = await heroSong(bandmate);
  await page.goto(`/songs/${song.id}`);
  await page.getByRole("radio", { name: "Read" }).check();

  await autoScrollButton(page).click();
  await expect(pill(page)).toBeVisible();
  await playButton(page).click();
  await expect(pill(page)).toHaveCount(0);
  await expect(autoScrollButton(page)).toBeDisabled();
  await page.keyboard.press("a");
  await expect(pill(page)).toHaveCount(0);

  await page.keyboard.press(" ");
  await expect(autoScrollButton(page)).toBeEnabled();
  await autoScrollButton(page).click();
  await expect(pill(page)).toBeVisible();
  await page.getByRole("radio", { name: "Write" }).check();
  await expect(pill(page)).toHaveCount(0);
});
