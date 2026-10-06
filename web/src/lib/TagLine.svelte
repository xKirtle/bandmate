<script lang="ts">
  import { fitTags } from './tagLine';

  // A Song's Tags on one line, as many as fit, then a "+N" badge whose
  // tooltip names the rest: shown, never changed here.
  let { tags }: { tags: readonly string[] } = $props();

  let line = $state<HTMLElement>();
  // Every badge drawn out of sight, to measure what fits.
  let probe = $state<HTMLElement>();
  let room = $state(0);
  let shown = $state(0);
  // Whether the first Tag is cut short for want of room.
  let cut = $state(false);

  const rest = $derived(tags.slice(shown));

  $effect(() => {
    if (!line) return;
    const observer = new ResizeObserver(([entry]) => (room = entry.contentRect.width));
    observer.observe(line);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!probe) return;
    void tags;
    const badges = [...probe.children].map((badge) => badge.getBoundingClientRect().width);
    const more = badges.pop() ?? 0;
    const gap = parseFloat(getComputedStyle(probe).columnGap) || 0;
    shown = fitTags({ widths: badges, room, gap, more });
    cut = badges[0] + (shown < badges.length ? gap + more : 0) > room;
  });
</script>

<div class="tag-line">
  <ul class="tags" aria-label="Tags" bind:this={line}>
    {#each tags.slice(0, shown || tags.length) as name, i (name)}
      <li class="badge tag" title={i === 0 && cut ? name : undefined}>{name}</li>
    {/each}
    {#if shown > 0 && rest.length > 0}
      <li class="badge tag more" title={rest.join(', ')}>
        <span aria-hidden="true">+{rest.length}</span><span class="visually-hidden">and {rest.join(', ')}</span>
      </li>
    {/if}
  </ul>
  <ul class="tags probe" aria-hidden="true" bind:this={probe}>
    {#each tags as name (name)}
      <li class="badge tag">{name}</li>
    {/each}
    <li class="badge tag more">+{tags.length - 1}</li>
  </ul>
</div>

<style>
  .tag-line {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }
  .tags {
    display: flex;
    gap: var(--space-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* The first Tag gives way, cut short, so "+N" always shows. */
  .tags > li {
    flex-shrink: 0;
  }
  .tags > li:first-child {
    flex-shrink: 1;
    min-width: 0;
  }
  .more {
    font-variant-numeric: tabular-nums;
  }
  .probe {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
    visibility: hidden;
    pointer-events: none;
  }
  .probe > li {
    flex-shrink: 0;
  }
</style>
