<script lang="ts">
  import { tick } from 'svelte';
  import { menuKey, type MenuAction, type MenuChoice } from './menu';
  import { popoverTop } from './popover';

  let {
    entries,
    label = 'More actions',
  }: {
    entries: MenuAction[];
    /** Names ⋯ to screen readers, e.g. to tell apart several on one page. */
    label?: string;
  } = $props();

  let open = $state(false);
  // The entry whose choices the menu shows in place of the entries, if any.
  let picking = $state<(MenuAction & { choices: MenuChoice[] }) | null>(null);
  let root: HTMLElement;
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLElement>();
  // Between ⋯ and the menu, in px.
  const gap = 4;

  function items(): HTMLElement[] {
    return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
  }

  async function show(focus: 'first' | 'last' = 'first') {
    open = true;
    picking = null;
    await tick();
    if (!menu) return;
    // In the top layer, so no card or bar hides it; placed under ⋯, or over
    // it when there's no room below.
    menu.showPopover();
    place();
    const all = items();
    all[focus === 'first' ? 0 : all.length - 1]?.focus();
  }

  // Under ⋯, or over it when there's no room below: again as what it shows
  // changes height.
  function place() {
    if (!menu) return;
    const at = trigger.getBoundingClientRect();
    const { height } = menu.getBoundingClientRect();
    menu.style.top = `${popoverTop(at, height, window.innerHeight, gap)}px`;
    menu.style.right = `${document.documentElement.clientWidth - at.right}px`;
  }

  function close() {
    open = false;
    trigger.focus();
  }

  function choose(entry: MenuAction | MenuChoice) {
    if ('choices' in entry) {
      pick(entry);
      return;
    }
    close();
    entry.run();
  }

  // Shows an entry's choices, or the entries again, with focus on the first.
  async function pick(entry: (MenuAction & { choices: MenuChoice[] }) | null) {
    picking = entry;
    await tick();
    place();
    items()[0]?.focus();
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show(e.key === 'ArrowDown' ? 'first' : 'last');
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    const all = items();
    const next = menuKey(e.key, all.indexOf(document.activeElement as HTMLElement), all.length);
    if (next === null) return;
    // Tab closes and carries on from ⋯, so it lands on what follows it.
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
    if (next === 'close') close();
    else all[next].focus();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  // Closes it without losing focus with it.
  function dismiss() {
    if (!open) return;
    if (menu?.contains(document.activeElement)) close();
    else open = false;
  }
</script>

<!-- It's placed once, when it opens: scrolling or resizing would leave it behind. -->
<svelte:window
  onpointerdown={onWindowPointer}
  onscroll={dismiss}
  onresize={dismiss}
/>

<div class="menu-root" bind:this={root}>
  <button
    type="button"
    class="icon"
    bind:this={trigger}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open ? close() : show())}
    onkeydown={onTriggerKey}
  >
    ⋯
  </button>
  {#if open}
    <div
      class="menu"
      role="menu"
      aria-label={label}
      tabindex="-1"
      popover="manual"
      bind:this={menu}
      onkeydown={onMenuKey}
    >
      {#if picking}
        <button type="button" role="menuitem" tabindex="-1" onclick={() => pick(null)}>
          <span class="glyph" aria-hidden="true">‹</span>
          {picking.label}
        </button>
        {#each picking.choices as choice, i (i)}
          <button type="button" role="menuitem" tabindex="-1" class="choice" onclick={() => choose(choice)}>
            {choice.label}
          </button>
        {/each}
      {:else}
        {#each entries as entry (entry.label)}
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            aria-haspopup={'choices' in entry ? 'menu' : undefined}
            onclick={() => choose(entry)}
          >
            <span class="glyph" aria-hidden="true">{entry.icon}</span>
            {entry.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: fixed;
    inset: auto;
    display: flex;
    flex-direction: column;
    max-width: calc(100vw - 2rem);
    margin: 0;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg);
    box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--text) 18%, transparent);
  }
  [role='menuitem'] {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: var(--control);
    padding: 0 0.75rem;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  [role='menuitem']:hover,
  [role='menuitem']:focus-visible {
    background: var(--surface-2);
  }
  /* A choice sits under the entry it's for, past where the glyphs line up. */
  .choice {
    padding-inline-start: 2.75rem;
  }
  .glyph {
    width: 1.25rem;
    color: var(--text-muted);
    text-align: center;
  }
</style>
