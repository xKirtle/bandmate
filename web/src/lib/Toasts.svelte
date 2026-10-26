<!--
  The toast stack: every save the Song page was refused, one toast per
  surface, so four at most (ADR 0029), and, there and on the Chord Finder's
  page, the Instrument a Chord couldn't be heard on, its samples not loading
  (ADR 0030). A toast is labelled with where it came from, the surface the
  edit was made on or the Instrument — the error is no longer beside its
  cause, so the label does the work proximity used to — and never with a
  Clip, since one edit can cover several.

  It's never on a timer: it stays until what it's about is put right, that
  surface's own next save landing, which Saves clears it on, or the
  Instrument's samples loading, or until its dismiss is pressed, because it
  may be the only record that an edit was taken back.
-->
<script lang="ts" module>
  /** One toast: what it's labelled with, what it says, and how it's dismissed. */
  export interface Toast {
    /** Where it came from: a surface of the Song page, or an Instrument. Names its dismiss too, so several at once are told apart. */
    label: string;
    message: string;
    dismiss: () => void;
  }
</script>

<script lang="ts">
  import X from '@lucide/svelte/icons/x';

  let {
    toasts,
    dock = 0,
    height = $bindable(0),
  }: {
    /** The toasts, the latest last. */
    toasts: readonly Toast[];
    /** How much of the foot of the window the docked Timeline takes, which the stack stays clear of. */
    dock?: number;
    /** How tall the stack is, 0 while it's empty, for what floats above it to stay clear of, as Auto-scroll's pill does. */
    height?: number;
  } = $props();

  $effect(() => {
    if (toasts.length === 0) height = 0;
  });

  /**
   * Keeps the end of the stack in view as a toast comes or goes: the latest
   * is last, and once the stack is taller than its bound it's the one that
   * would be scrolled out of sight.
   */
  const showingLatest = (stack: HTMLElement) => {
    void toasts.length;
    stack.scrollTop = stack.scrollHeight;
  };
</script>

{#if toasts.length > 0}
  <div class="stack" style:--dock="{dock}px" bind:offsetHeight={height} {@attach showingLatest}>
    <!-- The latest is last, so it's nearest the corner. -->
    {#each toasts as { label, message, dismiss } (label)}
      <div class="toast" role="alert">
        <span class="label">{label}</span>
        <p class="error message">{message}</p>
        <!-- Named by its label, so several at once are told apart. -->
        <button type="button" class="dismiss" aria-label="Dismiss the {label} error" title="Dismiss" onclick={dismiss}
          ><X /></button
        >
      </div>
    {/each}
  </div>
{/if}

<style>
  /*
   * Fixed in the bottom corner of the window, clear of the docked Timeline
   * and the navigation, and floating rather than in the page's flow, so no
   * error ever reflows the fields or an open option list under it.
   */
  .stack {
    position: fixed;
    right: max(var(--gutter), env(safe-area-inset-right));
    bottom: calc(var(--nav-bottom-space) + var(--dock) + var(--space-4));
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    /* Bounded, so four at once scroll here rather than marching up the page. */
    max-height: 40vh;
    width: min(26rem, calc(100vw - 2 * var(--gutter)));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .toast {
    display: flex;
    flex-shrink: 0;
    gap: var(--space-2);
    align-items: baseline;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--shadow-float);
    font-size: var(--text-sm);
    animation: toast-in var(--duration-base) var(--ease);
  }
  /* Appearing is the only thing a toast animates. */
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
  }
  .label {
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .message {
    flex: 1;
    min-width: 0;
  }
  .dismiss {
    flex-shrink: 0;
    align-self: center;
    padding: 0 var(--space-1);
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  /* On a phone held sideways, the Timeline fills the window over the page
     (app.css), so there's nothing to stay clear of: the stack keeps the
     corner, over it, rather than being pushed past the top of the window. */
  @media (orientation: landscape) and (height < 30rem) {
    .stack {
      bottom: calc(var(--nav-bottom-space) + var(--space-4));
    }
  }
  /* A toast is about the page, not on it: it never prints. */
  @media print {
    .stack {
      display: none;
    }
  }
</style>
