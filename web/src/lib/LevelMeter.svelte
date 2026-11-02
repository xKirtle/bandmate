<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { InputLevel } from './capture';
  import { meterLevel, type InputChoice } from './inputSettings';
  import { OpenedInput } from './openedInput.svelte';

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

  // The Input metered: on demand, from Test input till Stop.
  const metered = new OpenedInput(() => ({ choice: input }), {
    // On demand, a failure leaves it idle again, with Test input to try again.
    get stopOnFailure() {
      return onDemand;
    },
    onOpen: (level) => onOpen?.(level),
  });

  // The meter: how full it is, from 0 to 1, and until when it shows clipping.
  let fill = $state(0);
  let clippedUntil = $state(0);
  let now = $state(0);
  const clipHold = 2000;
  // How fast it falls back, in fill per ms, so a peak can be read.
  const fallRate = 1 / 1500;

  // Read every frame while the Input is open, and empty once it isn't.
  $effect(() => {
    const level = metered.level;
    if (!level) return;
    let lastFrame = performance.now();
    let frame = requestAnimationFrame(function step(time) {
      const read = meterLevel(level.samples());
      fill = Math.max(read.fill, fill - (time - lastFrame) * fallRate);
      lastFrame = time;
      if (read.clipped) clippedUntil = time + clipHold;
      now = time;
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      fill = 0;
      clippedUntil = 0;
    };
  });

  const clipping = $derived(clippedUntil > now);

  // Paused, it's idle, and stays so once it isn't.
  $effect(() => {
    if (paused) untrack(() => metered.stop());
  });

  onMount(() => {
    if (!onDemand) void metered.start();
  });
</script>

<div class="level-meter">
  <div class="level" class:idle={onDemand && !metered.on} class:on-demand={onDemand}>
    {#if onDemand}
      <!-- First, in the accent while idle to be seen, plain while it meters.
           As wide either way, both labels in one cell, so the row never shifts. -->
      <button
        type="button"
        class="button test"
        class:primary={!metered.on}
        disabled={paused}
        onclick={() => {
          if (metered.on) metered.stop();
          else void metered.start();
        }}><span class:shown={!metered.on}>Test input</span><span class:shown={metered.on}>Stop</span></button
      >
    {/if}
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
  </div>
  {#if metered.opening}
    <p class="muted" role="status">Opening the input…</p>
  {:else if metered.problem}
    <p class="problem" role="alert">{metered.problem}</p>
  {:else if metered.gone}
    <p class="notice" role="status">{metered.gone} isn't connected, so the default input is used.</p>
  {:else if !metered.on && !allowed}
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
    grid-template-columns: auto auto 1fr auto;
  }
  .level > span:first-of-type {
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
