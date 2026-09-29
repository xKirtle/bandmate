import { describe as group, expect, it } from 'vitest';
import { popoverLeft, popoverTop } from './popover';

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

group('popoverLeft', () => {
  const button = { left: 100, right: 216 };

  it("lines it up with the button's start or end when there is room", () => {
    expect(popoverLeft(button, 150, 1000, 4, 'start')).toBe(100);
    expect(popoverLeft(button, 150, 1000, 4, 'end')).toBe(66);
  });

  it('keeps it off the left edge of the window', () => {
    expect(popoverLeft(button, 285, 320, 4, 'end')).toBe(4);
  });

  it('keeps it off the right edge of the window', () => {
    expect(popoverLeft(button, 285, 320, 4, 'start')).toBe(31);
  });
});
