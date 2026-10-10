<script lang="ts">
  // The Chord Finder's three tabs: Look up, Name it and Suggest, as its own
  // page shows them. It lays itself out by its own width, not the window's.
  import { tick } from 'svelte';
  import ChordDiagram from './ChordDiagram.svelte';
  import {
    firstVoicing,
    keyName,
    keys,
    lookUp,
    nameIt,
    plucks,
    qualities,
    roots,
    suggest,
    type FinderContext,
    type Frets,
    type Suggestion,
    type Voicing,
  } from './chordFinder';
  import Fretboard from './Fretboard.svelte';
  import HearButton from './HearButton.svelte';
  import { leftHanded } from './sharedLeftHanded.svelte';
  import { preferredVoicings } from './sharedPreferredVoicings.svelte';
  import Picker from './Picker.svelte';

  let {
    context,
    suggestKey,
    onpickkey,
  }: {
    context: FinderContext;
    /** The Key Suggest suggests from, as its picker writes it (G, Em). */
    suggestKey: string;
    /** The user picked another Key for Suggest. */
    onpickkey: (key: string) => void;
  } = $props();

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
  // The Finder's context with the user's preferred Voicings in its tuning:
  // what Look up lists first, and what Suggest draws.
  const finderContext = $derived({ ...context, preferred: preferredVoicings.of(context.tuning) });
  const found = $derived(lookUp(name, finderContext));

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
  // Hearing it strums it even when it reads as no Chord.
  const placedPlucks = $derived(plucks(placed, context));
  const placedName = $derived(named.kind === 'chord' ? named.readings[0] : 'this Chord shape');

  /** Opens a reading in Look up, with focus on its tab. */
  function openInLookUp(reading: string) {
    name = reading;
    page = 0;
    tab = 'look-up';
    tabButtons[tabs.findIndex((t) => t.id === 'look-up')]?.focus();
  }

  // Suggest: the Key's Chords, and what usually follows the Chord picked
  // after, if any. Picking another Key starts again with none picked.
  let after = $state<string | null>(null);
  const suggested = $derived(suggest(suggestKey, after));
  const chords = $derived(suggested.kind === 'key' ? suggested.chords : []);
  const numeralOf = $derived(new Map(chords.map((c) => [c.chord, c.numeral])));
  const groups = $derived(
    [
      { kind: 'diatonic', title: suggested.kind === 'key' ? 'In ' + suggested.key : '' },
      { kind: 'borrowed', title: 'Borrowed' },
      { kind: 'secondary', title: 'Secondary dominants' },
    ]
      .map((g) => ({ ...g, chords: chords.filter((c) => c.kind === g.kind) }))
      .filter((g) => g.chords.length),
  );

  function pickKey(key: string) {
    after = null;
    onpickkey(key);
  }
</script>

