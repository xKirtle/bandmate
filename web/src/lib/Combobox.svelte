<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { tick } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { comboboxKey, filterOptions, optionIndex } from './combobox';
  import { placeUnder, revealSelected } from './popover';

  let {
    id,
    value = $bindable(''),
    options,
    saved,
    onpick,
    onrevert,
    oninput,
    onblur,
    onkeydown,
    onclick,
    ...rest
  }: Omit<HTMLInputAttributes, 'value'> & {
    id: string;
    value?: string;
    /** Suggested, never enforced: any text is a valid value. */
    options: readonly string[];
    /** The value as saved: ✓-marked in the list, and what a second Escape goes back to. */
    saved: string;
    /** An option was picked: `value` is it now. */
    onpick?: (value: string) => void;
    /** Escape took back what was typed: `value` is `saved` again. */
    onrevert?: () => void;
  } = $props();

  let open = $state(false);
  // What was typed to filter the options by; null until something is.
  let query = $state<string | null>(null);
  let active = $state(-1);
  const shown = $derived(filterOptions(options, query));
  const savedAt = $derived(optionIndex(shown, saved));
  let input: HTMLInputElement;
  let list = $state<HTMLElement>();
  // Between the field and the list, in px.
  const gap = 4;

  async function show() {
    if (!options.length) return;
    query = null;
    active = optionIndex(options, value);
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

  // In the top layer, so no card or bar hides it; placed under the field, or
  // over it when there's no room below.
  function place() {
    if (list) placeUnder(list, input, gap);
  }

  function reveal() {
    if (list) revealSelected(list);
  }

  function pick(option: string) {
    value = option;
    close();
    onpick?.(option);
  }

  async function onFieldInput(e: Event & { currentTarget: HTMLInputElement }) {
    oninput?.(e as Parameters<NonNullable<typeof oninput>>[0]);
    query = value;
    active = -1;
    const wasOpen = open;
    // Nothing matching closes it: free text is fine too.
    open = shown.length > 0;
    await tick();
    if (!open) return;
    if (!wasOpen) list?.showPopover();
    place();
  }

  async function onFieldKey(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    onkeydown?.(e);
    const action = comboboxKey(e.key, e.altKey, { open, active, count: shown.length });
    // With nothing to take back, Escape is left to whatever else handles it.
    if (!action || (action.kind === 'revert' && value === saved)) return;
    // Enter with nothing highlighted goes on to save the typed text.
    if (!(e.key === 'Enter' && action.kind === 'close')) e.preventDefault();
    e.stopPropagation();
    switch (action.kind) {
      case 'open':
        show();
        break;
      case 'close':
        close();
        break;
      case 'revert':
        value = saved;
        onrevert?.();
        break;
      case 'highlight':
        active = action.index;
        await tick();
        reveal();
        break;
      case 'pick':
        pick(shown[action.index]);
        break;
    }
  }

  function toggle() {
    input.focus();
    if (open) close();
    else show();
  }
</script>

<!-- Placed again as the page scrolls or resizes, so it stays with the field. -->
<svelte:window onresize={() => open && place()} />
<svelte:document onscrollcapture={() => open && place()} />

<div class="combobox">
  <input
    {...rest}
    {id}
    bind:this={input}
    bind:value
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    oninput={onFieldInput}
    onkeydown={onFieldKey}
    onclick={(e) => {
      onclick?.(e);
      if (!open) show();
    }}
    onblur={(e) => {
      close();
      onblur?.(e);
    }}
  />
  <!-- The keyboard opens the list from the field, so this is for pointers only. -->
  <button
    type="button"
    class="chevron"
    tabindex="-1"
    aria-label="Suggestions"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    onmousedown={(e) => e.preventDefault()}
    onclick={toggle}
  >
    <ChevronDown />
  </button>
  {#if open}
    <!-- Pressing an option keeps focus in the field. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="popover option-list"
      id="{id}-list"
      role="listbox"
      tabindex="-1"
      popover="manual"
      bind:this={list}
      onmousedown={(e) => e.preventDefault()}
    >
      {#each shown as option, i (option)}
        <!-- The field takes the keyboard, through aria-activedescendant. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          id="{id}-option-{i}"
          class="option-list-item"
          role="option"
          tabindex="-1"
          aria-selected={i === active}
          onclick={() => pick(option)}
        >
          <span class="option-list-check" aria-hidden="true"
            >{#if i === savedAt}<Check />{/if}</span
          >
          {option}
          {#if i === savedAt}<span class="visually-hidden">(saved)</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .combobox {
    --end: var(--combobox-end, 1.75rem);
    position: relative;
    display: flex;
    min-width: 0;
  }
  input {
    padding-inline-end: var(--end);
  }
  .chevron {
    position: absolute;
    inset-block: 0;
    right: 0;
    width: var(--end);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    opacity: 0;
  }
  /* At rest the field is just its text; ▾ shows when it's in use. Touch
     screens have no hover, so there only focus shows it. */
  .combobox:focus-within .chevron {
    opacity: 1;
  }
  @media (hover: hover) {
    .combobox:hover .chevron {
      opacity: 1;
    }
  }
</style>
