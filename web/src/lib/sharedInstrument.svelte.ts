import { instrumentSound, standard, type InstrumentName } from './chordFinder';
import { DeviceSetting } from './deviceSetting.svelte';
import { deviceStorage } from './deviceStorage';
import { instrumentSetting } from './deviceInstrument';
import { prepareToHear } from './hear';

// The device's Instrument, shared by the Chord Finder, the Chord Chart and a
// Chord's popover, so picking one in any of them, in any of this device's
// tabs, changes it in all of them: the guitar until another is picked.

export const instrument = new DeviceSetting(instrumentSetting, deviceStorage(), window);

/**
 * Picks the device's Instrument, as the Chord Finder, the Reading menu and
 * Settings do, and loads its samples if they aren't yet, so its first Hear
 * plays at once (ADR 0030).
 */
export function pickInstrument(picked: InstrumentName) {
  instrument.set(picked);
  prepareToHear(
    instrumentSound(picked === 'piano' ? { instrument: 'piano' } : { instrument: 'guitar', tuning: standard }),
  );
}
