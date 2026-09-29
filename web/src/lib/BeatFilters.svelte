<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { Beat } from './api';
  import Picker from './Picker.svelte';
  import { beatDrawerFilterCount, beatKeys, beatProducers, type BeatListView, type BeatUse } from './listViews';

  // The Beat Library's search and filters, which the Beat picker shares.
  // Below 80rem the filters other than the search sit in a drawer, which
  // starts closed unless one is set; from 80rem they sit beside the search.
  let {
    view = $bindable(),
    beats,
    idPrefix,
    hint,
    actions,
  }: {
    view: BeatListView;
    /** The Beats the producer and key choices come from. */
    beats: readonly Beat[];
    /** Makes the fields' ids unique on the page. */
    idPrefix: string;
    /** Shown beside the filters, e.g. the Song's BPM and key; never applied. */
    hint?: string;
    /** Buttons beside the search. */
    actions?: Snippet;
  } = $props();

  const producers = $derived(withChosen(beatProducers(beats), view.producer));
  const keys = $derived(withChosen(beatKeys(beats), view.key));

  /** The choices for a filter, keeping the chosen one even if no Beat has it now. */
  function withChosen(choices: string[], chosen: string | undefined): string[] {
    return chosen && !choices.some((c) => c.toLowerCase() === chosen.trim().toLowerCase())
      ? [chosen, ...choices]
      : choices;
  }

  // A filter's choices start with "Any", which clears it.
  const anyOr = (choice: string) => choice || 'Any';

  const drawerCount = $derived(beatDrawerFilterCount(view));
  let drawerOpen = $state(untrack(() => drawerCount > 0));

  function setBpm(end: 'bpmMin' | 'bpmMax', event: Event) {
    const bpm = (event.currentTarget as HTMLInputElement).valueAsNumber;
    view[end] = Number.isFinite(bpm) && bpm >= 0 ? bpm : undefined;
  }

  const uses: { id: BeatUse | undefined; label: string }[] = [
    { id: undefined, label: 'All' },
    { id: 'used', label: 'Used' },
    { id: 'unused', label: 'Not used' },
  ];
</script>

<search class="filters">
  <div class="search-row">
    <label class="visually-hidden" for="{idPrefix}-search">Search Beats by title or producer</label>
    <input
      id="{idPrefix}-search"
      type="search"
      bind:value={view.q}
      placeholder="Search titles and producers"
      autocomplete="off"
      enterkeyhint="search"
    />
    <button
      type="button"
      class="button drawer-toggle"
      aria-expanded={drawerOpen}
      aria-controls="{idPrefix}-filters"
      onclick={() => (drawerOpen = !drawerOpen)}
    >
      Filters{#if drawerCount > 0}<span class="count">{drawerCount}</span>{/if}
    </button>
    {@render actions?.()}
  </div>
  <div id="{idPrefix}-filters" class="drawer" class:open={drawerOpen}>
    <div class="field">
      <span id="{idPrefix}-producer-label">Producer</span>
      <Picker
        id="{idPrefix}-producer"
        aria-labelledby="{idPrefix}-producer-label"
        options={['', ...producers]}
        value={view.producer ?? ''}
        label={anyOr}
        onpick={(v) => (view.producer = v || undefined)}
      />
    </div>
    <fieldset class="field bpm">
      <legend>BPM</legend>
      <label class="visually-hidden" for="{idPrefix}-bpm-min">Lowest BPM</label>
      <input
        id="{idPrefix}-bpm-min"
        type="number"
        inputmode="decimal"
        min="0"
        placeholder="From"
        value={view.bpmMin ?? ''}
        oninput={(e) => setBpm('bpmMin', e)}
      />
      <span aria-hidden="true">–</span>
      <label class="visually-hidden" for="{idPrefix}-bpm-max">Highest BPM</label>
      <input
        id="{idPrefix}-bpm-max"
        type="number"
        inputmode="decimal"
        min="0"
        placeholder="To"
        value={view.bpmMax ?? ''}
        oninput={(e) => setBpm('bpmMax', e)}
      />
    </fieldset>
    <div class="field">
      <span id="{idPrefix}-key-label">Key</span>
      <Picker
        id="{idPrefix}-key"
        aria-labelledby="{idPrefix}-key-label"
        options={['', ...keys]}
        value={view.key ?? ''}
        label={anyOr}
        onpick={(v) => (view.key = v || undefined)}
      />
    </div>
    <div class="chips" role="group" aria-label="Used in a Song">
      {#each uses as u (u.label)}
        <button type="button" class="chip" aria-pressed={view.use === u.id} onclick={() => (view.use = u.id)}>
          {u.label}
        </button>
      {/each}
    </div>
  </div>
  {#if hint}
    <p class="hint muted">This Song: {hint}</p>
  {/if}
</search>

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .search-row {
    display: flex;
    gap: 0.5rem;
  }
  .search-row input {
    flex: 1;
    min-width: 0;
  }
  .drawer-toggle {
    flex-shrink: 0;
    gap: 0.375rem;
  }
  .count {
    min-width: 1.25rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.75rem;
    line-height: 1.25rem;
  }
  .drawer {
    display: none;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .drawer.open {
    display: flex;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 8rem;
    margin: 0;
    padding: 0;
    border: none;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .bpm {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .bpm legend {
    width: 100%;
    margin-bottom: 0.25rem;
    padding: 0;
  }
  .bpm input {
    width: 5.5rem;
    color: var(--text);
    font-weight: 400;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    min-height: var(--control);
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .hint {
    margin: 0;
    font-size: 0.8125rem;
  }

  /* Desktop has room for every filter beside the search, with no drawer. */
  @media (min-width: 80rem) {
    .filters {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
    }
    .search-row {
      flex: 1 1 16rem;
    }
    .drawer-toggle {
      display: none;
    }
    .drawer {
      display: flex;
      padding: 0;
      border: none;
      background: none;
    }
    .chip {
      background: var(--surface-1);
    }
    .hint {
      align-self: center;
    }
  }
</style>
