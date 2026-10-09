<script lang="ts">
  // Settings' This device tab: every Device Setting, the choices about how
  // Bandmate works on this device rather than any Song. Each applies at once,
  // in every one of this device's tabs, and is kept on this device. Those
  // also changed where they're used, like Left-handed in the Chord Finder,
  // are the same setting here.
  import { MediaQuery } from 'svelte/reactivity';
  import { palettes, themeChoices } from '../lib/appearance';
  import { offsetSummary } from '../lib/calibration';
  import CalibrationDialog from '../lib/CalibrationDialog.svelte';
  import { connectedDevices, watchInputs } from '../lib/capture';
  import InputPicker from '../lib/InputPicker.svelte';
  import OffsetField from '../lib/OffsetField.svelte';
  import { channelName, inputName, type InputChoice } from '../lib/inputSettings';
  import SettingsPage from '../lib/SettingsPage.svelte';
  import { appearance } from '../lib/sharedAppearance.svelte';
  import { RecordedInput } from '../lib/recordedInput.svelte';
  import { calibrations } from '../lib/sharedCalibration.svelte';
  import { input } from '../lib/sharedInput.svelte';
  import { leftHanded } from '../lib/sharedLeftHanded.svelte';

  // Recording is offered only as wide as the Timeline offers editing, so
  // the Recording card is too. Narrower, it goes, closing the Input with it.
  const recordingOffered = new MediaQuery('min-width: 40.0625rem');
  // Whether the Input picker is shown, with the Input open for its meter;
  // leaving the tab closes both.
  let changingInput = $state(false);
  // The Input being calibrated: the one chosen, or one listed, measured as itself only.
  let calibrating = $state.raw<{ input: InputChoice; exact: boolean } | null>(null);
  // The Latency Offset of the Input recording would open, to show.
  const recordedInput = new RecordedInput(() => input.value);
  const offset = $derived(recordedInput.calibration.offset);

  // The audio devices connected, to say which listed Inputs aren't; null
  // while that can't be told. Told again as they come and go, and once the
  // browser allows the microphone.
  let connected = $state.raw<Set<string> | null>(null);
  const calibrated = $derived(calibrations.calibrated);
  $effect(() => {
    let live = true;
    const check = async () => {
      const ids = await connectedDevices();
      if (live) connected = ids;
    };
    void check();
    const unwatch = watchInputs(check);
    return () => {
      live = false;
      unwatch();
    };
  });

  // Narrowed past where recording is offered, the picker goes for good, so
  // widening again never opens the Input unasked.
  $effect(() => {
    if (!recordingOffered.current) changingInput = false;
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
        <!-- At a glance, without opening the Input. -->
        <dl class="summary">
          <div>
            <dt>Input</dt>
            <dd>{inputName(input.value)}</dd>
          </div>
          <div>
            <dt>Latency Offset</dt>
            <dd class="tabular">{offsetSummary(offset)}</dd>
          </div>
        </dl>
        {#if changingInput}
          <div id="input-picker">
            <InputPicker />
          </div>
        {/if}
        <div class="actions">
          <button
            type="button"
            class="button"
            aria-expanded={changingInput}
            aria-controls="input-picker"
            onclick={() => (changingInput = !changingInput)}>{changingInput ? 'Done' : 'Change input'}</button
          >
          <button
            type="button"
            class="button"
            onclick={() => {
              changingInput = false;
              calibrating = { input: $state.snapshot(input.value), exact: false };
            }}>{offset !== null ? 'Calibrate again' : 'Calibrate'}</button
          >
        </div>
        {#if calibrated.length > 0}
          <!-- Every Input calibrated on this device, connected or not, its offset to type, calibrate again or forget. -->
          <div class="calibrated">
            <h3 id="calibrated-heading">Calibrated inputs</h3>
            <ul aria-labelledby="calibrated-heading">
              {#each calibrated as listed (`${listed.deviceId} ${listed.channel}`)}
                {@const name = channelName(listed.label, listed.channel)}
                {@const unplugged = connected !== null && !connected.has(listed.deviceId)}
                <li>
                  <div class="about">
                    <span class="name">{name}</span>
                    {#if unplugged}<span class="hint">Not connected</span>{/if}
                    <!-- Its offset, to type, even unplugged. -->
                    <OffsetField
                      {name}
                      offset={listed.offset}
                      onSet={(offset) => {
                        const { deviceId, label, channel } = listed;
                        calibrations.set({ deviceId, label, channel }, { offset, offered: true });
                      }}
                    />
                  </div>
                  <div class="row-actions">
                    <!-- Only a connected one can be measured. -->
                    {#if !unplugged}
                      <button
                        type="button"
                        class="button"
                        aria-label="Calibrate {name} again"
                        onclick={() => {
                          changingInput = false;
                          const { deviceId, label, channel } = listed;
                          calibrating = { input: { deviceId, label, channel }, exact: true };
                        }}>Calibrate again</button
                      >
                    {/if}
                    <button
                      type="button"
                      class="button"
                      aria-label="Forget {name}"
                      onclick={() => calibrations.forget(listed)}>Forget</button
                    >
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    {/if}

    <section class="card" aria-labelledby="chord-diagrams-heading">
      <h2 id="chord-diagrams-heading">Chord diagrams</h2>
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
  <CalibrationDialog input={calibrating.input} exact={calibrating.exact} onClose={() => (calibrating = null)} />
{/if}

<style>
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
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }
  dt {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  dd {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .calibrated {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
  }
  ul {
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    /* Where the name would be squeezed, as at phone width, the buttons go under it. */
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .about {
    display: flex;
    flex: 1 1 10rem;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    flex: none;
    gap: var(--space-1);
    margin-left: auto;
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
