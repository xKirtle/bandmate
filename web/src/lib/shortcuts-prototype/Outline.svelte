<script lang="ts">
  // PROTOTYPE, throwaway: a VitePress-like "On this page": every card's
  // title and its subtitles, the one you're in highlighted. Read from the
  // page's own headings, so it follows whatever cards show.
  import { untrack } from 'svelte';

  let { root }: { root: () => HTMLElement | undefined } = $props();

  type Item = { id: string; text: string; level: 2 | 3 };
  let items = $state<Item[]>([]);
  let current = $state<string | null>(null);

  function read() {
    const el = root();
    if (!el) return;
    items = [...el.querySelectorAll<HTMLElement>('h2[id], h3[id]')].map((h) => ({
      id: h.id,
      text: h.textContent?.trim() ?? '',
      level: h.tagName === 'H2' ? 2 : 3,
    }));
    track();
  }

  function track() {
    let at: string | null = items[0]?.id ?? null;
    for (const item of items) {
      const h = document.getElementById(item.id);
      if (h && h.getBoundingClientRect().top < window.innerHeight * 0.3) at = item.id;
    }
    current = at;
  }

  function go(e: MouseEvent, id: string) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $effect(() => {
    const el = root();
    if (!el) return;
    untrack(read);
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  });
</script>

<svelte:window onscrollcapture={track} onresize={track} />

<nav class="outline" aria-label="On this page">
  <p>On this page</p>
  <ul>
    {#each items as item (item.id)}
      <li class:sub={item.level === 3}>
        <a href="#{item.id}" aria-current={current === item.id ? 'location' : undefined} onclick={(e) => go(e, item.id)}
          >{item.text}</a
        >
      </li>
    {/each}
  </ul>
</nav>

<style>
  .outline {
    position: sticky;
    top: var(--space-4);
    padding-left: var(--space-3);
    border-left: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  p {
    margin: 0 0 var(--space-2);
    font-weight: 600;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sub {
    padding-left: var(--space-3);
  }
  a {
    color: var(--text-muted);
    text-decoration: none;
  }
  a:hover {
    color: var(--text);
  }
  a[aria-current] {
    color: var(--accent);
    font-weight: 600;
  }
</style>
