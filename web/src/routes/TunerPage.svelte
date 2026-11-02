<script lang="ts">
  // The Tuner's own page (see the glossary): the device's Tuning, picked as
  // in the Chord Finder, the same one, and its six strings, low to high, each
  // with its note. Tapping one plays its note from the guitar's recorded
  // samples, ringing once, and tapping it again plays it again. It's a
  // guitar's whatever the device's Instrument.
  import { hear, prepareToHear } from '../lib/hear';
  import { deviceTuning } from '../lib/sharedTuning.svelte';
  import Toasts from '../lib/Toasts.svelte';
  import { tunerSound, tunerStrings } from '../lib/tuner';
  import TuningField from '../lib/TuningField.svelte';
  import { unheard, unheardToasts } from '../lib/unheard.svelte';

  // The field's own copy, set as the device's once picked.
  let tuning = $state(deviceTuning.value);
  let tuningError = $state('');
  const strings = $derived(tunerStrings(tuning));

  // Loaded on opening, so the first tap plays at once (ADR 0030).
  $effect(() => prepareToHear(tunerSound));
  // A note that couldn't be heard here is this page's to say: leaving it goes.
  $effect(() => () => unheard.dismiss());

  function keep() {
    tuningError = '';
    deviceTuning.set(tuning);
  }
</script>

<header class="bar">
  <h1>Tuner</h1>
</header>

<main class="page">
  <div class="field tuning">
    <span id="tuner-tuning-label">Tuning</span>
    <TuningField
      id="tuner-tuning"
      labelledby="tuner-tuning-label"
      allowNone={false}
      bind:value={tuning}
      oncommit={keep}
      oninvalid={(message) => (tuningError = message)}
    />
  </div>
  {#if tuningError}
    <p class="error" role="alert">{tuningError}</p>
  {/if}
  {#if strings}
    <section class="card strings" aria-labelledby="tuner-strings-heading">
      <h2 id="tuner-strings-heading">Tap a string to hear its note</h2>
      <ul>
        {#each strings as s (s.number)}
          <li>
            <button
              type="button"
              class="button"
              aria-label="Hear the {s.number} string, {s.name}"
              title="Hear the {s.number} string"
              onclick={() => hear([s.heard], tunerSound)}
            >
              <span class="note">{s.name}</span>
              <span class="which">{s.number}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<!-- A note that couldn't be heard, the guitar's samples not loading. -->
<Toasts toasts={unheardToasts()} />

<style>
  .tuning {
    max-width: 24rem;
    margin: 0 0 var(--space-4);
  }
  .error {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  }
  .strings {
    padding: var(--space-4);
  }
  h2 {
    margin: 0 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  /* The six strings in a row, low to high, as a guitar is held: on a 320px
     phone too. */
  ul {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .button {
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-3) var(--space-1);
  }
  .note {
    color: var(--text);
    font-size: var(--text-xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .which {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
