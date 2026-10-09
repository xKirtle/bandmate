<script lang="ts">
  import { CaptureError, connectedDevices, identifyInput, watchInputs, type InputLevel } from './capture';
  import { listInputs, statusOf, type ConnectedDevice, type InputRow } from './inputList';
  import { channelName, deviceName, type InputChoice } from './inputSettings';
  import LevelMeter from './LevelMeter.svelte';
  import OffsetField from './OffsetField.svelte';
  import { RecordedInput } from './recordedInput.svelte';
  import { calibrations } from './sharedCalibration.svelte';
  import { input } from './sharedInput.svelte';

  // The Input list: every Input on this device, to choose the one recorded
  // from and to calibrate any of them. First the default input, then each
  // channel of each device connected, each with a radio to record from it
  // and a pill with its Latency Offset, or why it has none. Pressing a pill
  // opens its row, at first the Input recorded from: only that Input is
  // open, for its level meter, and the row offers Calibrate, which never
  // changes the Input recorded from, and Type it. Then, under "Not
  // connected", every Input kept whose device isn't, to forget. In Settings'
  // Recording card and the Timeline's recording settings alike.

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

  const defaultInput: InputChoice = { deviceId: '', label: '', channel: 0 };
  // The Input chosen on this device, in this tab or another.
  const choice = $derived(input.value);
  // The default input, as chosen where it is, e.g. a channel of it chosen before Inputs were listed.
  const defaultChoice = $derived(choice.deviceId === '' ? choice : defaultInput);
  // The Input the default input looks to be, and its calibration.
  const defaultRecorded = new RecordedInput(() => defaultChoice);
  const defaultShown = $derived(defaultRecorded.calibration);

  // The audio devices connected, with how many channels each is known to
  // have; null while which they are can't be told. Told again as they come
  // and go, and once the browser allows the microphone.
  let devices = $state.raw<ConnectedDevice[] | null>(null);
  $effect(() => {
    let live = true;
    const check = async () => {
      const listed = await connectedDevices();
      if (live) devices = listed;
    };
    void check();
    const unwatch = watchInputs(check);
    return () => {
      live = false;
      unwatch();
    };
  });
  // How many channels a device turned out to have once opened, where the browser didn't say before.
  let learned = $state<Record<string, number>>({});
  const rows = $derived(
    listInputs(
      devices?.map((d) => ({ ...d, channels: Math.max(d.channels, learned[d.deviceId] ?? 0) })) ?? null,
      calibrations.kept,
    ),
  );

  const key = (row: InputChoice) => `${row.deviceId} ${row.channel}`;
  const defaultKey = 'default';
  const chosenKey = $derived(choice.deviceId === '' ? defaultKey : key(choice));
  // The device chosen when it isn't connected, so the default input is recorded from.
  const chosenGone = $derived(
    choice.deviceId !== '' && devices !== null && !devices.some((d) => d.deviceId === choice.deviceId)
      ? deviceName(choice.label)
      : null,
  );
  // The row opened: until one is, the Input recorded from; null, none.
  let opened = $state<string | null | undefined>(undefined);
  const openKey = $derived(
    opened !== undefined ? opened : rows.connected.some((row) => key(row.input) === chosenKey) ? chosenKey : defaultKey,
  );
  // The open row's Type it, while it's shown, and why an offset typed wasn't kept.
  let typing = $state(false);
  let typeProblem = $state<string | null>(null);
  // The Input the default input turned out to be, as metered.
  let defaultIs = $state.raw<InputChoice | null>(null);

  function open(rowKey: string) {
    opened = openKey === rowKey ? null : rowKey;
    typing = false;
    typeProblem = null;
  }

  function learn(level: InputLevel | null) {
    const deviceId = level?.opened?.deviceId;
    if (level && deviceId) learned[deviceId] = Math.max(learned[deviceId] ?? 0, level.channels);
  }

  /**
   * Keeps an offset typed for the default input as that of the Input it
   * is, as only opening it says for sure: the one metered, or else it's
   * opened a moment to find out.
   */
  async function typeForDefault(offset: number) {
    typeProblem = null;
    let which = defaultIs;
    if (!which) {
      try {
        which = await identifyInput($state.snapshot(defaultChoice));
      } catch (e) {
        typeProblem = e instanceof CaptureError ? e.message : `Couldn't open the input (${(e as Error).message}).`;
        return;
      }
    }
    if (!which) {
      typeProblem = "The browser didn't say which input it is, so nothing was kept.";
      return;
    }
    calibrations.opened($state.snapshot(defaultChoice), which);
    calibrations.keep(which, offset);
    typing = false;
  }

  function typeFor(row: InputRow, offset: number) {
    calibrations.keep(row.input, offset);
    typing = false;
  }
