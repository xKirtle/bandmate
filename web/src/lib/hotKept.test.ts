import { describe, expect, it } from 'vitest';
import { hotKept } from './hotKept';

describe('hotKept', () => {
  it('makes its value on first use, then gives that same value', () => {
    let made = 0;
    const get = hotKept(undefined, 'clock', () => ({ n: ++made }));
    expect(made).toBe(0);
    const first = get();
    expect(get()).toBe(first);
    expect(made).toBe(1);
  });

  it('hands its value to the next run of the module, through its hot data', () => {
    const data: Record<string, unknown> = {};
    let made = 0;
    const make = () => ({ n: ++made });
    const first = hotKept(data, 'clock', make)();
    // Each hot update runs the module again, with the same hot data.
    const second = hotKept(data, 'clock', make);
    const third = hotKept(data, 'clock', make);
    expect(second()).toBe(first);
    expect(third()).toBe(first);
    expect(made).toBe(1);
  });

  it('hands a value made by a later run on too', () => {
    const data: Record<string, unknown> = {};
    let made = 0;
    const make = () => ({ n: ++made });
    hotKept(data, 'clock', make); // never used before the update
    const value = hotKept(data, 'clock', make)();
    expect(hotKept(data, 'clock', make)()).toBe(value);
    expect(made).toBe(1);
  });
});
