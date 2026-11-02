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

/**
 * The pegs' strings on each side of the headstock, top to bottom, by their
 * notes: a peg left of the middle of the pegs is on the left.
 */
async function headstock(page: Page) {
  const pegs = await Promise.all(
    (await strings(page).all()).map(async (peg) => ({
      note: (await peg.locator(".note").textContent())!,
      box: (await peg.boundingBox())!,
    })),
  );
  const middle =
    pegs.reduce((sum, { box }) => sum + box.x + box.width / 2, 0) / 6;
  const side = (left: boolean) =>
    pegs
      .filter(({ box }) => box.x + box.width / 2 < middle === left)
      .sort((a, b) => a.box.y - b.box.y)
      .map(({ note }) => note);
  return { left: side(true), right: side(false) };
}

/** Standard tuning's headstock, as a right-handed guitar's: each outer string at the top. */
const rightHanded = {
  left: ["E2", "A2", "D3"],
  right: ["E4", "B3", "G3"],
};

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
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    // A 3+3 headstock: the low strings down the left, the high ones down the right.
    expect(await headstock(page)).toEqual(rightHanded);
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

/** A note's frequency at A = 440 Hz, from its MIDI note number, so many cents sharp of it. */
const hz = (midi: number, cents = 0) =>
  440 * 2 ** ((midi - 69 + cents / 100) / 12);

/**
 * Gives the page a microphone that plays a plucked-string tone, its
 * harmonics louder than its fundamental, at a frequency set with `play`,
 * or noise or silence. Each input asked for is kept, by the device asked
 * for or 'default', and `live` says how many are still open. One device,
 * "scarlett", is listed as connected.
 */
async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const asked: string[] = (w.asked = []);
    const streams: MediaStream[] = [];
    w.live = () =>
      streams.filter((s) => s.getTracks().some((t) => t.readyState === "live"))
        .length;
    let context: AudioContext | undefined;
    let tone: OscillatorNode | undefined;
    let toneLevel: GainNode | undefined;
    let noiseLevel: GainNode | undefined;
    let sound = { frequency: 110, tone: 0, noise: 0 };
    const apply = () => {
      tone?.frequency.setValueAtTime(sound.frequency, 0);
      toneLevel?.gain.setValueAtTime(sound.tone, 0);
      noiseLevel?.gain.setValueAtTime(sound.noise, 0);
    };
    w.play = (frequency: number) => {
      sound = { frequency, tone: 0.3, noise: 0 };
      apply();
    };
    w.hiss = () => {
      sound = { ...sound, tone: 0, noise: 0.5 };
      apply();
    };
    w.hush = () => {
      sound = { ...sound, tone: 0, noise: 0 };
      apply();
    };
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        {
          kind: "audioinput",
          deviceId: "scarlett",
          groupId: "g",
          label: "Scarlett Solo USB",
        },
      ] as MediaDeviceInfo[];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const audio = constraints?.audio;
      const exact =
        typeof audio === "object"
          ? (audio.deviceId as ConstrainDOMStringParameters)?.exact
          : undefined;
      asked.push(typeof exact === "string" ? exact : "default");
      context ??= new AudioContext();
      const out = context.createMediaStreamDestination();
      tone = context.createOscillator();
      tone.setPeriodicWave(
        context.createPeriodicWave(
          [0, 0.6, 1, 0.8, 0.5, 0.35, 0.2],
          [0, 0, 0, 0, 0, 0, 0],
        ),
      );
      toneLevel = context.createGain();
      tone.connect(toneLevel).connect(out);
      tone.start();
      const noise = context.createBuffer(
        1,
        context.sampleRate,
        context.sampleRate,
      );
      noise.getChannelData(0).forEach((_, i, data) => {
        data[i] = Math.random() * 2 - 1;
      });
      const hiss = context.createBufferSource();
      hiss.buffer = noise;
      hiss.loop = true;
      noiseLevel = context.createGain();
      hiss.connect(noiseLevel).connect(out);
      hiss.start();
      apply();
      streams.push(out.stream);
      return out.stream;
    };
  });
  const call = (name: string, ...args: number[]) =>
    page.evaluate(
      ({ name, args }) =>
        (window as unknown as Record<string, (...a: number[]) => void>)[name](
          ...args,
        ),
      { name, args },
    );
  return {
    play: (frequency: number) => call("play", frequency),
    hiss: () => call("hiss"),
    hush: () => call("hush"),
    asked: () =>
      page.evaluate(() => (window as unknown as { asked: string[] }).asked),
    live: () =>
      page.evaluate(() => (window as unknown as { live: () => number }).live()),
  };
}

