import { describe as group, expect, it } from 'vitest';
import { popoverTop } from './popover';

group('popoverTop', () => {
  const field = { top: 500, bottom: 536 };

  it('places it under the field when there is room', () => {
    expect(popoverTop(field, 200, 800, 4)).toBe(540);
  });

  it('flips it over the field when there is no room below', () => {
    expect(popoverTop(field, 200, 600, 4)).toBe(296);
  });

  it('keeps it on screen when there is no room either way', () => {
    expect(popoverTop({ top: 100, bottom: 136 }, 200, 300, 4)).toBe(4);
  });
});
