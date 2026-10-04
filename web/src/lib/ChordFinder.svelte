<script lang="ts">
  // The Chord Finder's three tabs: Look up, Name it and Suggest. Its own page
  // shows it, and a Song is to show it too, in a side panel or a phone sheet.
  import ChordDiagram from './ChordDiagram.svelte';
  import { lookUp, qualities, roots, type FinderContext } from './chordFinder';
  import Picker from './Picker.svelte';

  let { context }: { context: FinderContext } = $props();

  const tabs = [
    { id: 'look-up', label: 'Look up' },
    { id: 'name-it', label: 'Name it' },
    { id: 'suggest', label: 'Suggest' },
  ] as const;
  let tab = $state<(typeof tabs)[number]['id']>('look-up');
  let tabButtons: HTMLButtonElement[] = $state([]);

  // Arrow keys, Home and End move between the tabs, as a tab list's do.
  function tabKey(e: KeyboardEvent, i: number) {
    const moves: Record<string, number> = {
      ArrowRight: (i + 1) % tabs.length,
      ArrowLeft: (i - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tab = tabs[to].id;
    tabButtons[to]?.focus();
  }

  // Look up: the name typed, or made by the pickers, which show the last
  // name that could be read.
  let name = $state('C');
  let picked = $state<{ root: string; quality: string; bass: string | null }>({ root: 'C', quality: '', bass: null });
  const found = $derived(lookUp(name, context));

  /** How many Voicings show at once; the rest are a page away. */
  const pageSize = 8;
  let page = $state(0);
  const voicings = $derived(found.kind === 'chord' ? found.voicings : []);
  const pages = $derived(Math.ceil(voicings.length / pageSize));
  const shown = $derived(voicings.slice(page * pageSize, (page + 1) * pageSize));

  function typeName(e: Event & { currentTarget: HTMLInputElement }) {
    name = e.currentTarget.value;
    page = 0;
  }

  // The pickers follow a typed name once it can be read.
  $effect.pre(() => {
    if (found.kind === 'chord') picked = { root: found.root, quality: found.quality, bass: found.bass };
  });

  function pick(change: Partial<typeof picked>) {
    picked = { ...picked, ...change };
    name = picked.root + picked.quality + (picked.bass ? '/' + picked.bass : '');
    page = 0;
  }

  const qualityLabel = (suffix: string) => qualities.find((q) => q.suffix === suffix)?.label ?? suffix;
</script>

<div class="finder">
  <div class="tabs" role="tablist" aria-label="Chord Finder">
    {#each tabs as t, i (t.id)}
      <button
        bind:this={tabButtons[i]}
        id="finder-tab-{t.id}"
        type="button"
        role="tab"
        aria-selected={tab === t.id}
        aria-controls="finder-panel-{t.id}"
        tabindex={tab === t.id ? 0 : -1}
        onclick={() => (tab = t.id)}
        onkeydown={(e) => tabKey(e, i)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  {#each tabs as t (t.id)}
    <div
      class="panel"
      id="finder-panel-{t.id}"
      role="tabpanel"
      aria-labelledby="finder-tab-{t.id}"
      tabindex="0"
      hidden={tab !== t.id}
    >
      {#if t.id === 'look-up'}
        <div class="pick">
          <div class="field name">
            <label for="finder-name">Chord</label>
            <input
              id="finder-name"
              type="text"
              value={name}
              oninput={typeName}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="e.g. Cmaj7 or D/F#"
            />
          </div>
          <div class="field">
            <span id="finder-root-label">Root</span>
            <Picker
              id="finder-root"
              aria-labelledby="finder-root-label"
              options={roots}
              value={picked.root}
              onpick={(root) => pick({ root })}
            />
          </div>
          <div class="field">
            <span id="finder-quality-label">Quality</span>
            <Picker
              id="finder-quality"
              aria-labelledby="finder-quality-label"
              options={qualities.map((q) => q.suffix)}
              value={picked.quality}
              text={qualityLabel}
              onpick={(quality) => pick({ quality })}
            />
          </div>
          <div class="field">
            <span id="finder-bass-label">Bass</span>
            <Picker
              id="finder-bass"
              aria-labelledby="finder-bass-label"
              options={[null, ...roots]}
              value={picked.bass}
              text={(bass) => (bass ? '/' + bass : 'None')}
              onpick={(bass) => pick({ bass })}
            />
          </div>
        </div>

        {#if found.kind === 'unreadable'}
          {#if name.trim()}
            <p class="unknown" role="status">No Chord I know is called “{name.trim()}”.</p>
          {:else}
            <p class="muted">Pick a root and a quality, or type a Chord name.</p>
          {/if}
        {:else}
          <div class="chord">
            <h2>{found.name}</h2>
            <p class="notes"><span class="muted">Notes</span> {found.notes.join(' ')}</p>
          </div>
          {#if voicings.length === 0}
            <p class="muted">No Voicing of {found.name} fits a hand up to the 12th fret.</p>
          {:else}
            <ol class="voicings" aria-label="Voicings of {found.name}, best first">
              {#each shown as voicing, i (page * pageSize + i)}
                <li>
                  <ChordDiagram {voicing} name={found.name} />
                  <span class="rank muted">{page * pageSize + i + 1}</span>
                </li>
              {/each}
            </ol>
            <div class="pager">
              <button type="button" class="button" disabled={page === 0} onclick={() => page--}>Previous</button>
              <span class="muted" aria-live="polite">
                {page * pageSize + 1}–{page * pageSize + shown.length} of {voicings.length}
              </span>
              <button type="button" class="button" disabled={page >= pages - 1} onclick={() => page++}>Next</button>
            </div>
          {/if}
        {/if}
      {:else}
        <p class="muted">Coming soon.</p>
      {/if}
    </div>
  {/each}
</div>

<style>
  .finder {
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  [role='tab'] {
    min-height: var(--control);
    padding: 0 0.75rem;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }
  .panel[hidden] {
    display: none;
  }
  .panel p {
    margin: 0;
  }

  /* The name and the pickers: one row on desktop, two by two on a phone. */
  .pick {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  @media (min-width: 40rem) {
    .pick {
      grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
    }
  }
  .name {
    grid-column: 1 / -1;
  }
  @media (min-width: 40rem) {
    .name {
      grid-column: auto;
    }
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .field input {
    color: var(--text);
    font-weight: normal;
  }

  .unknown {
    font-weight: 600;
  }
  .chord {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  .notes {
    font-weight: 600;
    word-spacing: 0.25em;
  }
  .notes .muted {
    margin-right: 0.25rem;
    font-weight: normal;
    word-spacing: normal;
  }

  /* Two diagrams a row on a phone, big enough to read; four on desktop. */
  .voicings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 40rem) {
    .voicings {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .voicings li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem 0.5rem 0.5rem;
    border-radius: 0.5rem;
    background: var(--bg);
  }
  .voicings :global(.diagram) {
    max-width: 9rem;
  }
  .rank {
    font-size: 0.8125rem;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
</style>
