<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api, type Song, type SongAt } from './api';
  import type { Drop } from './sectionDrag';
  import type { SectionDragging } from './sectionDragging.svelte';
  import ActionsMenu from './ActionsMenu.svelte';
  import SectionEditor from './SectionEditor.svelte';
  import { card, describe, labelOf, places, putBackActions, sectionsInArrangement } from './sections';

  let {
    song,
    change,
    drag,
    onUnsaved,
  }: {
    song: Song;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** The drag of a Section, shared with the Lyric Sheet. */
    drag: SectionDragging;
    onUnsaved: (editor: object, unsaved: boolean) => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const scrapbook = $derived(song.scrapbook.flatMap((id) => sections.get(id) ?? []));
  // The Sections in the Lyric Sheet, in order: the ones a Section can be
  // added to as Alternates.
  const inArrangement = $derived(sectionsInArrangement(song, sections));
  // Where a Section can be put back.
  const placesBack = $derived(places(inArrangement));
  // The Section just added, whose Label gets focus.
  let added = $state<number | null>(null);
  // The one Section shown in full, in its editor; the rest show as cards.
  let open = $state<number | null>(null);
  // Where to go once the open editor's edits are saved: another Section, or
  // null to close it. Closing sooner would throw away edits that failed to save.
  let next = $state<number | null | undefined>(undefined);
  // The open editor's text boxes holding edits not yet saved.
  const unsaved = new SvelteSet<object>();

  $effect(() => {
    if (next === undefined || unsaved.size > 0) return;
    open = next;
    next = undefined;
  });

  function track(editor: object, isUnsaved: boolean) {
    if (isUnsaved) {
      unsaved.add(editor);
      // Typing again after a failed save stays in this editor.
      next = undefined;
    } else unsaved.delete(editor);
    onUnsaved(editor, isUnsaved);
  }

  function show(sectionId: number | null) {
    next = sectionId;
  }

  async function done(sectionId: number) {
    show(null);
    await tick();
    // Back to the card, so the keyboard keeps its place.
    if (open === null) document.getElementById(`card-${sectionId}`)?.focus();
  }

  async function add() {
    if (!(await change((at) => api.addToScrapbook(at)))) return;
    // The newest Section has the highest id, so it comes last.
    added = song.scrapbook.at(-1) ?? null;
    open = added;
    next = undefined;
    // Focus it once, not again if it later comes back to the Scrapbook.
    await tick();
    added = null;
  }

  // What "Put back…" offers: putting a Section back at a place in the Lyric
  // Sheet, or adding it to a Section there as Alternates.
  function putBackMenu(sectionId: number) {
    return putBackActions(
      inArrangement,
      (position) => change((at) => api.addToArrangement(at, sectionId, position)).then(closed(sectionId)),
      (targetId) => addTo(sectionId, targetId),
    );
  }

  function addTo(sectionId: number, targetId: number) {
    // Its Alternates are made anew in the Section they join, so edits still
    // waiting in its open editor are saved first, while they can be: a drag
    // doesn't blur the text box.
    if (open === sectionId && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    change((at) => api.addToSection(at, sectionId, targetId)).then(closed(sectionId));
  }

  // On desktop, a Section is also dragged by its grip into a gap in the Lyric
  // Sheet, putting it back there, or onto a Section in it, adding it there,
  // as "Put back…" does.
  function dropSection(drop: Drop) {
    if ('putBack' in drop) {
      const section = drop.putBack;
      change((at) => api.addToArrangement(at, section, drop.gap)).then(closed(section));
    } else if ('addTo' in drop && 'section' in drop.addTo.dragged) {
      const { dragged, arrangementAt } = drop.addTo;
      const target = song.arrangement[arrangementAt];
      if (target !== undefined) addTo(dragged.section, target);
    }
  }

  /** After a Section leaves the Scrapbook: should it come back, it does so as a card. */
  function closed(sectionId: number) {
    return (ok: boolean) => {
      if (!ok || open !== sectionId) return;
      open = null;
      // Its editor is gone, and whatever it held with it.
      unsaved.clear();
    };
  }

  function remove(sectionId: number) {
    const section = sections.get(sectionId);
    if (!section) return;
    const ok = confirm(`Delete ${describe(section)} for good?\n\nIts Lines go with it. It can't be undone.`);
    if (ok) change((at) => api.deleteSection(at, sectionId)).then(closed(sectionId));
  }
</script>

<section class="scrapbook" aria-labelledby="scrapbook-heading">
  <h2 id="scrapbook-heading">Scrapbook</h2>
  <p class="hint muted">
    Sections that aren't in the Lyric Sheet: leftovers and loose ideas. Nothing here is lost unless you delete it.
  </p>

  {#if scrapbook.length > 0}
    <ul class="list">
      {#each scrapbook as section (section.id)}
        <li class:dragged={drag.section === section.id}>
          {#if open === section.id}
            <SectionEditor
              {section}
              autofocus={added === section.id}
              {change}
              onUnsaved={track}
              more={[{ icon: '🗑', label: 'Delete for good', run: () => remove(section.id) }]}
              {drag}
              places={placesBack}
            >
              {#snippet grip()}
                {@render dragGrip(section.id)}
              {/snippet}
              {#snippet actions()}
                <ActionsMenu
                  label="Put back into the Lyric Sheet, or add as an Alternate of a Section"
                  text="Put back…"
                  entries={putBackMenu(section.id)}
                />
              {/snippet}
            </SectionEditor>
            <button type="button" class="button done" onclick={() => done(section.id)}>Done</button>
          {:else}
            {@const shown = card(section)}
            <div class="card-row">
              {@render dragGrip(section.id)}
              <button type="button" id="card-{section.id}" class="card" onclick={() => show(section.id)}>
                <span class="card-head">
                  <span class="card-label" class:muted={!section.label}>{labelOf(section)}</span>
                  {#if shown.alternates > 1}
                    <span class="count">{shown.alternates} Alternates</span>
                  {/if}
                </span>
                {#each shown.lines as line, i (i)}
                  <span class="line">{line || ' '}</span>
                {:else}
                  <span class="line muted">No Lines yet.</span>
                {/each}
                {#if shown.more > 0}
                  <span class="more muted">+{shown.more} more {shown.more === 1 ? 'Line' : 'Lines'}</span>
                {/if}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="button add" onclick={add}>Add a Section</button>
</section>

{#snippet dragGrip(sectionId: number)}
  {#if drag.on}
    <!-- Pointer only: "Put back…" puts it back from the keyboard. -->
    <span
      class="grip"
      aria-hidden="true"
      title="Drag between Sections in the Lyric Sheet to put it back, or onto one to add it as Alternates; Esc cancels"
      {...drag.grip({ section: sectionId }, dropSection)}>⠿</span
    >
  {/if}
{/snippet}

<style>
  .scrapbook {
    padding: 0.75rem;
    border: 1px dashed var(--border);
    border-radius: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.25rem;
  }
  .hint {
    margin: 0 0 0.75rem;
    font-size: 0.8125rem;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }
  .card-row {
    display: flex;
    align-items: flex-start;
  }
  .list > .dragged {
    opacity: 0.5;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 1.25rem;
    min-height: var(--control);
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .grip:hover {
    color: var(--text);
  }
  .list > .dragged .grip {
    cursor: grabbing;
  }
  .add {
    width: 100%;
  }
  .card {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.125rem;
    width: 100%;
    min-width: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card:hover {
    background: var(--surface-2);
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.125rem;
  }
  .card-label {
    min-width: 0;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex: none;
    margin-left: auto;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.75rem;
    font-weight: 600;
  }
  /* One row each, cut off, so a card stays short however long its Lines. */
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .more {
    font-size: 0.8125rem;
  }
  .done {
    width: 100%;
    margin-top: 0.5rem;
  }
</style>
