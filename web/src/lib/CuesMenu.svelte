<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { tick } from 'svelte';
  import { deviceStorage } from './deviceStorage';
  import Picker from './Picker.svelte';
  import { placeBeside } from './popover';
  import { readShiftStep, shiftSteps, storeShiftStep, type ShiftStep } from './shiftStep';

  // What's done to every Cue at once, behind one button at the end of the
  // Lyric Sheet's header, apart from the modes beside it: shifting them all
  // by a step, and clearing them. It stays open while they're shifted, and
  // the step is remembered on this device.

  let {
    shift,
    clear,
    canShiftEarlier,
  }: {
    /** Shifts every Cue by the seconds given: later if positive. */
    shift: (by: number) => void;
    /** Clears every Cue. Doesn't ask first: it can be undone. */
    clear: () => void;
    /** Whether every Cue can be shifted the step given earlier, staying at or after 0:00. */
    canShiftEarlier: (step: number) => boolean;
  } = $props();

  let step = $state<ShiftStep>(readShiftStep(deviceStorage()));
  const earlier = $derived(canShiftEarlier(step));

  function chooseStep(chosen: ShiftStep) {
    step = chosen;
    storeShiftStep(deviceStorage(), chosen);
  }

  let open = $state(false);
  let root: HTMLElement;
  let button: HTMLButtonElement;
  let panel = $state<HTMLElement>();
  // Between the button and the panel, in px.
  const gap = 4;

  async function show() {
    open = true;
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')?.focus();
  }

  // Under the button, or over it where there's no room below, lined up with
  // its end, since it sits at the end of the header.
  function place() {
    if (panel) placeBeside(panel, button, gap, 'end');
  }

  function close() {
    open = false;
    button.focus();
  }

  // Escape closes it, giving focus back to the button; the step's list,
  // while open, takes Escape itself.
  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  // Focus moving elsewhere on the page, e.g. by Tab past its last button,
  // closes it too; the window losing focus doesn't.
  function onFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.contains(to)) open = false;
  }
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => open && place()} />

<div class="cues" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="button trigger"
    bind:this={button}
    aria-haspopup="dialog"
    aria-expanded={open}
    title="Shift or clear every Cue"
    onclick={() => (open ? close() : show())}>Cues <ChevronDown /></button
  >
  {#if open}
    <div
      class="popover panel"
      role="dialog"
      aria-label="Cues"
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      <span id="shift-label" class="name">Shift every Cue</span>
      <div class="controls" role="group" aria-labelledby="shift-label">
        <Picker
          id="shift-step"
          aria-label="Step"
          title="How far each click shifts every Cue"
          options={shiftSteps}
          value={step}
          text={(s) => `${s} s`}
          onpick={chooseStep}
        />
        <button
          type="button"
          class="button step"
          disabled={!earlier}
          onclick={() => shift(-step)}
          aria-label="Shift every Cue {step} s earlier"
          title={earlier ? `Shift every Cue ${step} s earlier` : `A Cue is closer to 0:00 than ${step} s`}
          ><Minus /></button
        >
        <button
          type="button"
          class="button step"
          onclick={() => shift(step)}
          aria-label="Shift every Cue {step} s later"
          title="Shift every Cue {step} s later"><Plus /></button
        >
      </div>
      <button type="button" class="button clear" onclick={clear} title="Clear every Cue in the Song"
        >Clear all Cues</button
      >
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  /* The shift's name and its controls on a row, then Clear all Cues under
     them, as wide as the row. */
  .panel {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    max-width: calc(100vw - 2rem);
    padding: var(--space-3) var(--space-4);
  }
  .panel:focus {
    outline: none;
  }
  .name {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-1);
  }
  .step {
    min-width: var(--control);
    padding: 0;
  }
  .clear {
    grid-column: 1 / -1;
  }
</style>
