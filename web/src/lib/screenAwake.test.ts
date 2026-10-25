import { describe as group, expect, it } from 'vitest';
import { keepScreenAwake, type ScreenAwakeBrowser } from './screenAwake';

/** A browser's Screen Wake Lock, whose locks the test hands out or refuses. */
function browser({ supported = true, refuses = false } = {}) {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const locks: { released: boolean }[] = [];
  const pending: (() => void)[] = [];
  const wakeLock = {
    request(type: 'screen') {
      expect(type).toBe('screen');
      if (refuses) return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
      const lock = { released: false, release: async () => void (lock.released = true) };
      locks.push(lock);
      return new Promise<typeof lock>((resolve) => pending.push(() => resolve(lock)));
    },
  };
  const on: ScreenAwakeBrowser = { navigator: supported ? { wakeLock } : {}, document: page };
  /** Hands out every lock asked for so far. */
  const grant = async () => {
    for (const resolve of pending.splice(0)) resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const show = (visibility: DocumentVisibilityState) => {
    page.visibilityState = visibility;
    page.dispatchEvent(new Event('visibilitychange'));
  };
  return { on, locks, grant, show };
}

group('keepScreenAwake', () => {
  it('holds a screen wake lock until let go', async () => {
    const { on, locks, grant } = browser();
    const letGo = keepScreenAwake(on);
    await grant();
    expect(locks).toEqual([{ released: false, release: expect.any(Function) }]);

    letGo();
    expect(locks[0].released).toBe(true);
  });

  it('lets go of a lock that arrives after it was let go', async () => {
    const { on, locks, grant } = browser();
    keepScreenAwake(on)();
    await grant();
    expect(locks[0].released).toBe(true);
  });

  it('asks again as the page shows again, as the browser lets go of it while hidden', async () => {
    const { on, locks, grant, show } = browser();
    const letGo = keepScreenAwake(on);
    await grant();
    show('hidden');
    show('visible');
    await grant();
    expect(locks).toHaveLength(2);

    letGo();
    show('visible');
    expect(locks).toHaveLength(2);
    expect(locks[1].released).toBe(true);
  });

  it('does nothing where the browser has no Screen Wake Lock', () => {
    const { on } = browser({ supported: false });
    expect(() => keepScreenAwake(on)()).not.toThrow();
  });

  it('does nothing where the browser refuses it', async () => {
    const { on, grant } = browser({ refuses: true });
    const letGo = keepScreenAwake(on);
    await grant();
    expect(() => letGo()).not.toThrow();
  });
});
