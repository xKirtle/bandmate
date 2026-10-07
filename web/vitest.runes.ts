// A Vitest environment for the tests of modules whose runes run effects,
// e.g. songListQuery.svelte.ts: Node's, but with the code built for the
// browser, as Svelte's server build runs no effects. vite.config.ts gives it
// to the tests named *.svelte.test.ts.
import type { Environment } from 'vitest/runtime';

export default {
  name: 'runes',
  viteEnvironment: 'client',
  setup: () => ({ teardown: () => {} }),
} satisfies Environment;
