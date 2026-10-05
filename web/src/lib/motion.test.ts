import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollBehavior } from './motion';

/** Stubs the browser's answer to the reduced-motion preference. */
function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
  }));
}

describe('scrollBehavior', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('scrolls smoothly by default', () => {
    preferReducedMotion(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps straight there when reduced motion is asked for', () => {
    preferReducedMotion(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('scrolls smoothly where the preference can’t be read', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(scrollBehavior()).toBe('smooth');
  });
});
