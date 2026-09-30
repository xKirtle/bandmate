import { describe as group, expect, it } from 'vitest';
import { PointerFocus } from './pointerFocus';

const key = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

group('PointerFocus', () => {
  it('hides rings once a pointer presses', () => {
    const focus = new PointerFocus();
    expect(focus.hidesRings).toBe(false);
    focus.pointerDown();
    expect(focus.hidesRings).toBe(true);
  });

  it('shows rings again once a key acts on what a pointer focused, e.g. Tab or Enter', () => {
    const focus = new PointerFocus();
    focus.pointerDown();
    focus.keyDown(key('Tab'));
    expect(focus.hidesRings).toBe(false);
    focus.pointerDown();
    focus.keyDown(key('Enter'));
    expect(focus.hidesRings).toBe(false);
  });

  it('keeps rings hidden for a key that acted on the page instead, e.g. Space to play', () => {
    const focus = new PointerFocus();
    focus.pointerDown();
    focus.keyDown(key(' '));
    focus.keyForPage();
    expect(focus.hidesRings).toBe(true);
  });

  it('keeps rings hidden through a shortcut, as Chrome does, e.g. Ctrl+Z or Alt+→', () => {
    const focus = new PointerFocus();
    focus.pointerDown();
    focus.keyDown(key('z', { ctrlKey: true }));
    focus.keyDown(key('z', { metaKey: true }));
    focus.keyDown(key('ArrowRight', { altKey: true }));
    expect(focus.hidesRings).toBe(true);
  });

  it('leaves a ring the keyboard showed, even for a key that acted on the page', () => {
    const focus = new PointerFocus();
    focus.keyDown(key('Tab'));
    focus.keyDown(key(' '));
    focus.keyForPage();
    expect(focus.hidesRings).toBe(false);
  });
});
