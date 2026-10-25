<script lang="ts">
  // The Chord Finder's own page, the one place it's offered: the user picks
  // the Instrument, the guitar until picked, and on the guitar the tuning,
  // standard tuning until picked, and the Key Suggest suggests from, C major
  // until picked. The last ones picked are kept on this device. The piano
  // has no tuning, so the field hides while it's picked.
  import ChordFinder from '../lib/ChordFinder.svelte';
  import { instruments, readTuning, standard, type FinderContext, type InstrumentName } from '../lib/chordFinder';
  import { deviceStorage } from '../lib/deviceStorage';
  import {
    readFinderInstrument,
    readFinderKey,
    readFinderTuning,
    storeFinderInstrument,
    storeFinderKey,
    storeFinderTuning,
  } from '../lib/finderSetup';
  import Picker from '../lib/Picker.svelte';
  import TuningField from '../lib/TuningField.svelte';

  let instrument = $state(readFinderInstrument(deviceStorage()));
  let tuning = $state(readFinderTuning(deviceStorage()));
  let tuningError = $state('');
  let suggestKey = $state(readFinderKey(deviceStorage()));

  const context = $derived<FinderContext>(
    instrument === 'piano' ? { instrument: 'piano' } : { instrument: 'guitar', tuning: readTuning(tuning) ?? standard },
  );

  const instrumentLabel = (i: InstrumentName) => (i === 'piano' ? 'Piano' : 'Guitar');

  function pickInstrument(picked: InstrumentName) {
    instrument = picked;
    storeFinderInstrument(deviceStorage(), picked);
  }

  function keep() {
    tuningError = '';
    storeFinderTuning(deviceStorage(), tuning);
  }
</script>

<header class="bar">
  <h1>Chords</h1>
</header>

<main class="page">
  <div class="setup">
    <div class="field instrument">
      <span id="finder-instrument-label">Instrument</span>
      <Picker
        id="finder-instrument"
        aria-labelledby="finder-instrument-label"
        options={instruments}
        value={instrument}
        text={instrumentLabel}
        onpick={pickInstrument}
      />
    </div>
    {#if instrument === 'guitar'}
      <div class="field tuning">
        <span id="finder-tuning-label">Tuning</span>
        <TuningField
          id="finder-tuning"
          labelledby="finder-tuning-label"
          allowNone={false}
          bind:value={tuning}
          oncommit={keep}
          oninvalid={(message) => (tuningError = message)}
        />
      </div>
    {/if}
  </div>
  {#if tuningError && instrument === 'guitar'}
    <p class="error" role="alert">{tuningError}</p>
  {/if}
  <ChordFinder
    {context}
    {suggestKey}
    onpickkey={(key) => {
      suggestKey = key;
      storeFinderKey(deviceStorage(), key);
    }}
  />
</main>

<style>
  .setup {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0 0 var(--space-4);
  }
  .field {
    min-width: 0;
  }
  .instrument {
    flex: 0 1 10rem;
  }
  .tuning {
    flex: 1 1 16rem;
    max-width: 24rem;
  }
  .error {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  }
</style>