{#snippet suggestions(list: Suggestion[], label: string)}
  <ul class="voicings suggestions" aria-label={label}>
    {#each list as s (s.numeral + s.chord)}
      {@const voicing = firstVoicing(s.chord, finderContext)}
      <li>
        <p class="suggested-chord">
          <span class="numeral muted">{s.numeral}</span>
          <span class="suggested">{s.chord}</span>
        </p>
        <p class="reason muted">{s.reason}</p>
        {#if voicing}
          <ChordDiagram {voicing} name={s.chord} />
          <div class="voicing-actions">
            <HearButton chord={s.chord} plucks={plucks(voicing.frets, finderContext)} />
            <button
              type="button"
              class="button quiet more"
              aria-label="More Voicings of {s.chord}"
              title="See every Voicing of {s.chord} in Look up"
              onclick={() => openInLookUp(s.chord)}>More Voicings</button
            >
          </div>
        {:else}
          <p class="no-voicing muted">No Voicing up to the 12th fret</p>
          <button
            type="button"
            class="button quiet more"
            aria-label="Look up {s.chord}"
            title="Look up {s.chord}"
            onclick={() => openInLookUp(s.chord)}>Look up</button
          >
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="card finder">
  <div class="tab-bar">
    <div class="tabs" role="tablist" aria-label="Chords">
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
      aria-pressed={leftHanded.value}
      onclick={() => leftHanded.set(!leftHanded.value)}
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
                  <ChordDiagram {voicing} name={found.name} />
                  <span class="rank muted">{preferred ? 'Preferred' : rank + 1}</span>
                  <div class="voicing-actions">
                    <HearButton chord={found.name} plucks={plucks(voicing.frets, finderContext)} />
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
                  </div>
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
            <Fretboard bind:frets={placed} />
            <div class="board-actions">
              <HearButton chord={placedName} plucks={placedPlucks} />
              <button type="button" class="button clear" onclick={() => (placed = nothingPlaced())}>Clear</button>
            </div>
          </div>
        </div>
      {:else}
        <div class="pick suggest-pick">
          <div class="field">
            <span id="finder-key-label">Key</span>
            <Picker
              id="finder-key"
              aria-labelledby="finder-key-label"
              options={keys}
              value={suggestKey}
              text={(key) => keyName(key) ?? key}
              onpick={pickKey}
            />
          </div>
          <div class="field">
            <span id="finder-after-label">After</span>
            <Picker
              id="finder-after"
              aria-labelledby="finder-after-label"
              options={[null, ...chords.map((c) => c.chord)]}
              value={after}
              text={(chord) => (chord ? chord + ' · ' + numeralOf.get(chord) : 'Any Chord')}
              onpick={(chord) => (after = chord)}
            />
          </div>
        </div>

        {#if suggested.kind === 'unreadable'}
          <p class="unknown">No Key I know is called “{suggested.key}”.</p>
        {:else}
          {#if after && suggested.follows}
            <section class="group" aria-live="polite">
              <h3>After {after}</h3>
              {#if suggested.follows.length}
                {@render suggestions(suggested.follows, 'Chords that usually follow ' + after + ', best first')}
              {:else}
                <p class="muted">Nothing usually follows {after} in {suggested.key}.</p>
              {/if}
            </section>
          {/if}
          {#each groups as g (g.kind)}
            <section class="group">
              <h3>{g.title}</h3>
              {@render suggestions(g.chords, g.title)}
            </section>
          {/each}
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .finder {
    container: finder / inline-size;
  }
  /* The tabs, and the left-handed setting at the end, on its own line on a narrow phone. */
  .tab-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .toggle {
    min-height: 2rem;
    margin-left: auto;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
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
    gap: var(--space-3);
  }
  @container finder (min-width: 40rem) {
    .pick {
      grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr));
    }
  }
  .name {
    grid-column: 1 / -1;
  }
  @container finder (min-width: 40rem) {
    .name {
      grid-column: auto;
    }
  }
  .field {
    min-width: 0;
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
    gap: var(--space-1) var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-2xl);
  }
  .notes {
    font-weight: 600;
    word-spacing: 0.25em;
  }
  .notes .muted {
    margin-right: var(--space-1);
    font-weight: normal;
    word-spacing: normal;
  }

  /* Two diagrams a row on a phone, big enough to read; four on desktop. */
  .voicings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @container finder (min-width: 40rem) {
    .voicings {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .voicings li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--bg);
  }
  .voicings :global(.diagram) {
    max-width: 9rem;
  }
  .rank {
    font-size: var(--text-sm);
  }
  .preferred {
    outline: 2px solid var(--accent);
  }
  .preferred .rank {
    color: var(--text);
    font-weight: 600;
  }
  /* A Voicing's buttons under its diagram, side by side, or one over the other on the narrowest phones. */
  .voicing-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
  }
  .prefer {
    min-height: 2rem;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }
  /*
   * Name it: what the shape reads as above the fretboard on a phone, so it
   * stays in view while fingers are placed; beside it on desktop.
   */
  .name-it {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  @container finder (min-width: 40rem) {
    .name-it {
      flex-direction: row-reverse;
      justify-content: flex-end;
      align-items: flex-start;
      gap: var(--space-8);
    }
  }
  .named {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    min-height: 4.5rem;
  }
  @container finder (min-width: 40rem) {
    .named {
      flex: 1;
    }
  }
  .readings {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .reading {
    min-height: 2rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .reading.best {
    min-height: var(--control);
    border-color: var(--accent);
    font-size: var(--text-2xl);
  }
  .reading:hover {
    border-color: var(--accent);
  }
  .board {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 22rem;
    align-self: center;
  }
  @container finder (min-width: 40rem) {
    .board {
      flex: 0 0 22rem;
      align-self: flex-start;
    }
  }
  /* Hear and Clear, side by side under the fretboard, at its right. */
  .board-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    align-self: flex-end;
  }
  /* Suggest: the Key and the Chord picked after, side by side. */
  @container finder (min-width: 40rem) {
    .suggest-pick {
      grid-template-columns: repeat(2, minmax(0, 12rem));
    }
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--text-lg);
  }
  /* Each suggestion is a card like a Voicing's in Look up, its diagram under its numeral, Chord and reason. */
  .suggestions li {
    justify-content: space-between;
    text-align: center;
  }
  .suggested-chord {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0 var(--space-2);
  }
  .numeral {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .suggested {
    font-size: var(--text-xl);
    font-weight: 600;
  }
  .reason,
  .no-voicing {
    font-size: var(--text-sm);
  }
  .no-voicing {
    flex: 1;
    display: flex;
    align-items: center;
  }
  .more {
    min-height: 2rem;
    font-size: var(--text-sm);
  }
  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
</style>
