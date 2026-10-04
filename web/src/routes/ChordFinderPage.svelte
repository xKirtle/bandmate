<script lang="ts">
  // The Chord Finder's own page, standalone: no Song, so the user picks the
  // tuning and capo, standard tuning and no capo until picked. The last ones
  // picked are kept on this device.
  import ChordFinder from '../lib/ChordFinder.svelte';
  import { readTuning, standard } from '../lib/chordFinder';
  import { capoLimit, readFinderSetup, storeFinderSetup } from '../lib/finderSetup';
  import Picker from '../lib/Picker.svelte';
  import { deviceStorage } from '../lib/timelineHeight';
  import TuningField from '../lib/TuningField.svelte';

  let setup = $state(readFinderSetup(deviceStorage()));
  let tuningError = $state('');

  const context = $derived({ tuning: readTuning(setup.tuning) ?? standard, capo: setup.capo });
  const capos = Array.from({ length: capoLimit + 1 }, (_, fret) => fret);

  function keep() {
    tuningError = '';
    storeFinderSetup(deviceStorage(), setup);
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
        bind:value={setup.tuning}
        oncommit={keep}
        oninvalid={(message) => (tuningError = message)}
      />
    </div>
    <div class="field capo">
      <span id="finder-capo-label">Capo</span>
      <Picker
        id="finder-capo"
        aria-labelledby="finder-capo-label"
        options={capos}
        value={setup.capo}
        text={(fret) => (fret === 0 ? 'None' : String(fret))}
        onpick={(capo) => {
          setup.capo = capo;
          keep();
        }}
      />
    </div>
  </div>
  {#if tuningError}
    <p class="error" role="alert">{tuningError}</p>
  {/if}
  <ChordFinder {context} />
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
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .tuning {
    flex: 1 1 16rem;
    max-width: 24rem;
  }
  .capo {
    flex: 0 0 6.5rem;
  }
  .error {
    margin: -0.5rem 0 1rem;
  }
</style>
