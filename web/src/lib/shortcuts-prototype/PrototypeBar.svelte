<script lang="ts">
  // PROTOTYPE, throwaway: the floating bar to flip variants (‹ ›, or the arrow
  // keys). Only in dev builds (see ThisDevice.svelte).
  import { replaceSearch, router } from '../router.svelte';
  import { resetAll, simulateNewShortcut } from './engine.svelte';

  const variants = [
    { key: 'current', name: 'Today (unchanged)' },
    { key: 'A', name: 'Card on This device + outline' },
    { key: 'B', name: 'Own Shortcuts tab · accordion' },
    { key: 'C', name: 'Edit in the shortcuts dialog' },
  ];

  const current = $derived(new URLSearchParams(router.search).get('variant') ?? 'current');
  const index = $derived(
    Math.max(
      0,
      variants.findIndex((v) => v.key === current),
    ),
  );

  function go(step: number) {
    const params = new URLSearchParams(router.search);
    params.set('variant', variants[(index + step + variants.length) % variants.length].key);
    params.delete('tab');
    replaceSearch(params);
  }

  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }
</script>

<svelte:window {onkeydown} />

<div class="proto" role="toolbar" aria-label="Prototype controls">
  <div class="row">
    <button type="button" onclick={() => go(-1)} aria-label="Previous variant">‹</button>
    <strong>{variants[index].key === 'current' ? 'Today' : variants[index].key}</strong>
    <span>{variants[index].name}</span>
    <button type="button" onclick={() => go(1)} aria-label="Next variant">›</button>
  </div>
  {#if current !== 'current'}
    <div class="row small">
      <button type="button" onclick={simulateNewShortcut}>Simulate a new Shortcut whose key is taken</button>
      <button type="button" onclick={resetAll}>Reset</button>
      <a href="/">Open a Song to try the dialog</a>
    </div>
  {/if}
</div>

<style>
  /* Deliberately not the app's look: it isn't part of the design. */
  .proto {
    position: fixed;
    bottom: var(--space-3);
    left: 50%;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: calc(100vw - 1rem);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--text);
    color: var(--bg);
    box-shadow: var(--shadow-float);
    font-size: var(--text-sm);
    transform: translateX(-50%);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
  .small {
    font-size: var(--text-xs);
  }
  a {
    color: inherit;
  }
  button {
    padding: 0 var(--space-2);
    border: 1px solid currentcolor;
    border-radius: var(--radius-full);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
</style>
