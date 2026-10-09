<script lang="ts">
  import Mic from '@lucide/svelte/icons/mic';
  import { onDestroy, tick } from 'svelte';
  import InputName from './InputName.svelte';
  import { InputRows } from './inputRows.svelte';
  import LevelMeter from './LevelMeter.svelte';
  import { placeBeside, type PopoverAlign } from './popover';

  // The Timeline's mic button, and the popover it opens to pick the Input
  // recorded from: every Input connected, the default input and each
  // channel of each device, with a radio on each, as in Settings. The one
  // picked meters its level, to check it's the right one. Setting Inputs up,
  // calibrating them, typing an offset or forgetting one, is left to
  // Settings. Folded into the transport row's ⋯, it has no button of its
  // own, and opens by the ⋯ instead.

  let {
    disabled = false,
    title,
    button: hasButton = true,
  }: {
    /** Keeps it from opening, and closes it, e.g. while recording. */
    disabled?: boolean;
    /** What the button says over it, e.g. why it's disabled. */
    title?: string;
    /** Whether it shows its button, or only opens with `openBy`. */
    button?: boolean;
  } = $props();

  const id = $props.id();
  const inputs = new InputRows();

  let open = $state(false);
  let root: HTMLElement;
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLElement>();
  // What it opened by, its button or the ⋯, which it's placed by, and
  // which takes focus back as it closes; and which of its edges it lines up with.
  let anchor: HTMLElement | undefined;
  let align: PopoverAlign = 'start';
  // Between the button and the panel, in px.
  const gap = 4;

  /** Opens it by `by`, e.g. the ⋯ it's folded into, lined up with its end. */
  export function openBy(by: HTMLElement) {
    void show(by, 'end');
  }

  async function show(by: HTMLElement | undefined = button, edge: PopoverAlign = 'start') {
    if (disabled || !by) return;
    anchor = by;
    align = edge;
    open = true;
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    (panel.querySelector<HTMLElement>('input[type="radio"]:checked') ?? panel).focus();
  }

  // Under what it opened by, or over it where there's no room below.
  function place() {
    if (panel && anchor) placeBeside(panel, anchor, gap, align);
  }

  // Placed again as it grows or shrinks, e.g. as the Input picked opens its level meter.
  $effect(() => {
    if (!panel) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(panel);
    return () => observer.disconnect();
  });

  // Closing it closes the Input metered, as the list goes.
  function hide(refocus = true) {
    if (!open) return;
    open = false;
    if (refocus) anchor?.focus();
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

  // Focus moving elsewhere on the page, e.g. by Tab past its last radio,
  // closes it too; the window losing focus doesn't.
  function onFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.contains(to)) hide(false);
  }

  $effect(() => {
    if (disabled) hide(false);
  });

  onDestroy(() => hide(false));
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => open && place()} />

<span class="input-picker" bind:this={root} onfocusout={onFocusOut}>
  {#if hasButton}
    <button
      type="button"
      class="icon"
      bind:this={button}
      {disabled}
      aria-label="Input to record from"
      aria-haspopup="dialog"
      aria-expanded={open}
      {title}
      onclick={() => (open ? hide() : show())}><Mic /></button
    >
  {/if}
  {#if open}
    <div
      class="popover panel"
      role="dialog"
      aria-label="Input to record from"
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      {#if inputs.chosenGone}
        <p class="notice" role="status">{inputs.chosenGone} isn't connected, so the default input is used.</p>
      {/if}
      <fieldset class="choice-group">
        <legend class="visually-hidden">Record from</legend>
        <ul aria-label="Inputs">
          {#each inputs.connected as row (row.key)}
            <li>
              <label class="choice-row">
                <input type="radio" name="{id}-record-from" checked={row.chosen} onchange={() => inputs.choose(row)} />
                <span class="name"><InputName name={row.name} channel={row.channel} is={row.is} /></span>
              </label>
              {#if row.chosen}
                <div class="meter">
                  <LevelMeter input={row.input} onOpen={(level) => inputs.learn(level)} />
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </fieldset>
      <p class="muted">Calibrate an Input's latency in Settings → Recording.</p>
    </div>
  {/if}
</span>

<style>
  .panel {
    width: min(22rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: var(--space-4);
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
  .choice-row {
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .meter {
    /* Lined up with the name, past the radio. */
    padding: 0 0 var(--space-3) calc(var(--checkbox) + var(--space-2));
  }
  fieldset {
    min-width: 0;
  }
  p {
    margin: 0;
    font-size: var(--text-md);
  }
  .notice {
    margin-bottom: var(--space-2);
    color: var(--warning);
  }
  .muted {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }
</style>
