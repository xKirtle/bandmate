<script lang="ts">
  import { untrack } from 'svelte';
  import { api, suggestedLabels, type Section, type Song } from './api';
  import { hasChords } from './chords';
  import LyricSheetView from './LyricSheetView.svelte';
  import SectionEditor from './SectionEditor.svelte';

  let {
    song,
    change,
    onUnsaved,
  }: {
    song: Song;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: () => Promise<Song>) => Promise<boolean>;
    onUnsaved: (editor: object, unsaved: boolean) => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  // How many Occurrences show each Section.
  const uses = $derived(
    song.arrangement.reduce((m, o) => m.set(o.sectionId, (m.get(o.sectionId) ?? 0) + 1), new Map<number, number>()),
  );
  // The Sections in the Arrangement, once each, in the order they first appear.
  const repeatable = $derived(
    [...new Set(song.arrangement.map((o) => o.sectionId))].flatMap((id) => sections.get(id) ?? []),
  );
  // The Occurrence just added, whose Label gets focus.
  let added = $state<number | null>(null);
  // Write edits the raw text; Read shows Chords above the lyrics.
  let mode = $state<'write' | 'read'>('write');
  const songHasChords = $derived(hasChords(song));
  // Follows the server, except while a change to it is being sent.
  let showChords = $state(untrack(() => song.showChords));
  $effect(() => {
    showChords = song.showChords;
  });

  async function toggleChords() {
    const next = showChords;
    if (!(await change(() => api.updateSong(song.id, { showChords: next })))) showChords = song.showChords;
  }

  async function add(position: number) {
    if (await change(() => api.addSection(song.id, { position }))) {
      added = song.arrangement[position]?.id ?? null;
    }
  }

  function repeat(sectionId: number, position?: number) {
    change(() => api.addOccurrence(song.id, sectionId, position));
  }

  function repeatAtEnd(e: Event & { currentTarget: HTMLSelectElement }) {
    const id = Number(e.currentTarget.value);
    e.currentTarget.value = '';
    if (id) repeat(id);
  }

  // How a Section is named in lists: its Label, else its first Line.
  function describe(section: Section) {
    const first = section.alternates.find((a) => a.active)?.lines.find((l) => l.lyrics.trim())?.lyrics.trim();
    return section.label || (first ? `“${first}”` : 'Section without a Label');
  }

  function move(index: number, by: -1 | 1) {
    const order = song.arrangement.map((o) => o.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    change(() => api.reorderArrangement(song.id, order));
  }
</script>

<section class="sheet" aria-labelledby="sheet-heading">
  <div class="head">
    <h2 id="sheet-heading">Lyric Sheet</h2>
    <fieldset class="modes">
      <legend class="visually-hidden">Mode</legend>
      <label class="mode"><input type="radio" name="sheet-mode" value="write" bind:group={mode} />Write</label>
      <label class="mode"><input type="radio" name="sheet-mode" value="read" bind:group={mode} />Read</label>
    </fieldset>
  </div>

  {#if song.arrangement.length === 0}
    <p class="muted">No Sections yet. Add one to start writing.</p>
  {/if}

  {#if mode === 'read'}
    {#if songHasChords}
      <label class="show-chords">
        <input type="checkbox" bind:checked={showChords} onchange={toggleChords} />
        Show chords
      </label>
    {/if}
    <LyricSheetView {song} showChords={showChords && songHasChords} />
  {:else}
    <ol class="arrangement">
      {#each song.arrangement as occurrence, i (occurrence.id)}
        {@const section = sections.get(occurrence.sectionId)}
        {#if section}
          <li>
            <SectionEditor
              songId={song.id}
              occurrenceId={occurrence.id}
              {section}
              shared={occurrence.shared}
              uses={uses.get(occurrence.sectionId) ?? 1}
              autofocus={added === occurrence.id}
              {change}
              {onUnsaved}
            >
              {#snippet actions()}
                <button type="button" class="icon" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  class="icon"
                  onclick={() => move(i, 1)}
                  disabled={i === song.arrangement.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" class="icon" onclick={() => add(i + 1)} aria-label="Add a Section below">
                  +
                </button>
                <button
                  type="button"
                  class="icon"
                  onclick={() => repeat(section.id, i + 1)}
                  aria-label="Repeat this Section below"
                  title="Repeat this Section below"
                >
                  ⧉
                </button>
                {#if occurrence.shared}
                  <button
                    type="button"
                    class="icon"
                    onclick={() => change(() => api.detach(song.id, occurrence.id))}
                    aria-label="Detach into its own copy"
                    title="Detach: give this Occurrence its own copy, so it can differ"
                  >
                    ⑂
                  </button>
                  <button
                    type="button"
                    class="icon"
                    onclick={() => change(() => api.removeOccurrence(song.id, occurrence.id))}
                    aria-label="Remove this Occurrence"
                    title="Remove this Occurrence; the others stay"
                  >
                    ×
                  </button>
                {/if}
              {/snippet}
            </SectionEditor>
          </li>
        {/if}
      {/each}
    </ol>

    <div class="add-row">
      <button type="button" class="button add" onclick={() => add(song.arrangement.length)}>Add Section</button>
      {#if repeatable.length > 0}
        <label class="visually-hidden" for="repeat-section">Repeat a Section at the end</label>
        <select id="repeat-section" class="repeat" onchange={repeatAtEnd}>
          <option value="">Repeat a Section…</option>
          {#each repeatable as section (section.id)}
            <option value={section.id}>{describe(section)}</option>
          {/each}
        </select>
      {/if}
    </div>
    <p class="hint muted">Put Chords in brackets where they fall: <code>Hel[Am]lo</code>.</p>
  {/if}

  <datalist id="label-suggestions">
    {#each suggestedLabels as l (l)}<option value={l}></option>{/each}
  </datalist>
</section>

<style>
  .sheet {
    margin-bottom: 2rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .modes {
    display: flex;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .mode {
    display: flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 0.875rem;
    background: var(--surface-1);
    font-weight: 600;
    cursor: pointer;
  }
  .mode + .mode {
    border-left: 1px solid var(--border);
  }
  .mode input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    min-height: 0;
  }
  .mode:has(input:checked) {
    background: var(--surface-2);
  }
  .mode:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .show-chords {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }
  .show-chords input {
    width: 1.25rem;
    height: 1.25rem;
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.8125rem;
  }
  .arrangement {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .add,
  .repeat {
    flex: 1 1 12rem;
    width: auto;
  }
  .repeat {
    font-weight: 600;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 1.125rem;
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    border-color: var(--border);
    background: var(--bg);
    color: var(--text);
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
