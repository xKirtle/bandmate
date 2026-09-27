<script lang="ts">
  import { api, suggestedLabels, type Song } from './api';
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
  // The Occurrence just added, whose Label gets focus.
  let added = $state<number | null>(null);

  async function add(position: number) {
    if (await change(() => api.addSection(song.id, { position }))) {
      added = song.arrangement[position]?.id ?? null;
    }
  }

  function move(index: number, by: -1 | 1) {
    const order = song.arrangement.map((o) => o.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    change(() => api.reorderArrangement(song.id, order));
  }
</script>

<section class="sheet" aria-labelledby="sheet-heading">
  <h2 id="sheet-heading">Lyric Sheet</h2>

  {#if song.arrangement.length === 0}
    <p class="muted">No Sections yet. Add one to start writing.</p>
  {/if}

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
            {/snippet}
          </SectionEditor>
        </li>
      {/if}
    {/each}
  </ol>

  <button type="button" class="button add" onclick={() => add(song.arrangement.length)}>Add Section</button>

  <datalist id="label-suggestions">
    {#each suggestedLabels as l (l)}<option value={l}></option>{/each}
  </datalist>
</section>

<style>
  .sheet {
    margin-bottom: 2rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .arrangement {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }
  .add {
    width: 100%;
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
