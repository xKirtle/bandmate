// Keeps one value across Vite's hot updates in development. A hot update
// runs a module again, which would otherwise make its module-level values
// afresh and lose the old ones while they're still alive, such as the app's
// one AudioContext (#582). Each run of the module hands the value on to the
// next through the module's hot data, `import.meta.hot?.data`, which Vite
// keeps from run to run. A production build has no hot data, so the value is
// simply made once.

/**
 * Gets a value made by make on first use, then that same value, kept under
 * key in hot data across the module's runs. Without hot data, it's kept for
 * this run only.
 */
export function hotKept<T>(data: Record<string, unknown> | undefined, key: string, make: () => T): () => T {
  return () => {
    if (data && key in data) return data[key] as T;
    const value = make();
    if (data) data[key] = value;
    else data = { [key]: value };
    return value;
  };
}
