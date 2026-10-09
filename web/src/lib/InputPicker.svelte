<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { InputLevel } from './capture';
  import { channelName, deviceName, type InputChoice } from './inputSettings';
  import LevelMeter from './LevelMeter.svelte';
  import { input } from './sharedInput.svelte';

  // The Input picker: the inputs connected and their channels, to choose the
  // one recorded from on this device, and a live level meter of it, to set
  // the interface's gain by. It opens the Input as it's shown, asking for it
  // if it hasn't been allowed, and closes it as it goes. In the recording
  // settings.

  let {
    reported = $bindable(null),
  }: {
    /** The latency the browser reports for the input open, in seconds, once it's open. */
    reported?: number | null;
  } = $props();

  // The Input chosen on this device, in this tab or another.
  const choice = $derived(input.value);
  // The inputs connected, apart from the browser's own stand-ins for the default.
  let devices = $state<{ deviceId: string; label: string }[]>([]);
  // How many channels the input open has, and which is metered, once it's open.
  let channels = $state(0);
  let channel = $state(0);
  // The audio device chosen when it isn't connected, so the default is metered instead.
  let gone = $state<string | null>(null);

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

  // Listed either way, so another input can be chosen in place of one that failed.
  function onOpen(level: InputLevel | null) {
    if (level) {
      channels = level.channels;
      channel = level.channel;
      gone = level.gone;
      reported = level.latency;
    }
    void listDevices();
  }

  function choose(next: InputChoice) {
    input.set(next);
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

  onMount(() => navigator.mediaDevices?.addEventListener('devicechange', listDevices));
  onDestroy(() => navigator.mediaDevices?.removeEventListener('devicechange', listDevices));
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
  <LevelMeter input={choice} {onOpen} />
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
  label span {
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  select {
    width: 100%;
  }
</style>
