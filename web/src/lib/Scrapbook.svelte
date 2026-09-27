<script lang="ts">
  import { tick } from 'svelte';
  import { api, type Song, type SongAt } from './api';
  import SectionEditor from './SectionEditor.svelte';
  import { describe } from './sections';

  let {
    song,
    change,
    onUnsaved,
  }: {
    song: Song;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    onUnsaved: (editor: object, unsaved: boolean) => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const scrapbook = $derived(song.scrapbook.flatMap((id) => sections.get(id) ?? []));
  // Where a Section can be put back: at the start, or after any Occurrence.
  const places = $derived([
    { position: 0, name: 'At the start' },
    ...song.arrangement.map((o, i) => ({
      position: i + 1,
      name: `After ${i + 1}. ${describe(sections.get(o.sectionId)!)}`,
    })),
  ]);
  // The Section just added, whose Label gets focus.
  let added = $state<number | null>(null);

  async function add() {
    if (!(await change((at) => api.addToScrapbook(at)))) return;
    // The newest Section has the highest id, so it comes last.
    added = song.scrapbook.at(-1) ?? null;
    // Focus it once, not again if it later comes back to the Scrapbook.
    await tick();
    added = null;
  }

  function putBack(sectionId: number, e: Event & { currentTarget: HTMLSelectElement }) {
    const value = e.currentTarget.value;
    e.currentTarget.value = '';
    if (value !== '') change((at) => api.addOccurrence(at, sectionId, Number(value)));
  }

  function remove(sectionId: number) {
    const section = sections.get(sectionId);
    if (!section) return;
    const ok = confirm(`Delete ${describe(section)} for good?\n\nIts Lines go with it. It can't be undone.`);
    if (ok) change((at) => api.deleteSection(at, sectionId));
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
        <li>
          <SectionEditor
            uid="s{section.id}"
            {section}
            shared={false}
            autofocus={added === section.id}
            {change}
            {onUnsaved}
          >
            {#snippet actions()}
              <label class="visually-hidden" for="put-back-{section.id}">Put back into the Lyric Sheet</label>
              <select id="put-back-{section.id}" class="put-back" onchange={(e) => putBack(section.id, e)}>
                <option value="">Put back…</option>
                {#each places as place (place.position)}
                  <option value={place.position}>{place.name}</option>
                {/each}
              </select>
              <button
                type="button"
                class="icon"
                onclick={() => remove(section.id)}
                aria-label="Delete for good"
                title="Delete for good"
              >
                🗑
              </button>
            {/snippet}
          </SectionEditor>
        </li>
      {/each}
    </ul>
  {/if}

  <button type="button" class="button add" onclick={add}>Add a Section</button>
</section>

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
  .put-back {
    width: auto;
    font-weight: 600;
  }
  .add {
    width: 100%;
  }
</style>
