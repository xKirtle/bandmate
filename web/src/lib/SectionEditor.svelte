<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ActionsMenu from './ActionsMenu.svelte';
  import AlternateText, { type Cueing } from './AlternateText.svelte';
  import { api, type Alternate, type Section, type Song, type SongAt } from './api';
  import type { MenuAction } from './menu';

  let {
    uid,
    section,
    shared,
    autofocus = false,
    change,
    onUnsaved,
    grip,
    actions,
    more,
    cueing,
  }: {
    /** Makes element ids unique, e.g. when a shared Section shows more than once. */
    uid: string;
    section: Section;
    /** Other Occurrences show this Section too. */
    shared: boolean;
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
  } = $props();

  // The server guarantees exactly one active Alternate.
  const active = $derived(section.alternates.find((a) => a.active)!);
  const inactive = $derived(section.alternates.filter((a) => !a.active));

  let label = $state(untrack(() => section.label));
  let editingLabel = false;
  // Identifies the Label or Alternate name being typed to onUnsaved. They
  // save on change, which comes just before blur.
  const naming = {};
  // The inactive Alternates shown expanded.
  const expanded = new SvelteSet<number>();

  $effect(() => {
    const l = section.label;
    if (!editingLabel) label = l;
  });

  async function commitLabel() {
    editingLabel = false;
    const next = label.trim();
    if (next === section.label) {
      label = section.label;
      return;
    }
    if (!(await change((at) => api.setSectionLabel(at, section.id, next)))) label = section.label;
  }

  /** How an Alternate is called: its name, else its place among the Section's Alternates. */
  function nameOf(alt: Alternate): string {
    return alt.name || `Alternate ${section.alternates.indexOf(alt) + 1}`;
  }

  /** A hint at how an Alternate differs: its first Line that isn't the same in the active one. */
  function preview(alt: Alternate): string {
    if (alt.lines.length === 0) return 'No Lines yet';
    const i = alt.lines.findIndex((l, j) => l.text !== active.lines[j]?.text);
    if (i === -1) return alt.lines.length === active.lines.length ? 'Same as the active one' : 'Fewer Lines';
    return `“${alt.lines[i].lyrics.trim() || '(blank Line)'}”`;
  }

  const newAlternate: MenuAction = {
    icon: '⇄',
    label: 'New Alternate',
    title: 'New Alternate: try another version of these Lines without losing this one',
    run: addAlternate,
  };

  async function addAlternate() {
    if (!(await change((at) => api.addAlternate(at, section.id)))) return;
    // The newest Alternate comes last; show it open, ready to change.
    const added = section.alternates.at(-1);
    if (added && !added.active) expanded.add(added.id);
  }

  async function rename(alt: Alternate, e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const next = input.value.trim();
    if (next === alt.name) {
      input.value = alt.name;
      return;
    }
    if (!(await change((at) => api.renameAlternate(at, alt.id, next)))) input.value = alt.name;
  }

  async function activate(alt: Alternate) {
    const previous = active.id;
    if (await change((at) => api.activateAlternate(at, alt.id))) {
      expanded.delete(alt.id);
      expanded.delete(previous);
    }
  }

  function remove(alt: Alternate) {
    const ok = confirm(`Delete ${nameOf(alt)} for good?\n\nIts Lines go with it. It can't be undone.`);
    if (ok) change((at) => api.deleteAlternate(at, alt.id));
  }

  function syncExpanded(alt: Alternate, e: Event & { currentTarget: HTMLDetailsElement }) {
    if (e.currentTarget.open) expanded.add(alt.id);
    else expanded.delete(alt.id);
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
{#snippet inlineAction(action: MenuAction)}
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

<article class="section" class:is-shared={shared} aria-label={section.label || 'Section without a Label'}>
  <div class="head">
    {@render grip?.()}
    <label class="visually-hidden" for="label-{uid}">Label</label>
    <input
      id="label-{uid}"
      class="label"
      bind:value={label}
      onfocus={() => (editingLabel = true)}
      oninput={() => onUnsaved(naming, true)}
      onchange={commitLabel}
      onblur={() => {
        editingLabel = false;
        onUnsaved(naming, false);
      }}
      list="label-suggestions"
      placeholder="Label"
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="next"
      {@attach focusWhen(autofocus)}
    />
    {#if shared}
      <span class="shared" title="This Section appears more than once. Editing it changes every Occurrence.">
        Shared
      </span>
    {/if}
    <div class="actions">
      {@render inlineAction(newAlternate)}
      {@render actions()}
      {#each more as action (action.label)}
        {@render inlineAction(action)}
      {/each}
      <!-- On phones there's no room for every action beside the Label: they fold into ⋯. -->
      <div class="narrow">
        <ActionsMenu entries={[newAlternate, ...more]} />
      </div>
    </div>
  </div>

  {#if inactive.length > 0}
    <div class="active-name">
      <span class="badge">Active</span>
      <label class="visually-hidden" for="name-{uid}-{active.id}">Name of the active Alternate</label>
      <input
        id="name-{uid}-{active.id}"
        class="name"
        value={active.name}
        oninput={() => onUnsaved(naming, true)}
        onchange={(e) => rename(active, e)}
        onblur={() => onUnsaved(naming, false)}
        placeholder={nameOf(active)}
        autocomplete="off"
        enterkeyhint="done"
      />
    </div>
  {/if}
  {#key active.id}
    <AlternateText uid="{uid}-{active.id}" alternate={active} label="Lines" {change} {onUnsaved} {cueing} />
  {/key}

  {#if inactive.length > 0}
    <ul class="alternates" aria-label="Other Alternates">
      {#each inactive as alt (alt.id)}
        <li>
          <details open={expanded.has(alt.id)} ontoggle={(e) => syncExpanded(alt, e)}>
            <summary>
              <span class="alt-name">{nameOf(alt)}</span>
              <span class="preview muted">{preview(alt)}</span>
            </summary>
            <div class="alt-body">
              <label class="visually-hidden" for="name-{uid}-{alt.id}">Name of {nameOf(alt)}</label>
              <input
                id="name-{uid}-{alt.id}"
                class="name"
                value={alt.name}
                oninput={() => onUnsaved(naming, true)}
                onchange={(e) => rename(alt, e)}
                onblur={() => onUnsaved(naming, false)}
                placeholder="Name it (optional)"
                autocomplete="off"
                enterkeyhint="done"
              />
              <div class="compare">
                <div class="pane">
                  <p class="pane-title muted">{nameOf(alt)}</p>
                  <AlternateText
                    uid="{uid}-{alt.id}"
                    alternate={alt}
                    label="Lines of {nameOf(alt)}"
                    {change}
                    {onUnsaved}
                  />
                </div>
                <div class="pane">
                  <p class="pane-title muted">Active: {nameOf(active)}</p>
                  <div class="active-lines">
                    {#each active.lines as line (line.id)}
                      <p>{line.text || ' '}</p>
                    {:else}
                      <p class="muted">No Lines yet.</p>
                    {/each}
                  </div>
                </div>
              </div>
              <div class="alt-actions">
                <button type="button" class="button primary" onclick={() => activate(alt)}>Make active</button>
                <button type="button" class="button danger" onclick={() => remove(alt)}>Delete</button>
              </div>
            </div>
          </details>
        </li>
      {/each}
    </ul>
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
  /* Sized to its text, so the actions keep the rest of the row. Browsers
     without field-sizing get a fixed width instead. */
  .label {
    flex: none;
    width: 8rem;
    border-color: transparent;
    background: transparent;
    font-weight: 700;
    text-overflow: ellipsis;
  }
  @supports (field-sizing: content) {
    .label {
      field-sizing: content;
      width: auto;
      min-width: 4rem;
      max-width: 12rem;
    }
    /* A long Label is cut off at rest but reads in full while it's edited. */
    .label:focus {
      max-width: 100%;
    }
  }
  .label:hover,
  .label:focus {
    border-color: var(--border);
    background: var(--bg);
  }
  .section.is-shared {
    border-left: 4px solid var(--accent);
  }
  .shared,
  .badge {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
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
    .label {
      flex-shrink: 1;
      min-width: 3rem;
      padding-inline: 0.5rem;
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
  .active-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .alternates {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  details {
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-height: var(--control);
    padding: 0.625rem 0.75rem;
    cursor: pointer;
  }
  summary::marker {
    content: '';
  }
  summary::before {
    content: '▸';
    color: var(--text-muted);
  }
  details[open] > summary::before {
    content: '▾';
  }
  .alt-name {
    font-weight: 600;
    white-space: nowrap;
  }
  .preview {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .alt-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.5rem 0.5rem;
  }
  /* Side by side where there's room, one above the other on a phone. */
  .compare {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.5rem;
  }
  .pane {
    min-width: 0;
  }
  .pane-title {
    margin: 0 0 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .active-lines {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    font-size: max(1rem, 16px);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .active-lines p {
    margin: 0;
    white-space: pre-wrap;
  }
  .alt-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .alt-actions .button {
    flex: 1 1 8rem;
  }
</style>
