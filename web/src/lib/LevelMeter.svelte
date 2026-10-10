<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { InputLevel, openProblem } from './capture';
  import { meterLevel, sameInput, type InputChoice } from './inputSettings';
  import { audioContext } from './timelinePlayer';

  // An Input's live level meter and Clip light, to set the interface's gain
  // by, with what's wrong where it can't be opened. It opens the Input as
  // it's shown, asking for the microphone if it hasn't been allowed, or, on
  // demand, only once Test input is pressed, idle till then and again once
  // Stop is. While it's metering, it opens another in its place as it's
  // given one, and it closes it as it goes. The meter draws one gradient,
  // green to red, across its whole width, and shows it up to the level.

  let {
    input,
    onDemand = false,
    paused = false,
    allowed = true,
    onOpen,
  }: {
    /** The Input to meter, as chosen: the default input meters the Input it turns out to be. */
    input: InputChoice;
    /** Whether it waits for Test input to open the Input, rather than opening it as it's shown. */
    onDemand?: boolean;
    /** Whether the browser has allowed the microphone, so opening the Input won't ask for it. */
    allowed?: boolean;
    /** On demand, whether Test input waits, e.g. while the Input is being calibrated: it's idle meanwhile. */
    paused?: boolean;
    /** Hears each opening of it: the Input open, or null where it couldn't be opened. */
    onOpen?: (level: InputLevel | null) => void;
  } = $props();

  const id = $props.id();

  // The one metered, to open another given in its place; null while idle.
  let metered: InputChoice | null = null;
  // Whether it's metering, or opening the Input to: on demand, from Test input till Stop.
  let testing = $state(false);
  let level = $state.raw<InputLevel | null>(null);
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

  /** Opens the Input given, in place of any open, and meters it. */
  async function meter() {
    const mine = ++generation;
    closeLevel();
    testing = true;
    opening = true;
    problem = null;
    // Resumed while the click that showed the meter still counts.
    audioContext()
      .resume()
      .catch(() => {});
    metered = $state.snapshot(input);
    try {
      const opened = await InputLevel.open(audioContext(), metered);
      if (mine !== generation) {
        opened.close();
        return;
      }
      level = opened;
      gone = opened.gone;
      lastFrame = performance.now();
      frame = requestAnimationFrame(step);
    } catch (e) {
      if (mine !== generation) return;
      problem = openProblem(e);
      // On demand, it's idle again, with Test input to try again.
      if (onDemand) stop();
    }
    opening = false;
    onOpen?.(level);
  }

  /** Closes the Input, leaving the meter idle, and any problem opening it shown. */
  function stop() {
    generation++;
    closeLevel();
    metered = null;
    testing = false;
    opening = false;
    gone = null;
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

  const clipping = $derived(clippedUntil > now);

  // An input plugged in or out: the one given opened again if it's the
  // one that went or came back, or if opening it failed.
  async function onDeviceChange() {
    // Idle, it's left so: a test never starts on its own.
    if (!testing) return;
    let present = true;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      present = input.deviceId === '' || devices.some((d) => d.deviceId === input.deviceId);
    } catch {
      // Can't tell, so it's left as it is, unless it failed.
    }
    // Asked again, as Stop may have been pressed while the devices were listed.
    if (testing && (problem || (gone !== null) === present)) meter();
  }

  // Another Input given, e.g. chosen in another tab: it's metered in place of the one before.
  $effect(() => {
    // Read first, so it's tracked even while nothing is metered.
    const given = input;
    if (metered && !sameInput(given, metered)) untrack(meter);
  });

  // Paused, it's idle, and stays so once it isn't.
  $effect(() => {
    if (paused) untrack(stop);
  });

  onMount(() => {
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    if (!onDemand) meter();
  });

  onDestroy(() => {
    stop();
    navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  });
</script>

<div class="level-meter">
  <div class="level" class:idle={onDemand && !testing} class:on-demand={onDemand}>
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
      <!-- The whole gradient, shown up to the level. -->
      <div class="meter-fill" class:clipping style:clip-path="inset(0 {100 - fill * 100}% 0 0)"></div>
    </div>
    <span class="clip" class:on={clipping} aria-hidden={!clipping} title="The input clipped: turn its gain down"
      >Clip</span
    >
    {#if onDemand}
      <!-- As wide either way, both labels in one cell, so the row never shifts. -->
      <button
        type="button"
        class="button test"
        disabled={paused}
        onclick={() => {
          if (testing) stop();
          else meter();
        }}><span class:shown={!testing}>Test input</span><span class:shown={testing}>Stop</span></button
      >
    {/if}
  </div>
  {#if opening}
    <p class="muted" role="status">Opening the input…</p>
  {:else if problem}
    <p class="problem" role="alert">{problem}</p>
  {:else if gone}
    <p class="notice" role="status">{gone} isn't connected, so the default input is used.</p>
  {:else if !testing && !allowed}
    <p class="muted">Test input asks for the microphone. Allowing it also lets the browser list your inputs by name.</p>
  {:else}
    <p class="muted">Set your interface's gain so the loudest part stays out of the red.</p>
  {/if}
</div>

<style>
  .level-meter {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .level {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
  }
  .level.on-demand {
    grid-template-columns: auto 1fr auto auto;
  }
  .level > span:first-child {
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  .meter {
    height: 0.75rem;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  /* Idle, the meter's greyed until Test input is pressed. */
  .idle .meter {
    opacity: 0.6;
  }
  .meter-fill {
    height: 100%;
    background: linear-gradient(to right, var(--finished-fg) 70%, var(--warning) 90%, var(--danger));
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
  .test {
    display: grid;
  }
  .test > span {
    grid-area: 1 / 1;
    visibility: hidden;
  }
  .test > .shown {
    visibility: visible;
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
