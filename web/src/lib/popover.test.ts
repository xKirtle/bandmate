import { describe as group, expect, it } from 'vitest';
import { popoverBeside, popoverLeft, popoverSide, popoverTop } from './popover';

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

  it('places it over the field when asked to and there is room', () => {
    expect(popoverTop(field, 200, 800, 4, 'over')).toBe(296);
  });

  it('flips it under the field when asked for over but there is no room above', () => {
    expect(popoverTop({ top: 100, bottom: 136 }, 200, 800, 4, 'over')).toBe(140);
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

group('popoverBeside', () => {
  const card = { width: 400, height: 200 };
  const window = { width: 1600, height: 900 };

  it('places it to the right of what it points at, centred on it', () => {
    const head = { left: 300, right: 900, top: 300, bottom: 340 };
    expect(popoverBeside(head, card, window, 24)).toEqual({ left: 924, top: 220 });
  });

  it('places it to the left when there is no room to the right', () => {
    const head = { left: 800, right: 1300, top: 300, bottom: 340 };
    expect(popoverBeside(head, card, window, 24)).toEqual({ left: 376, top: 220 });
  });

  it('keeps it inside the window top and bottom', () => {
    const button = { left: 100, right: 140, top: 860, bottom: 890 };
    expect(popoverBeside(button, card, window, 24)).toEqual({ left: 164, top: 676 });
  });

  it('places it over something as wide as the window, lined up with its start', () => {
    const timeline = { left: 80, right: 1600, top: 500, bottom: 900 };
    expect(popoverBeside(timeline, card, window, 24)).toEqual({ left: 80, top: 276 });
  });

  it('places it under something as wide as the window with no room over it', () => {
    const sheet = { left: 80, right: 1600, top: 100, bottom: 300 };
    expect(popoverBeside(sheet, card, window, 24)).toEqual({ left: 80, top: 324 });
  });
});
