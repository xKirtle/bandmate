<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { fieldStep, menuKey, type MenuAction, type MenuChoice, type MenuField } from './menu';
  import { popoverLeft, popoverTop } from './popover';

  let {
    entries,
    label = 'More actions',
    text,
    trigger,
    align = 'end',
    disabled = false,
  }: {
    /** What it offers: actions, or, for a menu that's a list to pick from, just the choices. */
    entries: (MenuAction | MenuChoice)[];
    /** Names the trigger to screen readers, e.g. to tell apart several on one page. */
    label?: string;
    /** What the trigger says, as a button, in place of ⋯, e.g. "Put back…". */
    text?: string;
    /** What opens the menu, in place of ⋯, e.g. the Cover. */
    trigger?: Snippet;
    /** Which of the trigger's edges the menu lines up with: its end, or, near the page's start, its start. */
    align?: 'start' | 'end';
    /** Keeps the menu from opening, e.g. while what it acts on is busy. */
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  // The entry whose choices, or field, the menu shows in place of the entries, if any.
  let picking = $state<(MenuAction & ({ choices: MenuChoice[] } | { field: MenuField })) | null>(null);
  // The field shown, as it is in the entries now, since setting it changes them.
  const field = $derived.by(() => {
    if (!picking || !('field' in picking)) return null;
    const label = picking.label;
    const now = entries.find((e): e is MenuAction & { field: MenuField } => 'field' in e && e.label === label);
    return (now ?? picking).field;
  });
  // What's typed in the field, null while it's empty, following what it's
  // set to.
  const fieldValue = $derived(field?.value);
  let draft = $state<number | null>(0);
  $effect(() => {
    if (fieldValue !== undefined) draft = fieldValue;
  });
  let input = $state<HTMLInputElement>();
  let root: HTMLElement;
  let triggerButton: HTMLButtonElement;
  let menu = $state<HTMLElement>();
  // Between the trigger and the menu, in px.
  const gap = 4;

  function items(): HTMLElement[] {
    return menu ? [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')] : [];
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

  // Under ⋯, or over it when there's no room below, and inside the window:
  // again as what it shows changes size.
  function place() {
    if (!menu) return;
    const at = triggerButton.getBoundingClientRect();
    // Measured at the window's left, where nothing squeezes it.
    menu.style.left = '0px';
    const { width, height } = menu.getBoundingClientRect();
    menu.style.top = `${popoverTop(at, height, window.innerHeight, gap)}px`;
    menu.style.left = `${popoverLeft(at, width, document.documentElement.clientWidth, gap, align)}px`;
  }

  /** Opens it from elsewhere, e.g. right-clicking what it acts on; it's placed by its trigger all the same. */
  export function openMenu() {
    if (!open && !disabled) show();
  }

  function close() {
    open = false;
    triggerButton.focus();
  }

  function choose(entry: MenuAction | MenuChoice) {
    if ('choices' in entry || 'field' in entry) {
      pick(entry);
      return;
    }
    close();
    entry.run();
  }

  // Shows an entry's choices, with focus on the first, or its field, with
  // focus in it, or the entries again.
  async function pick(entry: typeof picking) {
    picking = entry;
    await tick();
    place();
    if (input) {
      input.focus();
      input.select();
    } else items()[0]?.focus();
  }

  function setField(value: number | null) {
    if (!field || value === null || !Number.isFinite(value)) return;
    draft = value;
    if (value !== field.value) field.set(value);
  }

  // The field keeps its keys, but for Escape and Tab, which leave the menu.
  function onFieldKey(e: KeyboardEvent) {
    if (!field) return;
    if (e.key === 'Escape' || e.key === 'Tab') return;
    e.stopPropagation();
    const stepped = fieldStep(e, draft ?? field.value, field);
    if (stepped !== null) {
      e.preventDefault();
      setField(stepped);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setField(draft);
    }
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

  // A tap outside closes it, leaving focus to wherever the tap puts it. It's
  // caught on the way down, since some of what's tapped, e.g. a Clip, stops
  // it going further.
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
  onpointerdowncapture={onWindowPointer}
  onscroll={dismiss}
  onresize={dismiss}
/>

<div class="menu-root" bind:this={root}>
  <button
    type="button"
    class={trigger ? 'bare' : text ? 'button' : 'icon'}
    bind:this={triggerButton}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    {disabled}
    onclick={() => (open ? close() : show())}
    onkeydown={onTriggerKey}
  >
    {#if trigger}{@render trigger()}{:else if text}{text}{:else}⋯{/if}
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
        {#if field}
          <label class="field" title="Alt+← and Alt+→ step it by {field.step} {field.unit}, or {field.shiftStep} with Shift">
            <input
              type="number"
              step={field.step}
              bind:value={draft}
              bind:this={input}
              onkeydown={onFieldKey}
              onchange={() => setField(draft)}
            />
            {field.unit}
          </label>
        {/if}
        {#each 'choices' in picking ? picking.choices : [] as choice, i (i)}
          <button
            type="button"
            role={choice.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={choice.checked}
            tabindex="-1"
            class="choice"
            onclick={() => choose(choice)}
          >
            {#if choice.checked}<span class="check" aria-hidden="true">✓</span>{/if}
            {choice.label}
          </button>
        {/each}
      {:else}
        <!-- By place: a list of Sections can name two alike. -->
        {#each entries as entry, i (i)}
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            aria-haspopup={'choices' in entry ? 'menu' : undefined}
            onclick={() => choose(entry)}
          >
            {#if 'icon' in entry}
              <span class="glyph" aria-hidden="true">{entry.icon}</span>
            {/if}
            {entry.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .bare {
    display: block;
    padding: 0;
    border: 0;
    border-radius: var(--trigger-radius, 0.5rem);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
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
  [role^='menuitem'] {
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
  [role^='menuitem']:hover,
  [role^='menuitem']:focus-visible {
    background: var(--surface-2);
  }
  /* A choice sits under the entry it's for, past where the glyphs line up. */
  .choice {
    padding-inline-start: 2.75rem;
  }
  /* The choice that's on is ticked in the glyphs' column. */
  .choice:has(.check) {
    padding-inline-start: 0.75rem;
  }
  .check {
    width: 1.25rem;
    text-align: center;
  }
  /* A field sits under the entry it's for, like a choice. */
  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    padding: 0 0.75rem 0 2.75rem;
    color: var(--text-muted);
  }
  .field input {
    width: 6rem;
  }
  .glyph {
    width: 1.25rem;
    color: var(--text-muted);
    text-align: center;
  }
</style>
