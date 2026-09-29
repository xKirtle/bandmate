<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { CaptureError, InputLevel } from './capture';
  import { channelName, deviceName, meterLevel, readInput, storeInput, type InputChoice } from './inputSettings';
  import { popoverLeft, popoverTop } from './popover';
  import { deviceStorage } from './timelineHeight';
  import { audioContext } from './timelinePlayer';

  // The recording settings, beside Record: the input to record from, a
  // device and one of its channels, kept on this device, and a live level
  // meter of it while they're open, to set the interface's gain by.

  let {
    disabled = false,
  }: {
    /** Keeps them from opening, e.g. while recording. */
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let root: HTMLElement;
  let trigger: HTMLButtonElement;
  let panel = $state<HTMLElement>();
  // Between the trigger and the panel, in px.
  const gap = 4;

  let choice = $state<InputChoice>(readInput(deviceStorage()));
  // The inputs connected, apart from the browser's own stand-ins for the default.
  let devices = $state<{ deviceId: string; label: string }[]>([]);
  let level = $state.raw<InputLevel | null>(null);
  // How many channels the input open has, and which is metered, once it's open.
  let channels = $state(0);
  let channel = $state(0);
  // The device chosen when it isn't connected, so the default is metered instead.
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
    // Resumed while the click that opened the panel still counts.
    audioContext()
      .resume()
      .catch(() => {});
    try {
      const opened = await InputLevel.open(audioContext(), $state.snapshot(choice));
      if (mine !== generation) {
        opened.close();
        return;
      }
      level = opened;
      channels = opened.channels;
      channel = opened.channel;
      gone = opened.gone;
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
    choice = next;
    storeInput(deviceStorage(), next);
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

  async function show() {
    open = true;
    choice = readInput(deviceStorage());
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('select')?.focus();
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    meter();
  }

  function place() {
    if (!panel) return;
    const at = trigger.getBoundingClientRect();
    panel.style.left = '0px';
    const { width, height } = panel.getBoundingClientRect();
    panel.style.top = `${popoverTop(at, height, window.innerHeight, gap)}px`;
    panel.style.left = `${popoverLeft(at, width, document.documentElement.clientWidth, gap, 'start')}px`;
  }

  function hide(refocus = true) {
    if (!open) return;
    open = false;
    generation++;
    closeLevel();
    opening = false;
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    if (refocus) trigger.focus();
  }

  // An input plugged in or out: listed again, and the one chosen opened
  // again if it's the one that went or came back, or if opening it failed.
  async function onDeviceChange() {
    await listDevices();
    const present = choice.deviceId === '' || devices.some((d) => d.deviceId === choice.deviceId);
    if (problem || (gone !== null) === present) meter();
  }

  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    hide();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) hide(false);
  }

  $effect(() => {
    if (disabled) hide(false);
  });

  onDestroy(() => hide(false));
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => open && place()} />

<div class="settings-root" bind:this={root}>
  <button
    type="button"
    class="icon"
    bind:this={trigger}
    aria-label="Recording settings"
    title="Recording settings: input and level"
    aria-haspopup="dialog"
    aria-expanded={open}
    {disabled}
    onclick={() => (open ? hide() : show())}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  </button>
  {#if open}
    <div
      class="panel"
      role="dialog"
      aria-label="Recording settings"
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
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
        <span id="input-level-label">Level</span>
        <div
          class="meter"
          role="meter"
          aria-labelledby="input-level-label"
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
  {/if}
</div>

<style>
  svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .panel {
    position: fixed;
    inset: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: min(22rem, calc(100vw - 2rem));
    margin: 0;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--text) 18%, transparent);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  label span,
  .level > span:first-child {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  select {
    width: 100%;
  }
  .level {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.5rem;
  }
  .meter {
    height: 0.75rem;
    overflow: hidden;
    border-radius: 0.375rem;
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
    padding: 0 0.375rem;
    border-radius: 0.25rem;
    color: var(--text-muted);
    font-size: 0.75rem;
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
    font-size: 0.875rem;
  }
  .problem {
    color: var(--danger);
  }
  .notice {
    color: var(--warning);
  }
</style>
