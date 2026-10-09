<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { formatOffset } from './calibration';
  import InputPicker from './InputPicker.svelte';
  import { placeBeside } from './popover';

  // The recording settings, opened from the transport row's ⋯: the Input
  // picker, to choose what to record from on this device, with a live level
  // meter of it while they're open; and the chosen Input's Latency Offset,
  // calibrated or not, with calibration of it to run again.

  let {
    disabled = false,
    offset,
    onCalibrate,
  }: {
    /** Keeps them from opening, and closes them, e.g. while recording. */
    disabled?: boolean;
    /** The Latency Offset calibrated for the chosen Input, in seconds, or null. */
    offset: number | null;
    /** Asks for calibration of the chosen Input to run. */
    onCalibrate: () => void;
  } = $props();

  let open = $state(false);
  // What they're placed by, e.g. the ⋯ they were opened from, and what had
  // focus as they opened, to give it back as they close.
  let anchor: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;
  let panel = $state<HTMLElement>();
  // Between what they're placed by and the panel, in px.
  const gap = 4;

  // The latency the browser reports for the input open, in seconds.
  let reported = $state<number | null>(null);

  /**
   * Opens them by an element, e.g. the ⋯ they're chosen from, under it or
   * over it where there's no room below, with focus in them.
   */
  export async function openSettings(by: HTMLElement) {
    if (disabled || open) return;
    anchor = by;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open = true;
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('select')?.focus();
  }

  function place() {
    if (panel && anchor) placeBeside(panel, anchor, gap, 'end');
  }

  // Closing them closes the input, as the picker goes.
  function hide(refocus = true) {
    if (!open) return;
    open = false;
    if (refocus) returnFocus?.focus();
    anchor = returnFocus = null;
  }

  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    hide();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !panel?.contains(e.target as Node)) hide(false);
  }

  $effect(() => {
    if (disabled) hide(false);
  });

  onDestroy(() => hide(false));
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => open && place()} />

{#if open}
  <div
    class="popover panel"
    role="dialog"
    aria-label="Recording settings"
    tabindex="-1"
    popover="manual"
    bind:this={panel}
    onkeydown={onPanelKey}
  >
    <InputPicker bind:reported />
    <div class="latency">
      <p class="tabular">
        <span>Latency Offset</span>
        {#if offset !== null}
          {formatOffset(offset)}
        {:else}
          Not calibrated{reported !== null ? `: the browser's ${formatOffset(reported)} is used` : ''}
        {/if}
      </p>
      <button
        type="button"
        class="button"
        onclick={() => {
          hide(false);
          onCalibrate();
        }}>{offset !== null ? 'Calibrate again' : 'Calibrate'}</button
      >
    </div>
  </div>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(22rem, calc(100vw - 2rem));
    padding: var(--space-4);
  }
  p {
    margin: 0;
    font-size: var(--text-md);
  }
  .latency {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .latency span {
    display: block;
    color: var(--text-muted);
  }
</style>
