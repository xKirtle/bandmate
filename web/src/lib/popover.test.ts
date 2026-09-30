import { describe as group, expect, it } from 'vitest';
import { pointSide, popoverFrom, popoverLeft, popoverTop } from './popover';

group('pointSide', () => {
  it('opens it after the point when there is room', () => {
    expect(pointSide(500, 200, 1000, 4)).toBe('after');
  });

  it('flips it before the point near the window edge', () => {
    expect(pointSide(900, 200, 1000, 4)).toBe('before');
  });
});

group('popoverFrom', () => {
  it('puts its near corner at the point on the side it opens to', () => {
    expect(popoverFrom(500, 200, 1000, 4, 'after')).toBe(500);
    expect(popoverFrom(900, 200, 1000, 4, 'before')).toBe(700);
  });

  it('shifts it only as far as it takes to stay inside the window', () => {
    // Opened after 700 at 200 long, then grown to 400 long.
    expect(popoverFrom(700, 400, 1000, 4, 'after')).toBe(596);
    // Opened before 300, then grown to 400 long.
    expect(popoverFrom(300, 400, 1000, 4, 'before')).toBe(4);
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
});
