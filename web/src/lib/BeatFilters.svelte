<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Beat } from './api';
  import FilterButton from './FilterButton.svelte';
  import {
    beatKeys,
    beatProducers,
    bpmFilterLabel,
    isPicked,
    keyFilterLabel,
    pickChoices,
    producerFilterLabel,
    togglePick,
    useFilterLabel,
    type BeatListView,
    type BeatUse,
  } from './listViews';

  // The Beat Library's search and filter bar, which the Beat Picker shares:
  // a button per filter, each opening what it's picked with.
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

  const producers = $derived(pickChoices(beatProducers(beats), view.producers));
  const keys = $derived(pickChoices(beatKeys(beats), view.keys));

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

{#snippet checklist(name: string, choices: string[], picked: string[], pick: (next: string[]) => void, none: string)}
  {#if choices.length === 0}
    <p class="muted none">{none}</p>
  {:else}
    <fieldset class="choice-group checklist">
      <legend class="visually-hidden">{name}</legend>
      {#each choices as choice (choice)}
        <label class="choice-row">
          <input
            type="checkbox"
            checked={isPicked(picked, choice)}
            onchange={(e) => pick(togglePick(picked, choice, e.currentTarget.checked))}
          />
          {choice}
        </label>
      {/each}
    </fieldset>
  {/if}
{/snippet}

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
    {@render actions?.()}
  </div>
  <div class="filter-bar" role="group" aria-label="Filter Beats">
    <FilterButton name="Producer" label={producerFilterLabel(view.producers)} picked={view.producers.length > 0}>
      {@render checklist(
        'Producer',
        producers,
        view.producers,
        (next) => (view.producers = next),
        'No Beat has a producer.',
      )}
    </FilterButton>
    <FilterButton name="Key" label={keyFilterLabel(view.keys)} picked={view.keys.length > 0}>
      {@render checklist('Key', keys, view.keys, (next) => (view.keys = next), 'No Beat has a key.')}
    </FilterButton>
    <FilterButton
      name="BPM"
      label={bpmFilterLabel(view)}
      picked={view.bpmMin !== undefined || view.bpmMax !== undefined}
    >
      <fieldset class="bpm">
        <legend class="visually-hidden">BPM</legend>
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
    </FilterButton>
    <FilterButton name="Used" label={useFilterLabel(view.use)} picked={view.use !== undefined}>
      <fieldset class="choice-group">
        <legend class="visually-hidden">Used in a Song</legend>
        {#each uses as u (u.label)}
          <label class="choice-row">
            <input type="radio" name="{idPrefix}-use" checked={view.use === u.id} onchange={() => (view.use = u.id)} />
            {u.label}
          </label>
        {/each}
      </fieldset>
    </FilterButton>
  </div>
  {#if hint}
    <p class="hint muted">This Song: {hint}</p>
  {/if}
</search>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .search-row {
    display: flex;
    flex: 1 1 16rem;
    gap: var(--space-2);
    min-width: 0;
  }
  .search-row input {
    flex: 1;
    min-width: 0;
  }
  /* A long list of producers or keys scrolls, about six at a time. */
  .checklist {
    max-height: calc(6 * var(--control));
    overflow-y: auto;
    padding-inline-end: var(--space-2);
  }
  .none {
    margin: var(--space-2) 0;
  }
  .bpm {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) 0;
    border: 0;
  }
  .bpm input {
    width: 5.5rem;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