</script>

{#snippet details(
  rowKey: string,
  name: string,
  offset: number | null,
  meterInput: InputChoice,
  onLevel: (level: InputLevel | null) => void,
  calibrate: () => void,
  onSet: (offset: number) => void,
)}
  <div class="more" id="{id}-{rowKey}">
    {#if metering}
      <LevelMeter input={meterInput} onOpen={onLevel} />
    {/if}
    <div class="actions">
      <button type="button" class="button primary" onclick={calibrate}
        >{offset !== null ? 'Calibrate again' : 'Calibrate'}</button
      >
      <button type="button" class="button" aria-expanded={typing} onclick={() => (typing = !typing)}>Type it</button>
    </div>
    {#if typing}
      <OffsetField {name} {offset} {onSet} />
      {#if typeProblem}<p class="error" role="alert">{typeProblem}</p>{/if}
    {/if}
  </div>
{/snippet}

{#snippet status(rowKey: string, text: string, uncalibrated: boolean)}
  <button
    type="button"
    class="chip status tabular"
    class:uncalibrated
    aria-expanded={openKey === rowKey}
    aria-controls="{id}-{rowKey}"
    aria-describedby="{id}-{rowKey}-name"
    onclick={() => open(rowKey)}>{text}</button
  >
{/snippet}

<div class="input-list">
  {#if chosenGone}
    <p class="notice" role="status">{chosenGone} isn't connected, so the default input is used.</p>
  {/if}
  <fieldset class="choice-group">
    <legend class="visually-hidden">Record from</legend>
    <ul aria-label="Inputs">
      <li class:open={openKey === defaultKey}>
        <div class="line">
          <label class="choice-row">
            <input
              type="radio"
              name="{id}-record-from"
              checked={choice.deviceId === ''}
              onchange={() => input.set(defaultInput)}
            />
            <span class="name" id="{id}-{defaultKey}-name"
              >Default input{#if defaultRecorded.current}<span class="is"
                  >{channelName(defaultRecorded.current.label, defaultRecorded.current.channel)}</span
                >{/if}</span
            >
          </label>
          {@render status(defaultKey, statusOf(defaultShown), defaultShown.offset === null)}
        </div>
        {#if openKey === defaultKey}
          {@render details(
            defaultKey,
            'Default input',
            defaultShown.offset,
            defaultChoice,
            (level) => {
              learn(level);
              defaultIs = level?.opened ?? null;
            },
            () => onCalibrate($state.snapshot(defaultChoice), false),
            typeForDefault,
          )}
        {/if}
      </li>
      {#each rows.connected as row (key(row.input))}
        {@const rowKey = key(row.input)}
        <li class:open={openKey === rowKey}>
          <div class="line">
            <label class="choice-row">
              <input
                type="radio"
                name="{id}-record-from"
                checked={chosenKey === rowKey}
                onchange={() => input.set($state.snapshot(row.input))}
              />
              <span class="name" id="{id}-{rowKey}-name">{row.name}</span>
            </label>
            {@render status(rowKey, statusOf(row.calibration), row.calibration.offset === null)}
          </div>
          {#if openKey === rowKey}
            {@render details(
              rowKey,
              row.name,
              row.calibration.offset,
              row.input,
              learn,
              () => onCalibrate($state.snapshot(row.input), true),
              (offset) => typeFor(row, offset),
            )}
          {/if}
        </li>
      {/each}
    </ul>
  </fieldset>
  {#if rows.notConnected.length > 0}
    <h3 id="{id}-not-connected">Not connected</h3>
    <ul aria-labelledby="{id}-not-connected">
      {#each rows.notConnected as row (key(row.input))}
        <li>
          <div class="line">
            <span class="name">{row.name}</span>
            <span class="pill tabular" class:uncalibrated={row.calibration.offset === null}
              >{statusOf(row.calibration)}</span
            >
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
    border-top: 1px solid var(--border);
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
    overflow-wrap: anywhere;
  }
  /* What the default input is, under its name. */
  .is {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .status,
  .pill {
    flex: none;
    white-space: nowrap;
  }
  .pill {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    font-size: var(--text-md);
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
