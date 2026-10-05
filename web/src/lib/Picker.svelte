<script lang="ts" generics="T">
  import { tick, type Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { pickerKey, typeaheadIndex } from './picker';
  import { placeUnder, revealSelected } from './popover';

  // Picks a value from a list it draws itself, in place of a native select,
  // whose OS-drawn list looks nothing like the app. Follows the ARIA
  // select-only combobox: focus stays on the trigger throughout.
  let {
    id,
    options,
    value,
    text = String,
    onpick,
    trigger,
    option,
    class: className,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'children'> & {
    id: string;
    options: readonly T[];
    /** The option picked now: shown by the trigger, ✓-marked in the list. */
    value: T;
    /** An option's text, which typing jumps by, and drawn unless `option` is given. */
    text?: (option: T) => string;
    onpick: (option: T) => void;
    /** Draws the closed picker, in place of a field showing the value and ▾. */
    trigger?: Snippet<[T]>;
    /** Draws an option in the list, in place of its label. */
    option?: Snippet<[T]>;
  } = $props();

  let open = $state(false);
  let active = $state(-1);
  const current = $derived(options.indexOf(value));
  let field: HTMLElement;
  let list = $state<HTMLElement>();
  // Between the trigger and the list, in px.
  const gap = 4;
  // What's been typed to jump to an option, until a pause.
  let typed = '';
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  async function show(index = current >= 0 ? current : 0) {
    if (!options.length) return;
    active = index;
    open = true;
    await tick();
    list?.showPopover();
    place();
    reveal();
  }

  function close() {
    open = false;
    active = -1;
  }

  function toggle() {
    if (open) close();
    else show();
  }

  // In the top layer, so no card or bar hides it.
  function place() {
    if (list) placeUnder(list, field, gap);
  }

  function reveal() {
    if (list) revealSelected(list);
  }

  function pick(index: number) {
    close();
    if (index !== current) onpick(options[index]);
  }

  async function highlight(index: number) {
    active = index;
    await tick();
    reveal();
  }

  // A letter jumps to the option starting with it: highlighted when the list
  // is open, picked when it's closed.
  function typeAhead(key: string) {
    clearTimeout(typedTimer);
    typed += key;
    typedTimer = setTimeout(() => (typed = ''), 500);
    const at = typeaheadIndex(options.map(text), typed, open ? active : current);
    if (at < 0) return;
    if (open) highlight(at);
    else if (at !== current) onpick(options[at]);
  }

  function onKey(e: KeyboardEvent) {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Space goes on what's being typed, e.g. "Mike D", once typing has begun.
    if (printable && (e.key !== ' ' || typed)) {
      e.preventDefault();
      typeAhead(e.key);
      return;
    }
    const action = pickerKey(e.key, e.altKey, { open, active, count: options.length });
    if (!action) return;
    // Tab picks and still moves focus on.
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
    switch (action.kind) {
      case 'open':
        show(action.index);
        break;
      case 'close':
        close();
        break;
      case 'highlight':
        highlight(action.index);
        break;
      case 'pick':
        pick(action.index);
        break;
    }
  }
</script>

<!-- Placed again as the page scrolls or resizes, so it stays with the trigger. -->
<svelte:window onresize={() => open && place()} />
<svelte:document onscrollcapture={() => open && place()} />

<div class={['picker', className]}>
  <div
    {...rest}
    {id}
    bind:this={field}
    class={['trigger', trigger ? 'custom' : 'field']}
    role="combobox"
    tabindex="0"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    onkeydown={onKey}
    onclick={toggle}
    onblur={close}
  >
    {#if trigger}
      {@render trigger(value)}
    {:else}
      <span class="value">{current >= 0 ? text(value) : ''}</span>
      <span class="chevron" aria-hidden="true">▾</span>
    {/if}
  </div>
  {#if open}
    <!-- Pressing an option keeps focus on the trigger. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="option-list"
      id="{id}-list"
      role="listbox"
      tabindex="-1"
      popover="manual"
      bind:this={list}
      onmousedown={(e) => e.preventDefault()}
    >
      {#each options as o, i (i)}
        <!-- The trigger takes the keyboard, through aria-activedescendant. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id="{id}-option-{i}"
          class="option-list-item"
          role="option"
          tabindex="-1"
          aria-selected={i === active}
          onclick={() => pick(i)}
        >
          <span class="option-list-check" aria-hidden="true">{i === current ? '✓' : ''}</span>
          {#if option}{@render option(o)}{:else}{text(o)}{/if}
          {#if i === current}<span class="visually-hidden">(current)</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    min-width: 0;
  }
  .trigger {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: var(--control);
    cursor: pointer;
    user-select: none;
  }
  /* Looks like the other fields. */
  .field {
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    /* Matches the fields' size, which keeps iOS from zooming on theirs. */
    font-size: var(--text-field);
    font-weight: 400;
  }
  .value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    color: var(--text-muted);
  }
  /* Not the look of whatever it sits in, e.g. a filter's label. */
  .option-list {
    font-size: var(--text-lg);
    font-weight: 400;
  }
  .trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* A caller's trigger may look smaller than its tap target, e.g. a pill:
     the focus ring goes round what it draws. */
  .custom:focus-visible {
    outline: none;
  }
  .custom:focus-visible > :global(*) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
