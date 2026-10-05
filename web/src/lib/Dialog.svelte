<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { onMount, type Snippet } from 'svelte';
  import type { HTMLDialogAttributes } from 'svelte/elements';
  import { closeOnBackdrop } from './backdrop';

  // A modal dialog: opened as it mounts, over a scrim, with its title and a
  // close button at its head, and what it holds stacked beneath (see
  // docs/design.md, Components). Its size comes from custom properties the
  // caller sets, e.g. `<Dialog --dialog-width="36rem">`: --dialog-width,
  // --dialog-max-height, --dialog-height and --dialog-gap.
  let {
    title,
    detail,
    closeButton = 'shown',
    dismissible,
    sheet = false,
    stack = true,
    dialog = $bindable(),
    children,
    ...rest
  }: {
    title: string;
    /** Under the title, e.g. a Beat's credit. */
    detail?: Snippet;
    /** The close button: shown, shown but disabled while closing would lose work, or hidden. */
    closeButton?: 'shown' | 'disabled' | 'hidden';
    /** Whether a click on the backdrop closes it now, as Esc does; left out, it never does. */
    dismissible?: () => boolean;
    /** On a phone, it takes the whole screen. */
    sheet?: boolean;
    /** Spaces what it holds evenly, as a column; off, it flows as written. */
    stack?: boolean;
    /** The dialog element, to close it. */
    dialog?: HTMLDialogElement;
    children: Snippet;
  } & Omit<HTMLDialogAttributes, 'title' | 'children'> = $props();

  const id = $props.id();

  onMount(() => dialog?.showModal());
</script>

<dialog
  bind:this={dialog}
  {@attach (el) => (dismissible ? closeOnBackdrop(dismissible)(el) : undefined)}
  class:sheet
  aria-labelledby="{id}-title"
  {...rest}
>
  <header>
    <div class="title">
      <h2 id="{id}-title">{title}</h2>
      {@render detail?.()}
    </div>
    {#if closeButton !== 'hidden'}
      <button
        type="button"
        class="icon"
        onclick={() => dialog?.close()}
        disabled={closeButton === 'disabled'}
        aria-label="Close"><X /></button
      >
    {/if}
  </header>
  <div class="body" class:stack>
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    width: min(var(--dialog-width, 28rem), calc(100vw - 2rem));
    height: var(--dialog-height, fit-content);
    max-height: var(--dialog-max-height, calc(100dvh - 2rem));
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--text);
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  /* Focused itself only to hold focus for what it holds, e.g. a list that
     Space and the arrows scroll. */
  dialog:focus-visible {
    outline: none;
  }
  /* A phone gives the whole screen to a sheet, clear of the notch and home
     indicator. */
  @media (width < 40rem) {
    .sheet {
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      margin: 0;
      padding: max(var(--space-4), env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right))
        max(var(--space-4), env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
      border: none;
      border-radius: 0;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--dialog-gap, var(--space-3));
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-xl);
    overflow-wrap: anywhere;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--dialog-gap, var(--space-3));
  }
</style>
