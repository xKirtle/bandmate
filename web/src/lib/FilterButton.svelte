<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { tick, type Snippet } from 'svelte';
  import { placeBeside } from './popover';

  // A filter in a list page's filter bar: a pill naming the filter, and what's
  // picked in it, that opens what it's picked with, e.g. a checklist, under it.

  let {
    name,
    label,
    picked,
    children,
  }: {
    /** The filter's name, e.g. "Status", naming what opens to screen readers. */
    name: string;
    /** What the button says: the filter's name, and what's picked, e.g. "Status: Idea, Drafting". */
    label: string;
    /** Whether anything is picked, which fills the button as a toggle that's on. */
    picked: boolean;
    /** What it's picked with, e.g. a checklist. */
    children: Snippet;
  } = $props();

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
    panel.querySelector<HTMLElement>('input, button')?.focus();
  }

  // Under the button, or over it where there's no room below, lined up with
  // its start and kept inside the window.
  function place() {
    if (panel) placeBeside(panel, button, gap, 'start');
  }

  // The button grows or shrinks as what's picked changes, so it follows it.
  $effect(() => {
    void label;
    if (open) tick().then(place);
  });

  function close() {
    open = false;
    button.focus();
  }

  // Escape closes it, giving focus back to the button.
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

  // Focus moving elsewhere on the page, e.g. by Tab past its last box, closes
  // it too; the window losing focus doesn't.
  function onFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.contains(to)) open = false;
  }
</script>

<!-- Placed as it opens, and again as the window resizes; scrolling would leave it behind. -->
<svelte:window
  onpointerdowncapture={onWindowPointer}
  onresize={() => open && place()}
  onscroll={() => (open = false)}
/>

<div class="filter" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="chip"
    class:picked
    bind:this={button}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open ? close() : show())}
  >
    <span class="label">{label}</span>
    <ChevronDown />
  </button>
  {#if open}
    <div
      class="popover panel"
      role="dialog"
      aria-label={name}
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .filter {
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    padding-inline-end: var(--space-3);
  }
  /* A long pick is cut short rather than overflowing a phone. */
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip :global(.lucide-icon) {
    flex-shrink: 0;
  }
  .panel {
    max-width: calc(100vw - 2rem);
    padding: var(--space-2) var(--space-3);
  }
  .panel:focus {
    outline: none;
  }
</style>
