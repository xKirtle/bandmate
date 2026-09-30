import { describe as group, expect, it } from 'vitest';
import { popoverLeft, popoverSide, popoverTop } from './popover';

group('popoverSide', () => {
  it('opens it after the point when there is room', () => {
    expect(popoverSide(500, 200, 1000, 4)).toBe('start');
  });

  it('flips it before the point near the window edge', () => {
    expect(popoverSide(900, 200, 1000, 4)).toBe('end');
  });
});

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

  group('from a point, e.g. a right-click', () => {
    const at = (p: number) => ({ left: p, right: p });

    it('puts its corner at the point on the side it opens to', () => {
      expect(popoverLeft(at(500), 200, 1000, 4, 'start')).toBe(500);
      expect(popoverLeft(at(900), 200, 1000, 4, 'end')).toBe(700);
    });

    it('shifts it only as far as it takes to stay inside the window as it grows', () => {
      expect(popoverLeft(at(700), 400, 1000, 4, 'start')).toBe(596);
      expect(popoverLeft(at(300), 400, 1000, 4, 'end')).toBe(4);
    });
  });
});
