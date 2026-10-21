// A fake of this device's storage, for testing the values kept in it without
// a browser: the whole `Storage` surface over a plain object the test hands
// in and reads back afterwards.
//
// A blocked one stands for a browser that refuses storage, e.g. a private
// window: every access throws a SecurityError, as the real one does, so a
// test can show what a value does when it can't be kept.

/** A Storage holding some values, or one that throws like a blocked one. */
export function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = (): never => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
    clear: () => {
      if (blocked) fail();
      for (const key of Object.keys(values)) delete values[key];
    },
    key: (index: number) => (blocked ? fail() : (Object.keys(values)[index] ?? null)),
    get length() {
      return blocked ? fail() : Object.keys(values).length;
    },
  };
}
