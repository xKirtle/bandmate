import { describe as group, expect, it } from 'vitest';
import { BackdropPress, outsideBox } from './backdrop';

group('outsideBox', () => {
  const box = { left: 100, top: 50, right: 300, bottom: 250 };

  it('tells a point inside the dialog, edges included', () => {
    expect(outsideBox(box, { clientX: 200, clientY: 150 })).toBe(false);
    expect(outsideBox(box, { clientX: 100, clientY: 50 })).toBe(false);
    expect(outsideBox(box, { clientX: 300, clientY: 250 })).toBe(false);
  });

  it('tells a point on the backdrop, on any side', () => {
    expect(outsideBox(box, { clientX: 99, clientY: 150 })).toBe(true);
    expect(outsideBox(box, { clientX: 301, clientY: 150 })).toBe(true);
    expect(outsideBox(box, { clientX: 200, clientY: 49 })).toBe(true);
    expect(outsideBox(box, { clientX: 200, clientY: 251 })).toBe(true);
  });
});

group('BackdropPress', () => {
  it('closes on a press that starts and ends outside', () => {
    const press = new BackdropPress();
    press.down(true);
    expect(press.click(true)).toBe(true);
  });

  it('never closes on a drag from inside to outside', () => {
    const press = new BackdropPress();
    press.down(false);
    expect(press.click(true)).toBe(false);
  });

  it('never closes on a drag from outside to inside', () => {
    const press = new BackdropPress();
    press.down(true);
    expect(press.click(false)).toBe(false);
  });

  it('never closes on a click with no press of its own, e.g. from the keyboard', () => {
    const press = new BackdropPress();
    expect(press.click(true)).toBe(false);
  });

  it('forgets a press once its click is heard', () => {
    const press = new BackdropPress();
    press.down(true);
    press.click(true);
    expect(press.click(true)).toBe(false);
  });
});