/** The Tuner's listening card, and what it shows. */
function listening(page: Page) {
  const card = page.getByRole("region", {
    name: "Play a string to see how far off it is",
  });
  return {
    card,
    listen: card.getByRole("button", { name: "Listen", exact: true }),
    stop: card.getByRole("button", { name: "Stop", exact: true }),
    meter: card.getByRole("meter", { name: "Cents sharp or flat" }),
  };
}

test("the Tuner listens on the Input recorded from, showing the note heard, the nearest string and how far off it is", async ({
  page,
}) => {
  const mic = await fakeMicrophone(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "bandmate.input",
      JSON.stringify({
        deviceId: "scarlett",
        label: "Scarlett Solo USB",
        channel: 0,
      }),
    ),
  );
  await page.goto("/tuner");
  const tuner = listening(page);
  await expect(tuner.card).toContainText(
    "Listens on the Input you record from.",
  );
  expect(await mic.asked()).toEqual([]);

  await tuner.listen.click();
  await mic.play(hz(45, 12));
  expect(await mic.asked()).toEqual(["scarlett"]);
  await expect(tuner.card).toContainText("A2");
  await expect(tuner.card).toContainText("5th string, A2");
  await expect(tuner.meter).toHaveAttribute(
    "aria-valuetext",
    /^1[1-3] cents sharp$/,
  );

  // Tuned down to it, it's in tune.
  await mic.play(hz(45));
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", "In tune");
  await expect(tuner.card).toContainText("In tune");

  // A low E tuned well flat, past E♭, is still the 6th string's.
  await mic.play(hz(39, -20));
  await expect(tuner.card).toContainText("Eb2");
  await expect(tuner.card).toContainText("6th string, E2");
  await expect(tuner.meter).toHaveAttribute(
    "aria-valuetext",
    /^1(19|20|21) cents flat$/,
  );

  // Measured against the Tuning's strings: in Drop D, a D2 is in tune.
  await mic.play(hz(38));
  await pickTuning(page, "Drop D");
  await expect(tuner.card).toContainText("6th string, D2");
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", "In tune");

  // Stopped, it lets go of the Input.
  await tuner.stop.click();
  await expect.poll(mic.live).toBe(0);
  await expect(tuner.listen).toBeVisible();
});

test("the Tuner shows nothing heard in silence or noise, not a note", async ({
  page,
}) => {
  const mic = await fakeMicrophone(page);
  await page.goto("/tuner");
  const tuner = listening(page);
  await tuner.listen.click();
  await mic.hush();
  await expect(tuner.card).toContainText("Nothing heard");
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", "Nothing heard");

  await mic.play(hz(50));
  await expect(tuner.card).toContainText("4th string, D3");
  await mic.hiss();
  await expect(tuner.card).toContainText("Nothing heard");
  // And stays so, never catching a note in the noise.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(100);
    await expect(tuner.meter).toHaveAttribute(
      "aria-valuetext",
      "Nothing heard",
    );
  }
});

test("leaving the Tuner stops it listening", async ({ page }) => {
  const mic = await fakeMicrophone(page);
  await page.goto("/tuner");
  await listening(page).listen.click();
  await mic.play(hz(45));
  await expect.poll(mic.live).toBe(1);
  await nav(page).getByRole("link", { name: "Chords" }).click();
  await expect.poll(mic.live).toBe(0);
});

