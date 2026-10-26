<script lang="ts">
  // Settings' This device tab: every Device Setting, the choices about how
  // Bandmate works on this device rather than any Song. Each applies at once,
  // in every one of this device's tabs, and is kept on this device. Those
  // also changed where they're used, like the Input in the Timeline, are
  // the same setting here. Writing sets up the rhyming dictionaries.
  import { MediaQuery } from 'svelte/reactivity';
  import { palettes, themeChoices } from '../lib/appearance';
  import CalibrationSheet from '../lib/CalibrationSheet.svelte';
  import DictionaryList from '../lib/DictionaryList.svelte';
  import InputList from '../lib/InputList.svelte';
  import type { InputChoice } from '../lib/inputSettings';
  import SettingsPage from '../lib/SettingsPage.svelte';
  import { instruments } from '../lib/chordFinder';
  import { instrumentText } from '../lib/deviceInstrument';
  import { appearance } from '../lib/sharedAppearance.svelte';
  import { instrument, pickInstrument } from '../lib/sharedInstrument.svelte';
  import { leftHanded } from '../lib/sharedLeftHanded.svelte';

  // Recording is offered only as wide as the Timeline offers editing, so
  // the Recording card is too. Narrower, it goes, closing the Input with it.
  const recordingOffered = new MediaQuery('min-width: 40.0625rem');
  // The Input being calibrated: the default input as the Input it turns out to be, or a listed one exactly.
  let calibrating = $state.raw<{ input: InputChoice; exact: boolean } | null>(null);

  // A link to a card, such as the Rhymes card's to Writing, opens at it.
  $effect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  });
</script>

<SettingsPage tab="device">
  <p class="kept hint">Kept on this device.</p>
  <div class="cards">
    <section class="card" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <fieldset class="choice-group">
        <legend>Palette</legend>
        {#each palettes as palette (palette.id)}
          <label class="choice-row">
            <input
              type="radio"
              name="palette"
              checked={appearance.palette === palette.id}
              onchange={() => appearance.setPalette(palette.id)}
            />
            <!-- The Palette's page and accent, in the light or dark shown now. -->
            <span class="swatch" data-palette={palette.id} aria-hidden="true"><span class="accent"></span></span>
            <span>{palette.label}</span>
          </label>
        {/each}
      </fieldset>
      <fieldset class="choice-group">
        <legend>Light or dark</legend>
        {#each themeChoices as choice (choice.id)}
          <label class="choice-row">
            <input
              type="radio"
              name="theme"
              checked={appearance.themeChoice === choice.id}
              onchange={() => appearance.setThemeChoice(choice.id)}
            />
            <span>{choice.label}</span>
          </label>
        {/each}
      </fieldset>
    </section>

    {#if recordingOffered.current}
      <section class="card" aria-labelledby="recording-heading">
        <h2 id="recording-heading">Recording</h2>
        <!-- Every Input on this device, to record from, calibrate, type an offset for, or forget. -->
        <InputList metering={!calibrating} onCalibrate={(input, exact) => (calibrating = { input, exact })} />
      </section>
    {/if}

    <section class="card" id="rhyming-dictionaries" aria-labelledby="rhyming-dictionaries-heading">
      <h2 id="rhyming-dictionaries-heading">Rhyming dictionaries</h2>
      <p class="hint intro">
        Rhymes are suggested in the languages whose rhyming dictionaries you download here. They download from your
        Bandmate server and are kept on this device, so Rhymes work offline too.
      </p>
      <DictionaryList />
    </section>

    <section class="card" aria-labelledby="chords-heading">
      <h2 id="chords-heading">Chords</h2>
      <fieldset class="choice-group">
        <legend>Instrument</legend>
        {#each instruments as choice (choice)}
          <label class="choice-row">
            <input
              type="radio"
              name="instrument"
              checked={instrument.value === choice}
              onchange={() => pickInstrument(choice)}
              aria-describedby="instrument-note"
            />
            <span>{instrumentText(choice)}</span>
          </label>
        {/each}
        <p id="instrument-note" class="choice-under hint">
          What the Chords page plays and Read mode's Chord Chart draws Chords on.
        </p>
      </fieldset>
      <fieldset class="choice-group">
        <label class="choice-row">
          <input
            type="checkbox"
            role="switch"
            checked={leftHanded.value}
            onchange={(e) => leftHanded.set(e.currentTarget.checked)}
            aria-describedby="left-handed-note"
          />
          <span>Left-handed</span>
        </label>
        <p id="left-handed-note" class="choice-under hint">Mirrors every Chord diagram, high string on the left.</p>
      </fieldset>
    </section>
  </div>
</SettingsPage>

{#if calibrating}
  <CalibrationSheet input={calibrating.input} exact={calibrating.exact} onClose={() => (calibrating = null)} />
{/if}

<style>
  .intro {
    margin: 0;
  }
  .kept {
    margin: 0 0 var(--space-4);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* A Palette in small, as tall as the radio button beside it: its page,
     with its accent on it. */
  .swatch {
    flex: none;
    display: grid;
    place-items: center;
    width: calc(2 * var(--checkbox));
    height: var(--checkbox);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .accent {
    width: calc(var(--checkbox) / 2);
    height: calc(var(--checkbox) / 2);
    border-radius: var(--radius-full);
    background: var(--accent);
  }
</style>
