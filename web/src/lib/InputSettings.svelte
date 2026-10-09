<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import InputList from './InputList.svelte';
  import type { InputChoice } from './inputSettings';
  import { placeBeside } from './popover';

  // The recording settings, opened from the transport row's ⋯: the Input
  // list, as in Settings, to choose the Input recorded from on this device,
  // meter it, calibrate any Input, or type its offset. Calibrating closes
  // them, leaving the calibration sheet to whatever shows them.

  let {
    disabled = false,
    onCalibrate,
  }: {
    /** Keeps them from opening, and closes them, e.g. while recording. */
    disabled?: boolean;
    /**
     * Asks for an Input to be calibrated, as the Input list asks: the
     * default input as the Input it turns out to be, or a device's channel
     * exactly, as only that.
     */
    onCalibrate: (input: InputChoice, exact: boolean) => void;
  } = $props();

  let open = $state(false);
  // What they're placed by, e.g. the ⋯ they were opened from, and what had
  // focus as they opened, to give it back as they close.
  let anchor: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;
  let panel = $state<HTMLElement>();
  // Between what they're placed by and the panel, in px.
  const gap = 4;

  /**
   * Opens them by an element, e.g. the ⋯ they're chosen from, under it or
   * over it where there's no room below, with focus on the Input recorded
   * from.
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
    (panel.querySelector<HTMLElement>('input[type="radio"]:checked') ?? panel).focus();
  }

  function place() {
    if (panel && anchor) placeBeside(panel, anchor, gap, 'end');
  }

  // Placed again as they grow or shrink, e.g. as a row opens with its level meter.
  $effect(() => {
    if (!panel) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(panel);
    return () => observer.disconnect();
  });

  // Closing them closes the Input metered, as the list goes.
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
    <InputList
      onCalibrate={(input, exact) => {
        hide(false);
        onCalibrate(input, exact);
      }}
    />
  </div>
{/if}

<style>
  .panel {
    width: min(22rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: var(--space-4);
  }
</style>
