<script lang="ts">
  import { identifyInput, openProblem } from './capture';
  import { statusOf } from './inputList';
  import InputName from './InputName.svelte';
  import { InputRows, keyOf, type ConnectedRow } from './inputRows.svelte';
  import type { InputChoice } from './inputSettings';
  import LevelMeter from './LevelMeter.svelte';
  import OffsetField from './OffsetField.svelte';
  import { calibrations } from './sharedCalibration.svelte';

  // The Input list: every Input on this device, to choose the one recorded
  // from and to calibrate any of them. First the default input, then each
  // channel of each device connected, each with a radio to record from it
  // and a pill with its Latency Offset, or why it has none. Pressing a pill
  // opens its row, at first the Input recorded from, with its level meter,
  // idle until Test input opens the Input, and only while the row stays
  // open and isn't calibrating. The row offers Calibrate too, which never
  // changes the Input recorded from, and Type it. Then, under "Not
  // connected", every Input kept whose device isn't, to forget. It leaves
  // calibrating to whatever shows it, e.g. Settings' Recording card.

  let {
    metering = true,
    onCalibrate,
  }: {
    /** Whether the open row meters its Input; not while it's being calibrated, which opens it itself. */
    metering?: boolean;
    /**
     * Asks for an Input to be calibrated: the default input as the Input it
     * turns out to be, or a device's channel exactly, as only that.
     */
    onCalibrate: (input: InputChoice, exact: boolean) => void;
  } = $props();

  const id = $props.id();

  const inputs = new InputRows();
  const rows = $derived(inputs.connected);

  // The row the user opened, by its key, or null for none; until they open
  // one, the row of the Input recorded from is open.
  let userOpened = $state<string | null | undefined>(undefined);
  const openKey = $derived(userOpened !== undefined ? userOpened : (rows.find((row) => row.chosen)?.key ?? 'default'));
  // The open row's Type it, while it's shown, and why an offset typed wasn't kept.
  let typing = $state(false);
  let typeProblem = $state<string | null>(null);

  function toggle(row: ConnectedRow) {
    userOpened = openKey === row.key ? null : row.key;
    typing = false;
    typeProblem = null;
  }

  /**
   * Keeps an offset typed for a row's Input, as a calibrated one is. For
   * the default input, it's that of the Input it is, which only opening it
   * says for sure, so it's opened a moment to find out.
   */
  async function type(row: ConnectedRow, offset: number) {
    typeProblem = null;
    const given = $state.snapshot(row.input);
    let which: InputChoice | null = given;
    if (!row.exact) {
      try {
        which = await identifyInput(given);
      } catch (e) {
        typeProblem = openProblem(e);
        return;
      }
      if (!which) {
        typeProblem = "The browser didn't say which input it is, so nothing was kept.";
        return;
      }
      calibrations.opened(given, which);
    }
    calibrations.keep(which, offset);
    typing = false;
  }
</script>

<div class="input-list">
  {#if inputs.chosenGone}
    <p class="notice" role="status">{inputs.chosenGone} isn't connected, so the default input is used.</p>
  {/if}
  <fieldset class="choice-group">
    <legend class="visually-hidden">Record from</legend>
    <ul aria-label="Inputs">
      {#each rows as row, i (row.key)}
        {@const open = openKey === row.key}
        <li>
          <div class="line">
            <label class="choice-row">
              <input type="radio" name="{id}-record-from" checked={row.chosen} onchange={() => inputs.choose(row)} />
              <span class="name" id="{id}-{i}-name"
                ><InputName name={row.name} channel={row.channel} is={row.is} /></span
              >
            </label>
            <button
              type="button"
              class="chip status tabular"
              class:uncalibrated={row.calibration.offset === null}
              aria-expanded={open}
              aria-controls="{id}-{i}"
              aria-describedby="{id}-{i}-name"
              onclick={() => toggle(row)}>{statusOf(row.calibration)}</button
            >
          </div>
          {#if open}
            <div class="more" id="{id}-{i}">
              {#if metering}
                <LevelMeter
                  input={row.input}
                  onDemand
                  allowed={inputs.allowed}
                  onOpen={(level) => inputs.learn(level)}
                />
              {/if}
              <div class="actions">
                <button
                  type="button"
                  class="button primary"
                  onclick={() => onCalibrate($state.snapshot(row.input), row.exact)}
                  >{row.calibration.offset !== null ? 'Calibrate again' : 'Calibrate'}</button
                >
                <button type="button" class="button" aria-expanded={typing} onclick={() => (typing = !typing)}
                  >Type it</button
                >
              </div>
              {#if typing}
                <OffsetField name={row.name} offset={row.calibration.offset} onSet={(offset) => type(row, offset)} />
                {#if typeProblem}<p class="error" role="alert">{typeProblem}</p>{/if}
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </fieldset>
  {#if inputs.notConnected.length > 0}
    <h3 id="{id}-not-connected">Not connected</h3>
    <ul aria-labelledby="{id}-not-connected">
      {#each inputs.notConnected as row (keyOf(row.input))}
        <li>
          <div class="line">
            <span class="name"><InputName name={row.name} channel={row.input} /></span>
            <span class="badge tag tabular">{statusOf(row.calibration)}</span>
            <button
              type="button"
              class="button"
              aria-label="Forget {row.name}"
              onclick={() => calibrations.forget(row.input)}>Forget</button
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .input-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    border-bottom: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }
  .choice-row {
    flex: 1;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: var(--text-md);
  }
  .status,
  .badge {
    flex: none;
    white-space: nowrap;
  }
  .uncalibrated {
    color: var(--text-muted);
  }
  .more {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* Lined up with the name, past the radio. */
    padding: 0 0 var(--space-3) calc(var(--checkbox) + var(--space-2));
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  fieldset {
    min-width: 0;
  }
  h3 {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  p {
    margin: 0;
    font-size: var(--text-md);
  }
  .notice {
    color: var(--warning);
  }
</style>
