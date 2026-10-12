import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { RhymeMode } from './rhymeMode.svelte';
import type { Mode } from './songMode';

/** Sync mode as Rhyme mode sees it, switched on and off by the test. */
class FakeSync {
  on = $state(false);
  end() {
    this.on = false;
  }
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/**
 * Rhyme mode as the Song page makes it, inside an effect root, in Write mode
 * on a wide window with Sync mode off, unless the test changes the page.
 */
function rhymeModeFor() {
  const page = $state<{ mode: Mode; wide: boolean }>({ mode: 'write', wide: true });
  const sync = new FakeSync();
  let rhymeMode!: RhymeMode;
  disposers.push(
    $effect.root(() => {
      rhymeMode = new RhymeMode({ mode: () => page.mode, wide: () => page.wide, sync });
    }),
  );
  flushSync();
  return { rhymeMode, page, sync };
}

type Harness = ReturnType<typeof rhymeModeFor>;
/** A change to what Rhyme mode reads, made by a test. */
type Change = (t: Harness) => unknown;

/** Switches Rhyme mode on, as clicking Rhymes does. */
function switchOn(rhymeMode: RhymeMode) {
  rhymeMode.switch();
  flushSync();
}

describe('Rhyme mode, switching on and off', () => {
  it('starts off, comes on in Write mode on a wide window, and goes off', () => {
    const { rhymeMode } = rhymeModeFor();
    expect(rhymeMode.canBeOn).toBe(true);
    expect(rhymeMode.on).toBe(false);
    switchOn(rhymeMode);
    expect(rhymeMode.on).toBe(true);
    switchOn(rhymeMode);
    expect(rhymeMode.on).toBe(false);
  });

  it.each<[string, Change]>([
    ['in Read mode', (t) => (t.page.mode = 'read')],
    ['on a narrow window', (t) => (t.page.wide = false)],
  ])("can't come on %s", (_, change) => {
    const t = rhymeModeFor();
    change(t);
    flushSync();
    expect(t.rhymeMode.canBeOn).toBe(false);
    switchOn(t.rhymeMode);
    expect(t.rhymeMode.on).toBe(false);
  });
});

describe('Rhyme mode, ending', () => {
  it.each<[string, Change, Change]>([
    ['Read mode comes on', (t) => (t.page.mode = 'read'), (t) => (t.page.mode = 'write')],
    ['the window narrows', (t) => (t.page.wide = false), (t) => (t.page.wide = true)],
  ])('ends as %s, and stays off when it changes back', (_, end, back) => {
    const t = rhymeModeFor();
    switchOn(t.rhymeMode);
    end(t);
    flushSync();
    expect(t.rhymeMode.on).toBe(false);
    back(t);
    flushSync();
    expect(t.rhymeMode.canBeOn).toBe(true);
    expect(t.rhymeMode.on).toBe(false);
    switchOn(t.rhymeMode);
    expect(t.rhymeMode.on).toBe(true);
  });
});

describe('Rhyme mode and Sync mode', () => {
  it('switches Sync mode off as it comes on', () => {
    const { rhymeMode, sync } = rhymeModeFor();
    sync.on = true;
    flushSync();
    expect(rhymeMode.canBeOn).toBe(true);
    switchOn(rhymeMode);
    expect(sync.on).toBe(false);
    expect(rhymeMode.on).toBe(true);
  });

  it('ends as Sync mode comes on, and stays off when Sync mode ends', () => {
    const { rhymeMode, sync } = rhymeModeFor();
    switchOn(rhymeMode);
    sync.on = true;
    flushSync();
    expect(rhymeMode.on).toBe(false);
    sync.end();
    flushSync();
    expect(rhymeMode.on).toBe(false);
  });
});
