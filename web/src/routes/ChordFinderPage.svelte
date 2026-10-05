<script lang="ts">
  // The Chord Finder's own page, the one place it's offered: the user picks
  // the tuning, standard tuning until picked, and the Key Suggest suggests
  // from, C major until picked. The last ones picked are kept on this device.
  import ChordFinder from '../lib/ChordFinder.svelte';
  import { readTuning, standard } from '../lib/chordFinder';
  import { readFinderKey, readFinderTuning, storeFinderKey, storeFinderTuning } from '../lib/finderSetup';
  import { deviceStorage } from '../lib/timelineHeight';
  import TuningField from '../lib/TuningField.svelte';

  let tuning = $state(readFinderTuning(deviceStorage()));
  let tuningError = $state('');
  let suggestKey = $state(readFinderKey(deviceStorage()));

  const context = $derived({ tuning: readTuning(tuning) ?? standard });

  function keep() {
    tuningError = '';
    storeFinderTuning(deviceStorage(), tuning);
  }
</script>

<header class="bar">
  <h1>Chord Finder</h1>
</header>

<main class="page">
  <div class="setup">
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
  </div>
  {#if tuningError}
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
    gap: 0.75rem;
    margin: 0 0 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .tuning {
    flex: 1 1 16rem;
    max-width: 24rem;
  }
  .error {
    margin: -0.5rem 0 1rem;
  }
</style>
