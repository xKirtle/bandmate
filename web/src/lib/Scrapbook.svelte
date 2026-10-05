<script lang="ts">
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Trash2 from '@lucide/svelte/icons/trash-2';
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
    onEditing,
  }: {
    song: Song;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** The drag of a Section, shared with the Lyric Sheet. */
    drag: SectionDragging;
    onUnsaved: (editor: object, unsaved: boolean) => void;
    /**
     * Hears a Section being opened, added, or moved into the Lyric Sheet, or
     * an open one being changed, e.g. to end Sync mode.
     */
    onEditing?: () => void;
  } = $props();

  // Adding a Section, or moving one into the Lyric Sheet, is heard.
  function edit(op: (at: SongAt) => Promise<Song>): Promise<boolean> {
    onEditing?.();
    return change(op);
  }

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const scrapbook = $derived(song.scrapbook.flatMap((id) => sections.get(id) ?? []));
  // The Sections in the Lyric Sheet, in order: the ones a Section can be
  // added to as Alternates.
  const inArrangement = $derived(sectionsInArrangement(song, sections));
  // Where a Section can be put back.
  const placesBack = $derived(places(inArrangement));
  // The Section just added or opened, whose Label gets focus.
  let focusing = $state<number | null>(null);
  // The one Section shown in full, in its editor; the rest show as cards.
  let open = $state<number | null>(null);
  // Where to go once the open editor's edits are saved: another Section, or
  // null to close it. Closing sooner would throw away edits that failed to save.
  let next = $state<number | null | undefined>(undefined);
  // The open editor's text boxes holding edits not yet saved.
  const unsaved = new SvelteSet<object>();

  $effect(() => {
    if (next === undefined || unsaved.size > 0) return;
    const opening = next;
    open = opening;
    next = undefined;
    if (opening !== null) focusOnce(opening);
  });

  // Focuses a Section's Label as its editor opens, but not again if it later
  // comes back to the Scrapbook.
  async function focusOnce(sectionId: number) {
    focusing = sectionId;
    await tick();
    focusing = null;
  }

  function track(editor: object, isUnsaved: boolean) {
    if (isUnsaved) {
      unsaved.add(editor);
      // Typing again after a failed save stays in this editor.
      next = undefined;
    } else unsaved.delete(editor);
    onUnsaved(editor, isUnsaved);
  }

  function show(sectionId: number | null) {
    if (sectionId !== null) onEditing?.();
    next = sectionId;
  }

  async function done(sectionId: number) {
    show(null);
    await tick();
    // Back to the card, so the keyboard keeps its place.
    if (open === null) document.getElementById(`card-${sectionId}`)?.focus();
  }

  async function add() {
    if (!(await edit((at) => api.addToScrapbook(at)))) return;
    // The newest Section has the highest id, so it comes last.
    const added = song.scrapbook.at(-1) ?? null;
    open = added;
    next = undefined;
    if (added !== null) focusOnce(added);
  }

  // What "Put back…" offers: putting a Section back at a place in the Lyric
  // Sheet, or adding it to a Section there as Alternates.
  function putBackMenu(sectionId: number) {
    return putBackActions(
      inArrangement,
      (position) => edit((at) => api.addToArrangement(at, sectionId, position)).then(closed(sectionId)),
      (targetId) => addTo(sectionId, targetId),
    );
  }

  function addTo(sectionId: number, targetId: number) {
    // Its Alternates are made anew in the Section they join, so edits still
    // waiting in its open editor are saved first, while they can be: a drag
    // doesn't blur the text box.
    if (open === sectionId && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    edit((at) => api.addToSection(at, sectionId, targetId)).then(closed(sectionId));
  }

  // On desktop, a Section is also dragged by its grip into a gap in the Lyric
  // Sheet, putting it back there, or onto a Section in it, adding it there,
  // as "Put back…" does.
  function dropSection(drop: Drop) {
    if ('putBack' in drop) {
      const section = drop.putBack;
      edit((at) => api.addToArrangement(at, section, drop.gap)).then(closed(section));
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
              autofocus={focusing === section.id}
              {change}
              onUnsaved={track}
              {onEditing}
              more={[{ icon: Trash2, label: 'Delete for good', run: () => remove(section.id) }]}
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
      {...drag.grip({ section: sectionId }, dropSection)}><GripVertical /></span
    >
  {/if}
{/snippet}

<style>
  .scrapbook {
    padding: var(--space-3);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
  }
  h2 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-1);
  }
  .hint {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
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
    gap: var(--space-1);
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
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
    gap: var(--space-2);
    margin-bottom: var(--space-1);
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
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  /* One row each, cut off, so a card stays short however long its Lines. */
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .more {
    font-size: var(--text-sm);
  }
  .done {
    width: 100%;
    margin-top: var(--space-2);
  }
</style>
