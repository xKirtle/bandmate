<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import ActionsMenu from './ActionsMenu.svelte';
  import AlternateText, { type Cueing } from './AlternateText.svelte';
  import { api, suggestedLabels, type Alternate, type Section, type Song, type SongAt } from './api';
  import Combobox from './Combobox.svelte';
  import type { MenuAction } from './menu';
  import type { Drop } from './sectionDrag';
  import type { SectionDragging } from './sectionDragging.svelte';
  import { activeAlternate, alternateName, alternatesLabel, labelOf, type Place } from './sections';

  let {
    section,
    autofocus = false,
    change,
    onUnsaved,
    grip,
    actions,
    more,
    cueing,
    drag,
    places = [],
    onEditing,
  }: {
    section: Section;
    /** Focus the Label when this becomes true, e.g. for a Section just added. */
    autofocus?: boolean;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Tells the page whether this editor holds edits not yet saved. */
    onUnsaved: (editor: object, unsaved: boolean) => void;
    /** Given, shows first in the header, e.g. a handle to drag the Section by. */
    grip?: Snippet;
    /** The actions that always show. */
    actions: Snippet;
    /** The actions after them, folded into a ⋯ menu on phones. */
    more: MenuAction[];
    /** Given, the active Alternate's Lines are highlighted and cued as playback goes. */
    cueing?: Cueing;
    /** The drag of a Section, shared with the page: given, an inactive Alternate is dragged out by its card. */
    drag?: SectionDragging;
    /** Where in the Lyric Sheet an inactive Alternate can be moved to, as a Section of its own. */
    places?: Place[];
    /**
     * Hears the Section being changed, or its Alternates opening, e.g. to end
     * Sync mode. Saving its Lines' text isn't heard: Sync mode keeps them
     * read-only, but may come on while an edit typed before is still saving.
     */
    onEditing?: () => void;
  } = $props();

  // The server guarantees exactly one active Alternate.
  const active = $derived(activeAlternate(section)!);

  let label = $state(untrack(() => section.label));
  let editingLabel = false;
  // Identifies the Label or Alternate name being typed to onUnsaved. They
  // save on change, which comes just before blur.
  const naming = {};
  // In the Alternates mode, the Alternates show as cards to choose the active
  // one from, in place of its Lines. ⇄ opens and closes it.
  let choosing = $state(false);
  let toggle = $state<HTMLButtonElement>();

  $effect(() => {
    const l = section.label;
    if (!editingLabel) label = l;
  });

  function edit(op: (at: SongAt) => Promise<Song>): Promise<boolean> {
    onEditing?.();
    return change(op);
  }

  async function commitLabel() {
    editingLabel = false;
    const next = label.trim();
    if (next === section.label) {
      label = section.label;
      return;
    }
    if (!(await edit((at) => api.setSectionLabel(at, section.id, next)))) label = section.label;
  }

  async function addAlternate() {
    if (!(await edit((at) => api.addAlternate(at, section.id)))) return;
    // The copy is active now, as the last card: ready to be renamed.
    await tick();
    const name = document.getElementById(`name-${section.id}-${active.id}`);
    name?.focus();
    name?.scrollIntoView({ block: 'nearest' });
  }

  async function startChoosing() {
    onEditing?.();
    choosing = true;
    await tick();
    // Straight to the choice, where the arrow keys go through the Alternates.
    radio(active.id)?.focus();
  }

  function leaveChoosing() {
    // Focus goes first, so a name being typed is saved as its field blurs.
    toggle?.focus();
    choosing = false;
  }

  function onChoosingKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    leaveChoosing();
  }

  async function rename(alt: Alternate, e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const next = input.value.trim();
    if (next === alt.name) {
      input.value = alt.name;
      return;
    }
    if (!(await edit((at) => api.renameAlternate(at, alt.id, next)))) input.value = alt.name;
  }

  async function choose(alt: Alternate) {
    if (alt.active) return;
    const previous = active.id;
    if (await edit((at) => api.activateAlternate(at, alt.id))) return;
    // Put the choice back as the server has it.
    const picked = radio(alt.id);
    const kept = radio(previous);
    if (picked) picked.checked = false;
    if (kept) kept.checked = true;
  }

  function radio(altId: number) {
    return document.getElementById(`pick-${section.id}-${altId}`) as HTMLInputElement | null;
  }

  /** A click anywhere on a card chooses it, but typing its name, opening its ⋯ or dragging it by its grip doesn't. */
  function cardClicked(alt: Alternate, e: MouseEvent) {
    if ((e.target as Element).closest('input, button, [role="menu"], .grip')) return;
    radio(alt.id)?.focus();
    choose(alt);
  }

  async function remove(alt: Alternate) {
    const ok = confirm(`Delete ${alternateName(section, alt)} for good?\n\nIts Lines go with it. It can't be undone.`);
    if (!ok) return;
    // Its ⋯ goes with it: the keyboard carries on from the active card.
    if (await edit((at) => api.deleteAlternate(at, alt.id))) radio(active.id)?.focus();
  }

  async function moveToScrapbook(alt: Alternate) {
    // Its ⋯ goes with it: the keyboard carries on from the active card.
    if (await edit((at) => api.moveAlternateToScrapbook(at, alt.id))) radio(active.id)?.focus();
  }

  async function moveToArrangement(alt: Alternate, position: number) {
    // Its ⋯ goes with it: the keyboard carries on from the active card.
    if (await edit((at) => api.moveAlternateToArrangement(at, alt.id, position))) radio(active.id)?.focus();
  }

  // Dragged by its card's grip, an inactive Alternate goes into a gap in the
  // Lyric Sheet or onto the Scrapbook, as a Section of its own.
  function dropAlternate(alt: Alternate) {
    return (drop: Drop) => {
      if ('alternateToArrangement' in drop) moveToArrangement(alt, drop.gap);
      else if ('alternateToScrapbook' in drop) moveToScrapbook(alt);
    };
  }

  // What an inactive Alternate's ⋯ does.
  function alternateActions(alt: Alternate): MenuAction[] {
    const actions: MenuAction[] = [
      {
        icon: '×',
        label: 'Move to the Scrapbook',
        title: 'Move to the Scrapbook: keep it as a Section of its own, with its Cues',
        run: () => moveToScrapbook(alt),
      },
    ];
    if (places.length > 0) {
      actions.push({
        icon: '↦',
        label: 'Move to the Lyric Sheet…',
        choices: places.map((place) => ({ label: place.name, run: () => moveToArrangement(alt, place.position) })),
      });
    }
    actions.push({ icon: '🗑', label: 'Delete', run: () => remove(alt) });
    return actions;
  }

  function focusWhen(on: boolean) {
    return (el: HTMLElement) => {
      if (!on) return;
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    };
  }
