<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { CaptureError, InputLevel } from './capture';
  import { channelName, deviceName, meterLevel, sameInput, type InputChoice } from './inputSettings';
  import { input } from './sharedInput.svelte';
  import { audioContext } from './timelinePlayer';

  // The Input picker: the inputs connected and their channels, to choose the
  // one recorded from on this device, and a live level meter of it, to set
  // the interface's gain by. It opens the Input as it's shown, asking for it
  // if it hasn't been allowed, and closes it as it goes. In the recording
  // settings and in Settings' Recording card alike.

  let {
    reported = $bindable(null),
  }: {
    /** The latency the browser reports for the input open, in seconds, once it's open. */
    reported?: number | null;
  } = $props();

  const id = $props.id();

  // The Input chosen on this device, in this tab or another.
  const choice = $derived(input.value);
  // The one metered, to meter another chosen in another tab.
  let metered: InputChoice | null = null;
  // The inputs connected, apart from the browser's own stand-ins for the default.
  let devices = $state<{ deviceId: string; label: string }[]>([]);
  let level = $state.raw<InputLevel | null>(null);
  // How many channels the input open has, and which is metered, once it's open.
  let channels = $state(0);
  let channel = $state(0);
  // The audio device chosen when it isn't connected, so the default is metered instead.
  let gone = $state<string | null>(null);
  let problem = $state<string | null>(null);
  let opening = $state(false);

  // The meter: how full it is, from 0 to 1, and until when it shows clipping.
  let fill = $state(0);
  let clippedUntil = $state(0);
  let now = $state(0);
  const clipHold = 2000;
  // How fast it falls back, in fill per ms, so a peak can be read.
  const fallRate = 1 / 1500;
  let frame = 0;
  let lastFrame = 0;

  // Each opening of the input, so a slower one opened before is let go.
  let generation = 0;

  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(({ deviceId, label }) => ({ deviceId, label }));
    } catch {
      devices = [];
    }
  }

  /** Opens the input chosen, in place of any open, and meters it. */
  async function meter() {
    const mine = ++generation;
    closeLevel();
    opening = true;
    problem = null;
    // Resumed while the click that showed the picker still counts.
    audioContext()
      .resume()
      .catch(() => {});
    metered = $state.snapshot(choice);
    try {
      const opened = await InputLevel.open(audioContext(), metered);
      if (mine !== generation) {
        opened.close();
        return;
      }
      level = opened;
      channels = opened.channels;
      channel = opened.channel;
      gone = opened.gone;
      reported = opened.latency;
      lastFrame = performance.now();
      frame = requestAnimationFrame(step);
    } catch (e) {
      if (mine !== generation) return;
      problem = e instanceof CaptureError ? e.message : `Couldn't open the input (${(e as Error).message}).`;
    } finally {
      // Listed either way, so another input can be chosen in place of one that failed.
      if (mine === generation) {
        opening = false;
        await listDevices();
      }
    }
  }

  function step(time: number) {
    if (!level) return;
    const read = meterLevel(level.samples());
    fill = Math.max(read.fill, fill - (time - lastFrame) * fallRate);
    lastFrame = time;
    if (read.clipped) clippedUntil = time + clipHold;
    now = time;
    frame = requestAnimationFrame(step);
  }

  function closeLevel() {
    cancelAnimationFrame(frame);
    level?.close();
    level = null;
    fill = 0;
    clippedUntil = 0;
  }

  function choose(next: InputChoice) {
    input.set(next);
    meter();
  }

  function chooseDevice(deviceId: string) {
    const label = devices.find((d) => d.deviceId === deviceId)?.label ?? '';
    choose({ deviceId, label, channel: 0 });
  }

  // The device picked: the one chosen, or the default where it's gone.
  const picked = $derived(gone ? '' : choice.deviceId);
  const pickedLabel = $derived(
    devices.find((d) => d.deviceId === picked)?.label ?? (picked ? choice.label : 'Default input'),
  );
  const clipping = $derived(clippedUntil > now);

  // An input plugged in or out: listed again, and the one chosen opened
  // again if it's the one that went or came back, or if opening it failed.
  async function onDeviceChange() {
    await listDevices();
    const present = choice.deviceId === '' || devices.some((d) => d.deviceId === choice.deviceId);
    if (problem || (gone !== null) === present) meter();
  }

  // Another tab chose an Input: it's metered in place of the one before.
  $effect(() => {
    // Read first, so a choice is tracked even while nothing is metered.
    const chosen = choice;
    if (metered && !sameInput(chosen, metered)) untrack(meter);
  });

  onMount(() => {
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    meter();
  });

  onDestroy(() => {
    generation++;
    closeLevel();
    metered = null;
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  });
</script>

<div class="picker">
  <label>
    <span>Input</span>
    <select value={picked} onchange={(e) => chooseDevice(e.currentTarget.value)}>
      <option value="">Default input</option>
      {#each devices as device (device.deviceId)}
        <option value={device.deviceId}>{deviceName(device.label)}</option>
      {/each}
    </select>
  </label>
  <label>
    <span>Channel</span>
    <select
      value={channel}
      onchange={(e) => choose({ ...choice, channel: Number(e.currentTarget.value) })}
      disabled={channels < 2 || gone !== null}
      title={gone ? `The default input's first channel is used while ${gone} isn't connected` : undefined}
    >
      {#each { length: Math.max(1, channels) } as _, i (i)}
        <option value={i}>{channelName(pickedLabel, i)}</option>
      {/each}
    </select>
  </label>
  <div class="level">
    <span id="{id}-level">Level</span>
    <div
      class="meter"
      role="meter"
      aria-labelledby="{id}-level"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(fill * 100)}
      aria-valuetext={clipping ? 'Clipping' : `${Math.round(fill * 100)}%`}
    >
      <div class="meter-fill" class:clipping style:width="{fill * 100}%"></div>
    </div>
    <span class="clip" class:on={clipping} aria-hidden={!clipping} title="The input clipped: turn its gain down"
      >Clip</span
    >
  </div>
  {#if opening}
    <p class="muted" role="status">Opening the input…</p>
  {:else if problem}
    <p class="problem" role="alert">{problem}</p>
  {:else if gone}
    <p class="notice" role="status">{gone} isn't connected, so the default input is used.</p>
  {:else}
    <p class="muted">Set your interface's gain so the loudest part stays out of the red.</p>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  label span,
  .level > span:first-child {
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  select {
    width: 100%;
  }
  .level {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
  }
  .meter {
    height: 0.75rem;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .meter-fill {
    height: 100%;
    background: linear-gradient(to right, var(--finished-fg) 70%, var(--warning) 90%, var(--danger));
    background-size: 22rem 100%;
  }
  .meter-fill.clipping {
    background: var(--danger);
  }
  .clip {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    opacity: 0.4;
  }
  .clip.on {
    background: var(--danger);
    color: var(--bg);
    opacity: 1;
  }
  p {
    margin: 0;
    font-size: var(--text-md);
  }
  .problem {
    color: var(--danger);
  }
  .notice {
    color: var(--warning);
  }
</style>
