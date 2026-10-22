<!--
  The Song page's toast stack: every save it was refused, one toast per
  surface, so four at most (ADR 0029). A toast is labelled with the surface
  the edit was made on — the error is no longer beside its cause, so the
  label does the work proximity used to — and never with a Clip, since one
  edit can cover several.

  It's never on a timer: it stays until that surface's own next save lands,
  which Saves clears it on, or until its dismiss is pressed, because it may
  be the only record that an edit was taken back.
-->
<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { surfaceNames, type Saves } from './saves.svelte';

  let {
    saves,
    dock = 0,
  }: {
    saves: Saves;
    /** How much of the foot of the window the docked Timeline takes, which the stack stays clear of. */
    dock?: number;
  } = $props();
</script>

{#if saves.errors.length > 0}
  <div class="stack" style:--dock="{dock}px">
    <!-- The surface refused latest is last, so it's nearest the corner. -->
    {#each saves.errors as { surface, message } (surface)}
      <div class="toast" role="alert">
        <span class="surface">{surfaceNames[surface]}</span>
        <p class="error message">{message}</p>
        <!-- Named by its surface, so four at once are told apart. -->
        <button
          type="button"
          class="dismiss"
          aria-label="Dismiss the {surfaceNames[surface]} error"
          title="Dismiss"
          onclick={() => saves.dismiss(surface)}><X /></button
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
  .surface {
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
</style>