</script>

<!-- An action as a button beside the Label, where there's room for it. -->
<!-- An action with choices has no icon button: it shows only in ⋯. -->
{#snippet inlineAction(action: MenuAction & { run: () => void })}
  <button
    type="button"
    class="icon wide"
    onclick={action.run}
    aria-label={action.label}
    title={action.title ?? action.label}
  >
    {action.icon}
  </button>
{/snippet}

<article class="section" aria-label={labelOf(section)}>
  <div class="head">
    {@render grip?.()}
    <label class="visually-hidden" for="label-{section.id}">Label</label>
    <Combobox
      id="label-{section.id}"
      class="label"
      bind:value={label}
      options={suggestedLabels}
      saved={section.label}
      onpick={() => {
        commitLabel();
        // Focus stays in the field, to carry on typing.
        editingLabel = true;
      }}
      onrevert={() => onUnsaved(naming, false)}
      onfocus={() => (editingLabel = true)}
      oninput={() => onUnsaved(naming, true)}
      onchange={commitLabel}
      onblur={() => {
        editingLabel = false;
        onUnsaved(naming, false);
      }}
      placeholder="Label"
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="next"
      {@attach focusWhen(autofocus)}
    />
    <div class="actions">
      <!-- Shows at every width. -->
      <button
        type="button"
        class="icon alternates-toggle"
        class:has-others={section.alternates.length > 1}
        bind:this={toggle}
        onclick={() => (choosing ? leaveChoosing() : startChoosing())}
        aria-expanded={choosing}
        aria-label={alternatesLabel(section)}
        title="Choose, make or rename this Section's Alternates"
      >
        ⇄
      </button>
      {@render actions()}
      {#each more as action (action.label)}
        {#if 'run' in action}
          {@render inlineAction(action)}
        {/if}
      {/each}
      <!-- On phones there's no room for every action beside the Label: they fold into ⋯. -->
      <div class="narrow">
        <ActionsMenu entries={more} />
      </div>
    </div>
  </div>

  {#if choosing}
    <!-- Escape leaves the mode from anywhere in it; an open ⋯ menu takes it first. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="choosing" onkeydown={onChoosingKey}>
      <div class="cards" role="radiogroup" aria-label="Alternates of {labelOf(section)}">
        {#each section.alternates as alt (alt.id)}
          {@const name = alternateName(section, alt)}
          <!-- The radio takes the keyboard; a click anywhere else on the card is a shortcut to it. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="card"
            class:chosen={alt.active}
            class:dragged={drag?.alternate === alt.id}
            onclick={(e) => cardClicked(alt, e)}
          >
            <div class="card-head">
              <!-- The active one stays: a Section always has one. Pointer only: ⋯ moves it from the keyboard. -->
              {#if drag?.on && !alt.active}
                <span
                  class="grip"
                  aria-hidden="true"
                  title="Drag into the Lyric Sheet or onto the Scrapbook, as a Section of its own; Esc cancels"
                  {...drag.grip({ alternate: alt.id }, dropAlternate(alt))}>⠿</span
                >
              {/if}
              <input
                type="radio"
                id="pick-{section.id}-{alt.id}"
                name="alternate-{section.id}"
                checked={alt.active}
                onchange={() => choose(alt)}
                aria-label={name}
                aria-describedby="lines-{section.id}-{alt.id}"
              />
              <label class="visually-hidden" for="name-{section.id}-{alt.id}">Name of {name}</label>
              <input
                id="name-{section.id}-{alt.id}"
                class="name"
                value={alt.name}
                oninput={() => onUnsaved(naming, true)}
                onchange={(e) => rename(alt, e)}
                onkeydown={(e) => {
                  // Escape takes back what was typed, then leaves the mode as anywhere in it.
                  if (e.key === 'Escape') e.currentTarget.value = alt.name;
                }}
                onblur={() => onUnsaved(naming, false)}
                placeholder={name}
                autocomplete="off"
                enterkeyhint="done"
              />
              <!-- The active one can't be moved or deleted. -->
              {#if !alt.active}
                <ActionsMenu label="More actions for {name}" entries={alternateActions(alt)} />
              {/if}
            </div>
            <div class="lines" id="lines-{section.id}-{alt.id}">
              {#each alt.lines as line (line.id)}
                <p>{line.text || ' '}</p>
              {:else}
                <p class="muted">No Lines yet.</p>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="choosing-actions">
        <button
          type="button"
          class="button"
          onclick={addAlternate}
          title="New Alternate: try another version of these Lines without losing this one"
        >
          New Alternate
        </button>
        <button type="button" class="button primary" onclick={leaveChoosing}>Done</button>
      </div>
    </div>
  {:else}
    {#key active.id}
      <AlternateText alternate={active} label="Lines" {change} {onUnsaved} {cueing} />
    {/key}
  {/if}
</article>

<style>
  .section {
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.5rem;
  }
  /* Sized to its text, so the actions keep the rest of the row, with room
     at the end for ▾. Browsers without field-sizing get a fixed width
     instead. */
  .head > :global(.combobox) {
    flex: none;
    max-width: 100%;
  }
  .head :global(.label) {
    width: 8rem;
    border-color: transparent;
    background: transparent;
    font-weight: 700;
    text-overflow: ellipsis;
  }
  @supports (field-sizing: content) {
    .head :global(.label) {
      field-sizing: content;
      width: auto;
      /* Fits the placeholder. */
      min-width: 6rem;
      max-width: 12rem;
    }
    /* A long Label is cut off at rest but reads in full while it's edited. */
    .head :global(.label:focus) {
      max-width: 100%;
    }
  }
  .head :global(.combobox:hover .label),
  .head :global(.label:focus) {
    border-color: var(--border);
    background: var(--bg);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-left: auto;
  }
  /* A phone keeps the header on one row: the Label gives way, cut off, before
     the actions do. */
  @media (max-width: 40rem) {
    .head,
    .actions {
      flex-wrap: nowrap;
    }
    .head {
      column-gap: 0.25rem;
    }
    .head > :global(.combobox) {
      flex-shrink: 1;
      --combobox-end: 1rem;
    }
    .head :global(.label) {
      min-width: 4rem;
      padding-inline-start: 0.5rem;
    }
    .actions {
      flex-shrink: 0;
    }
    .wide {
      display: none;
    }
  }
  @media (min-width: 40.0625rem) {
    .narrow {
      display: none;
    }
  }
  .alternates-toggle {
    position: relative;
  }
  /* Hovered too, over .icon's own hover border. */
  .alternates-toggle[aria-expanded='true'],
  .alternates-toggle[aria-expanded='true']:hover {
    border-color: var(--accent);
  }
  /* A dot on the corner says there are Alternates to choose from. */
  .alternates-toggle.has-others::after {
    content: '';
    position: absolute;
    top: 0.1875rem;
    right: 0.1875rem;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--accent);
  }
  .choosing {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
  }
  .card.chosen {
    border: 2px solid var(--accent);
    background: var(--bg);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .card.dragged {
    opacity: 0.5;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 1.25rem;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .grip:hover {
    color: var(--text);
  }
  .card.dragged .grip {
    cursor: grabbing;
  }
  .card-head input[type='radio'] {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    accent-color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .lines {
    padding: 0 0.25rem;
    font-size: max(1rem, 16px);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .lines p {
    margin: 0;
    white-space: pre-wrap;
  }
  .choosing-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .choosing-actions .button {
    min-width: 8rem;
  }
  @media (max-width: 40rem) {
    .choosing-actions .button {
      flex: 1;
      min-width: 0;
    }
  }
</style>
