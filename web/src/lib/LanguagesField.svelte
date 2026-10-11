<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { tick } from 'svelte';
  import { languageChoices, languagesLabel, moveLanguage, pickLanguage } from './languages';
  import { placeBeside } from './popover';

  // A Song's Languages in its Details: a field naming them, in order, that
  // opens a checklist of every Language Bandmate has data for, those picked
  // first, each with arrows to move it up or down the order. The last one
  // picked can't be unticked, as a Song is always sung in at least one. A
  // line under the list says why those are the only ones offered.
  let {
    id,
    labelledby,
    value,
    onchange,
  }: {
    id: string;
    /** The id of what names the field. */
    labelledby: string;
    /** The Song's Languages, in order. */
    value: readonly string[];
    /** Hears the Song's whole list of Languages, once one is ticked, unticked or moved. */
    onchange: (languages: string[]) => void;
  } = $props();

  const choices = $derived(languageChoices(value));
  const picked = $derived(choices.filter((c) => c.picked).length);

  let open = $state(false);
  let root: HTMLElement;
  let button: HTMLButtonElement;
  let panel = $state<HTMLElement>();
  // Between the field and the panel, in px.
  const gap = 4;

  async function show() {
    open = true;
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
  }

  // Under the field, or over it where there's no room below, lined up with
  // its start and kept inside the window.
  function place() {
    if (panel) placeBeside(panel, button, gap, 'start');
  }

  // The field grows or shrinks as the Languages change, so the panel follows it.
  $effect(() => {
    void value;
    if (open) tick().then(place);
  });

  function close() {
    open = false;
    button.focus();
  }

  // Moving a Language moves its row, so its arrow keeps focus where it went,
  // or takes the other arrow once it reaches an end.
  async function move(code: string, by: -1 | 1) {
    onchange(moveLanguage(value, code, by));
    await tick();
    const row = panel?.querySelector<HTMLElement>(`[data-language="${code}"]`);
    const arrows = row ? [...row.querySelectorAll<HTMLButtonElement>('.icon')] : [];
    (arrows.find((a) => a.dataset.by === String(by) && !a.disabled) ?? arrows.find((a) => !a.disabled))?.focus();
  }

  // Escape closes it, giving focus back to the field.
  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  // Focus moving elsewhere on the page, e.g. by Tab past its last box, closes
  // it too; the window losing focus doesn't.
  function onFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.contains(to)) open = false;
  }
</script>

<!-- Placed as it opens, and again as the window resizes; scrolling would leave it behind. -->
<svelte:window
  onpointerdowncapture={onWindowPointer}
  onresize={() => open && place()}
  onscroll={() => (open = false)}
/>

<div class="languages-field" bind:this={root} onfocusout={onFocusOut}>
  <button
    {id}
    type="button"
    class="trigger field-box"
    bind:this={button}
    aria-labelledby="{labelledby} {id}"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open ? close() : show())}
  >
    <span class="value">{languagesLabel(value)}</span>
    <span class="chevron" aria-hidden="true"><ChevronDown /></span>
  </button>
  {#if open}
    <div
      class="popover panel"
      role="dialog"
      aria-label="Languages"
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      <fieldset class="choice-group" aria-describedby="{id}-hint">
        <legend class="visually-hidden">Languages</legend>
        {#each choices as choice, i (choice.code)}
          <div class="row" data-language={choice.code}>
            <label class="choice-row">
              <input
                type="checkbox"
                checked={choice.picked}
                disabled={choice.picked && picked === 1}
                onchange={(e) => onchange(pickLanguage(value, choice.code, e.currentTarget.checked))}
              />
              <span class="name">{choice.name}</span>
            </label>
            {#if choice.picked && picked > 1}
              <button
                type="button"
                class="icon"
                data-by="-1"
                disabled={i === 0}
                aria-label="Move {choice.name} up"
                title="Move up"
                onclick={() => move(choice.code, -1)}><ArrowUp /></button
              >
              <button
                type="button"
                class="icon"
                data-by="1"
                disabled={i === picked - 1}
                aria-label="Move {choice.name} down"
                title="Move down"
                onclick={() => move(choice.code, 1)}><ArrowDown /></button
              >
            {/if}
          </div>
        {/each}
      </fieldset>
      <p id="{id}-hint" class="hint muted">
        Bandmate counts syllables and suggests rhymes in these languages, so only they can be picked for now.
      </p>
    </div>
  {/if}
</div>

<style>
  .languages-field {
    display: flex;
    min-width: 0;
  }
  /* Looks like the other Details' fields (.field-box), as a Picker does. */
  .trigger {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--control);
    cursor: pointer;
  }
  /* Several Languages are cut short rather than overflowing a phone. */
  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    display: inline-flex;
    color: var(--text-muted);
  }
  .panel {
    max-width: calc(100vw - 2rem);
    padding: var(--space-2) var(--space-3);
    /* Not the Details' smaller labels. */
    font-size: var(--text-lg);
  }
  .panel:focus {
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .row .choice-row {
    flex: 1;
    min-width: 0;
    padding-inline-end: var(--space-2);
  }
  /* Wraps under the list rather than widening the panel. */
  .hint {
    max-width: 16rem;
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
