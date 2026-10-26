import { describe, expect, it } from 'vitest';
import { hearing, type Played } from './hearing';
import type { HeardNote, InstrumentSound } from './instrument';
import type { SampleSet } from './samples';

// Hearing a Voicing (ADR 0030), through its rules, with its loading and its
// playing faked: a sample is its URL, and what's played is recorded. The
// player's sound itself is tested by ear.

const piano: SampleSet = { name: 'Piano', notes: [60, 63], url: (n) => `/piano/${n}.mp3`, gain: 0.55 };
const struck: InstrumentSound = { samples: piano, strummed: false };
const guitar: SampleSet = { name: 'Guitar', notes: [40, 42], url: (n) => `/guitar/${n}.mp3`, gain: 0.23 };
const strummed: InstrumentSound = { samples: guitar, strummed: true };
const notes = (...midi: number[]): HeardNote[] => midi.map((m) => ({ midi: m }));

/** A sample load held until the test lets it arrive, or fail. */
interface Pending {
  url: string;
  arrive(): void;
  fail(): void;
}

function setUp() {
  const pending: Pending[] = [];
  const played: Played<string>[] = [];
  const events: string[] = [];
  const toasts: string[] = [];
  const player = hearing<string>({
    loadSample: (url) =>
      new Promise((resolve, reject) => {
        pending.push({ url, arrive: () => resolve(url), fail: () => reject(new Error('offline')) });
      }),
    play: (p) => {
      played.push(p);
      events.push('play');
    },
    cutOff: () => events.push('cut off'),
    unheard: (set) => toasts.push(`${set.name} unheard`),
    heard: (set) => toasts.push(`${set.name} heard`),
  });
  /** Lets every sample asked for so far arrive, or fail, and waits for what follows. */
  const settle = async (how: 'arrive' | 'fail' = 'arrive') => {
    for (const p of pending.splice(0)) p[how]();
    await new Promise((r) => setTimeout(r));
  };
  return { player, pending, played, events, toasts, settle };
}

describe("the piano's samples", () => {
  it('load once, when asked for before a press, every one of them', async () => {
    const { player, pending, settle } = setUp();
    player.prepare(struck);
    player.prepare(struck);
    expect(pending.map((p) => p.url)).toEqual(['/piano/60.mp3', '/piano/63.mp3']);
    await settle();
    player.prepare(struck);
    player.hear(notes(60), struck);
    expect(pending).toEqual([]);
  });

  it('play a press at once once loaded, each note from its sample', async () => {
    const { player, played, settle } = setUp();
    player.prepare(struck);
    await settle();
    player.hear(notes(60, 64, 67), struck);
    expect(played).toHaveLength(1);
    const [{ notes: heard, gap, sound }] = played;
    expect(heard.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(gap).toBe(0);
    expect(sound.set).toBe(piano);
    expect([...sound.samples]).toEqual([
      [60, '/piano/60.mp3'],
      [63, '/piano/63.mp3'],
    ]);
  });

  it('arpeggiate low to high, a note at a time', async () => {
    const { player, played, settle } = setUp();
    player.prepare(struck);
    await settle();
    player.arpeggiate(notes(60, 64, 67), struck);
    expect(played[0].gap).toBeGreaterThan(0.1);
  });
});

describe('a press before the samples arrive', () => {
  it('cuts off what rings at once, and plays when they arrive', async () => {
    const { player, events, played, settle } = setUp();
    player.hear(notes(60, 64), struck);
    expect(events).toEqual(['cut off']);
    await settle();
    expect(events).toEqual(['cut off', 'play']);
    expect(played[0].notes.map((n) => n.midi)).toEqual([60, 64]);
  });

  it("doesn't play if something else was pressed since", async () => {
    const { player, played, settle } = setUp();
    player.hear(notes(60, 64), struck);
    player.arpeggiate(notes(62, 65), struck);
    await settle();
    expect(played.map((p) => p.notes.map((n) => n.midi))).toEqual([[62, 65]]);
  });

  it("doesn't play if the guitar was pressed since", async () => {
    const { player, played, settle } = setUp();
    player.hear(notes(60, 64), struck);
    player.hear(notes(40, 47), strummed);
    await settle();
    expect(played.map((p) => p.sound.set)).toEqual([guitar]);
  });
});

describe("samples that can't load", () => {
  it("say the Instrument couldn't be heard, and the next press tries again", async () => {
    const { player, pending, played, toasts, settle } = setUp();
    player.hear(notes(60), struck);
    await settle('fail');
    expect(played).toEqual([]);
    expect(toasts).toEqual(['Piano unheard']);

    player.hear(notes(60), struck);
    expect(pending).toHaveLength(2);
    await settle();
    expect(played).toHaveLength(1);
    expect(toasts).toEqual(['Piano unheard', 'Piano heard']);
  });

  it("say nothing when nothing's waiting to be heard, and load again on the next press", async () => {
    const { player, pending, toasts, settle } = setUp();
    player.prepare(struck);
    await settle('fail');
    expect(toasts).toEqual([]);
    player.hear(notes(60), struck);
    expect(pending).toHaveLength(2);
  });

  it('speak only for the last press, not one something else was pressed since', async () => {
    const { player, toasts, settle } = setUp();
    player.hear(notes(60), struck);
    player.hear(notes(40), strummed);
    await settle('fail');
    expect(toasts).toEqual(['Guitar unheard']);
  });
});

describe("the guitar's samples", () => {
  it("load apart from the piano's, and strum low to high once loaded", async () => {
    const { player, pending, played, settle } = setUp();
    player.prepare(strummed);
    expect(pending.map((p) => p.url)).toEqual(['/guitar/40.mp3', '/guitar/42.mp3']);
    await settle();
    player.hear(notes(40, 47, 52), strummed);
    expect(played[0].sound.set).toBe(guitar);
    expect(played[0].notes.map((n) => n.midi)).toEqual([40, 47, 52]);
    expect(played[0].gap).toBeGreaterThan(0);
    expect(played[0].gap).toBeLessThan(0.1);
  });

  it("say the guitar couldn't be heard if they can't load", async () => {
    const { player, toasts, settle } = setUp();
    player.arpeggiate(notes(40, 47), strummed);
    await settle('fail');
    expect(toasts).toEqual(['Guitar unheard']);
  });
});