test("Left-handed, set in Settings, mirrors the headstock, the low strings on the right, and its hint says so", async ({
  page,
}) => {
  await page.goto("/tuner");
  expect(await headstock(page)).toEqual(rightHanded);

  await page.goto("/settings");
  const leftHanded = page.getByRole("switch", { name: "Left-handed" });
  await expect(leftHanded).toHaveAccessibleDescription(
    "Mirrors every Chord diagram, high string on the left, and the Tuner's headstock, low strings on the right.",
  );
  await leftHanded.check();
  await page.goto("/tuner");
  expect(await headstock(page)).toEqual({
    left: rightHanded.right,
    right: rightHanded.left,
  });
});

/**
 * How far the wave drifts in a third of a second, in wavelengths, forward
 * (sharp) above 0 and back (flat) below: within half a wavelength either way.
 */
async function drifts(page: Page) {
  const at = async () =>
    Number(
      /translate\(([-\d.e]+)/.exec(
        (await listening(page)
          .meter.locator("path")
          .getAttribute("transform"))!,
      )![1],
    ) / 50;
  const from = await at();
  await page.waitForTimeout(330);
  const moved = (((await at()) - from) % 1) + 1;
  return (moved % 1) - (moved % 1 > 0.5 ? 1 : 0);
}

test("the wave drifts one way flat and the other sharp, and stands still in tune or with nothing heard", async ({
  page,
}) => {
  const mic = await fakeMicrophone(page);
  await page.goto("/tuner");
  const tuner = listening(page);
  // At rest before it listens.
  expect(await drifts(page)).toBe(0);

  await tuner.listen.click();
  await mic.play(hz(45, 20));
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", /sharp$/);
  expect(await drifts(page)).toBeGreaterThan(0.05);

  await mic.play(hz(45, -20));
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", /flat$/);
  expect(await drifts(page)).toBeLessThan(-0.05);

  await mic.play(hz(45));
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", "In tune");
  expect(await drifts(page)).toBe(0);

  await mic.play(hz(45, -20));
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", /flat$/);
  await mic.hush();
  await expect(tuner.meter).toHaveAttribute("aria-valuetext", "Nothing heard");
  expect(await drifts(page)).toBe(0);
});

test("with reduced motion asked for, the wave stands still, and how far off still reads", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mic = await fakeMicrophone(page);
  await page.goto("/tuner");
  const tuner = listening(page);
  await tuner.listen.click();
  await mic.play(hz(45, 20));
  await expect(tuner.card).toContainText(/\d+ cents sharp/);
  expect(await drifts(page)).toBe(0);
  await mic.play(hz(45, -20));
  await expect(tuner.card).toContainText(/\d+ cents flat/);
  expect(await drifts(page)).toBe(0);
  await mic.play(hz(45));
  await expect(tuner.card.locator(".badge")).toHaveText("In tune");
});

for (const [why, browser, said] of [
  [
    "the microphone is denied",
    () => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError"));
    },
    "Bandmate isn't allowed to use the microphone. Allow it in the browser's site settings.",
  ],
  [
    "the site isn't secure",
    () =>
      Object.defineProperty(navigator, "mediaDevices", { value: undefined }),
    "Listening needs a secure connection: open Bandmate over https or on localhost.",
  ],
  [
    "there's no Input",
    () => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("None", "NotFoundError"));
    },
    "There's no microphone or audio input to listen on. Connect one to tune.",
  ],
] as const) {
  test(`where ${why}, the Tuner says why it can't listen`, async ({ page }) => {
    await page.addInitScript(browser);
    await page.goto("/tuner");
    const tuner = listening(page);
    await tuner.listen.click();
    await expect(tuner.card.getByRole("alert")).toHaveText(said);
    await expect(tuner.listen).toBeVisible();
  });
}
