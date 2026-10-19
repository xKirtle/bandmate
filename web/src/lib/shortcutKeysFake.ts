/**
 * The Shortcuts' keys for a test: the one place a test rebinds the keys
 * every handler and hint reads (see `rebound` in shortcutKeys.ts), so no
 * test file keeps a reset of its own. Importing it registers that reset,
 * which puts the defaults back after each test in the file.
 */

import { afterEach } from 'vitest';
import { defaultKeyset, followKeys, type Keyset } from './shortcutKeys';

/** Has `rebound` give these Shortcuts' keys, as if chosen on this device, the rest left at their defaults. */
export function rebind(changes: Partial<Keyset>) {
  followKeys(() => ({ ...defaultKeyset, ...changes }));
}

afterEach(() => followKeys(() => defaultKeyset));
