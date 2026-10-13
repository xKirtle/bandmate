<script lang="ts">
  // The Chord Finder's own page, the one place it's offered: the user picks
  // the tuning, standard tuning until picked, and the Key Suggest suggests
  // from, C major until picked. The last ones picked are kept on this device.
  // Beside the tuning, Left-handed: the same setting as in Settings.
  import ChordFinder from '../lib/ChordFinder.svelte';
  import { readTuning, standard } from '../lib/chordFinder';
  import { deviceStorage } from '../lib/deviceStorage';
  import { readFinderKey, readFinderTuning, storeFinderKey, storeFinderTuning } from '../lib/finderSetup';
  import { leftHanded } from '../lib/sharedLeftHanded.svelte';
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
  <h1>Chords</h1>
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
    <label class="choice-row left-handed">
      <input
        type="checkbox"
        role="switch"
        checked={leftHanded.value}
        onchange={(e) => leftHanded.set(e.currentTarget.checked)}
      />
      <span>Left-handed</span>
    </label>
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
  /* The tuning, and Left-handed level with its picker; on a phone, under it. */
  .setup {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    margin: 0 0 var(--space-4);
  }
  .field {
    min-width: 0;
  }
  .tuning {
    flex: 1 1 16rem;
    max-width: 24rem;
  }
  /* Stacked, so only the switch and its label take a tap, not the line's width. */
  @media (width < 40rem) {
    .setup {
      flex-direction: column;
      align-items: flex-start;
    }
    .tuning {
      flex: none;
      width: 100%;
    }
  }
  .error {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  }
</style>
