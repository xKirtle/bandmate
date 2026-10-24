<script lang="ts">
  // PROTOTYPE, throw away: cycles `?variant=` with its arrows or ← and →,
  // keeping the variant in the URL so it survives a reload.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  let {
    variants,
    current,
    onchange,
  }: { variants: Record<string, string>; current: string; onchange: (v: string) => void } = $props();

  const keys = $derived(Object.keys(variants));

  function go(by: number) {
    const next = keys[(keys.indexOf(current) + by + keys.length) % keys.length];
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(history.state, '', url);
    onchange(next);
  }
  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="switcher">
  <button type="button" aria-label="Previous variant" onclick={() => go(-1)}><ChevronLeft /></button>
  <span>{current} ({variants[current]})</span>
  <button type="button" aria-label="Next variant" onclick={() => go(1)}><ChevronRight /></button>
</div>

<style>
  .switcher {
    position: fixed;
    z-index: 30;
    bottom: var(--space-4);
    left: 50%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--text);
    color: var(--bg);
    font-size: var(--text-sm);
    transform: translateX(-50%);
    box-shadow: var(--shadow-float);
  }

  button {
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: inherit;
    font-size: var(--text-lg);
  }
</style>
