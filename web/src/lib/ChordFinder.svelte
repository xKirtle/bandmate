<script lang="ts">
  // The Chord Finder's three tabs: Look up, Name it and Suggest. Its own page
  // shows it, and a Song is to show it too, in a side panel or a phone sheet.
  import { tick } from 'svelte';
  import ChordDiagram from './ChordDiagram.svelte';
  import { lookUp, nameIt, qualities, roots, type FinderContext, type Frets, type Voicing } from './chordFinder';
  import Fretboard from './Fretboard.svelte';
  import { leftHanded } from './sharedLeftHanded.svelte';
  import { preferredVoicings } from './sharedPreferredVoicings.svelte';
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
  const found = $derived(lookUp(name, { ...context, preferred: preferredVoicings.of(context.tuning) }));

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

  // Preferring a Voicing moves it first, so the first page shows it, and
  // focus follows it there; clearing one leaves focus on the first Voicing.
  let list: HTMLOListElement | undefined = $state();

  async function prefer(voicing: Voicing | null) {
    if (found.kind !== 'chord') return;
    preferredVoicings.set(context.tuning, found.name, voicing?.frets ?? null);
    page = 0;
    await tick();
    list?.querySelector<HTMLButtonElement>('.prefer')?.focus();
  }

  const qualityLabel = (suffix: string) => qualities.find((q) => q.suffix === suffix)?.label ?? suffix;

  // Name it: the shape placed on the fretboard, and what it reads as. It
  // starts, and clears, with nothing placed: every string muted.
  const nothingPlaced = (): Frets => context.tuning.map(() => null);
  let placed = $state(nothingPlaced());
  const named = $derived(nameIt(placed, context));

  /** Opens a reading in Look up, with focus on its tab. */
  function openInLookUp(reading: string) {
    name = reading;
    page = 0;
    tab = 'look-up';
    tabButtons[tabs.findIndex((t) => t.id === 'look-up')]?.focus();
  }
</script>

<div class="finder">
  <div class="bar">
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
    <button
      type="button"
      class="button toggle"
      aria-pressed={leftHanded.on}
      onclick={() => leftHanded.set(!leftHanded.on)}
      title="Mirror the diagrams and the fretboard for a left-handed player">Left-handed</button
    >
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
            <ol bind:this={list} class="voicings" aria-label="Voicings of {found.name}, best first">
              {#each shown as voicing, i (page * pageSize + i)}
                {@const rank = page * pageSize + i}
                {@const preferred = found.preferred && rank === 0}
                <li class:preferred>
                  <ChordDiagram {voicing} name={found.name} capo={context.capo} />
                  <span class="rank muted">{preferred ? 'Preferred' : rank + 1}</span>
                  {#if preferred}
                    <button
                      type="button"
                      class="button prefer"
                      title="Stop preferring this Voicing, putting the best-ranked one first again"
                      onclick={() => prefer(null)}>Clear</button
                    >
                  {:else}
                    <button
                      type="button"
                      class="button prefer"
                      title="Show this Voicing of {found.name} first in this tuning"
                      onclick={() => prefer(voicing)}>Prefer</button
                    >
                  {/if}
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
      {:else if t.id === 'name-it'}
        <div class="name-it">
          <div class="named" aria-live="polite">
            {#if named.kind === 'chord'}
              <ol class="readings" aria-label="Readings, best first">
                {#each named.readings as reading, i (reading)}
                  <li>
                    <button
                      type="button"
                      class="reading"
                      class:best={i === 0}
                      title="Look up how to play {reading}"
                      onclick={() => openInLookUp(reading)}>{reading}</button
                    >
                  </li>
                {/each}
              </ol>
              <p class="notes"><span class="muted">Notes</span> {named.notes.join(' ')}</p>
            {:else if named.notes.length}
              <p class="unknown">No Chord I know: {named.notes.join(', ')}</p>
            {:else}
              <p class="muted">Place a finger, or ring a string open above the nut.</p>
            {/if}
          </div>
          <div class="board">
            <Fretboard bind:frets={placed} capo={context.capo} />
            <button type="button" class="button clear" onclick={() => (placed = nothingPlaced())}>Clear</button>
          </div>
        </div>
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
  /* The tabs, and the left-handed setting at the end, on its own line on a narrow phone. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.5rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .toggle {
    min-height: 2rem;
    margin-left: auto;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
  }
  .toggle[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
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
  .preferred {
    outline: 2px solid var(--accent);
  }
  .preferred .rank {
    color: var(--text);
    font-weight: 600;
  }
  .prefer {
    min-height: 2rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
  }
  /*
   * Name it: what the shape reads as above the fretboard on a phone, so it
   * stays in view while fingers are placed; beside it on desktop.
   */
  .name-it {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  @media (min-width: 40rem) {
    .name-it {
      flex-direction: row-reverse;
      justify-content: flex-end;
      align-items: flex-start;
      gap: 2rem;
    }
  }
  .named {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    min-height: 4.5rem;
  }
  @media (min-width: 40rem) {
    .named {
      flex: 1;
    }
  }
  .readings {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .reading {
    min-height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .reading.best {
    min-height: var(--control);
    border-color: var(--accent);
    font-size: 1.5rem;
  }
  .reading:hover {
    border-color: var(--accent);
  }
  .board {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    max-width: 22rem;
    align-self: center;
  }
  @media (min-width: 40rem) {
    .board {
      flex: 0 0 22rem;
      align-self: flex-start;
    }
  }
  .clear {
    align-self: flex-end;
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
</style>
