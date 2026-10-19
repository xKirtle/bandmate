import { afterEach } from 'vitest';
import { defaultKeyset, followKeys, type Keyset } from './shortcutKeys';

/**
 * The Shortcuts' keys for a test: the one place a test rebinds the keys
 * every handler and hint reads (see `rebound` in shortcutKeys.ts), so no
 * test file keeps its own reset.
 */

/** Has `rebound` give these Shortcuts' keys, as if chosen on this device, the rest left at their defaults. */
export function rebind(changes: Partial<Keyset>) {
  followKeys(() => ({ ...defaultKeyset, ...changes }));
}

// The defaults come back after every test in a file that rebinds, so none
// leaves another rebound.
afterEach(() => followKeys(() => defaultKeyset));
