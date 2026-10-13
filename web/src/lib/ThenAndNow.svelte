<script lang="ts">
  // A Snapshot beside the Song as it is now, Then | Now, so it's plain what
  // restoring it would change: the Lyric Sheet, then the Scrapbook, in two
  // columns lined up row by row (see snapshotDiff.ts). A Line that differs
  // is highlighted on each side it's on, and a Section on one side only
  // shows on that side alone. Lines are drawn as Read mode draws them,
  // Chords above the words, and can be selected and copied. Below 44rem of
  // its own width, the columns become two tabs, each hiding what's only on
  // the other side.
  import type { Snippet } from 'svelte';
  import ChordedLine from './ChordedLine.svelte';
  import { compareSheets, type SectionRow, type Sheet, type Side } from './snapshotDiff';

  let {
    then,
    now,
    when,
  }: {
    /** The Snapshot's sheet. */
    then: Sheet;
    /** The Song's, as saved. */
    now: Sheet;
    /** When the Snapshot was taken, e.g. "Today, 09:05". */
    when: string;
  } = $props();

  /** The side shown while the columns are tabs. */
  let shown = $state<Side>('then');

  const comparison = $derived(compareSheets(then, now));
  const parts = $derived([
    { name: 'Lyric Sheet', ...comparison.arrangement, empty: 'No Sections in the Lyric Sheet.' },
    { name: 'Scrapbook', ...comparison.scrapbook, empty: 'Nothing in the Scrapbook.' },
  ]);
  const sides: Side[] = ['then', 'now'];
  const names: Record<Side, string> = { then: 'This Snapshot', now: 'Now' };
</script>

<!-- One side of a row: what's on that side, or a gap holding its place. -->
{#snippet cell(side: Side, content: Snippet | false, differs = false)}
  {#if content}
    <div class="cell {side}" class:differs>
      {#if differs}<span class="visually-hidden">Differs:</span>{/if}{@render content()}
    </div>
  {:else}
    <div class="cell {side} empty"></div>
  {/if}
{/snippet}

{#snippet sectionRow(row: SectionRow)}
  <section
    class="grid"
    class:only-then={row.only === 'then'}
    class:only-now={row.only === 'now'}
    aria-label={(row.then ?? row.now)?.label || undefined}
  >
    {#if row.then?.label || row.now?.label}
      {#each sides as side (side)}
        {@const section = row[side]}
        {#snippet label()}<h4>{section?.label}</h4>{/snippet}
        {@render cell(side, !!section && label, row.labelDiffers)}
      {/each}
    {/if}
    {#if row.lines.length === 0}
      {#each sides as side (side)}
        {#snippet none()}<p class="muted">No Lines yet.</p>{/snippet}
        {@render cell(side, !!row[side] && none)}
      {/each}
    {/if}
    {#each row.lines as l, i (i)}
      {#each sides as side (side)}
        {@const line = l[side]}
        {#snippet chorded()}{#if line}<ChordedLine {line} sizes="body" />{/if}{/snippet}
        {@render cell(side, !!line && chorded, l.differs)}
      {/each}
    {/each}
  </section>
{/snippet}

<div class="frame">
  <div class="view" class:showing-now={shown === 'now'}>
    <div class="heads">
      <div class="tabs" role="tablist" aria-label="Which side">
        {#each sides as side (side)}
          <button type="button" role="tab" aria-selected={shown === side} onclick={() => (shown = side)}
            >{names[side]}</button
          >
        {/each}
      </div>
      <div class="grid columns">
        <strong class="cell then">This Snapshot, {when}</strong>
        <strong class="cell now">Now</strong>
      </div>
    </div>
    {#each parts as part (part.name)}
      <div class="part">
        <h3>{part.name}</h3>
        {#if part.rows.length === 0}
          <p class="muted">{part.empty}</p>
        {:else}
          {#if part.emptyOn.length > 0}
            <div class="grid">
              {#each sides as side (side)}
                {#snippet empty()}<p class="muted">{part.empty}</p>{/snippet}
                {@render cell(side, part.emptyOn.includes(side) && empty)}
              {/each}
            </div>
          {/if}
          {#each part.rows as row, i (i)}
            {@render sectionRow(row)}
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* The columns or the tabs go by the preview's own width, not the window's. */
  .frame {
    container-type: inline-size;
  }
  .view,
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  /* Which column is which stays in view as the Snapshot scrolls. */
  .heads {
    position: sticky;
    top: 0;
    z-index: 1;
    padding-bottom: var(--space-2);
    background: var(--bg);
  }
  .heads .tabs {
    display: none;
    border-bottom: 1px solid var(--border);
  }
  .columns {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* Then on the left, now on the right, row by row. */
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: var(--space-4);
  }
  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  /* A Label heads its Lines, muted as in Read mode. A blank one beside one
     that isn't still holds its row. */
  h4 {
    min-height: 1lh;
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-md);
    font-weight: 700;
  }
  p {
    margin: 0;
  }
  /* Holds its visually hidden "Differs:", which would otherwise stretch the
     dialog's scroll rather than the Snapshot's. */
  .cell {
    position: relative;
    padding: 0 var(--space-2);
    border-left: 2px solid transparent;
  }
  /* What restoring would change, on each side it's on. */
  .differs {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  /* Too narrow for two readable columns: one side at a time, by its tab,
     with nothing that's only on the other. */
  @container (width < 44rem) {
    .heads .tabs {
      display: flex;
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .columns,
    .empty,
    .view:not(.showing-now) :is(.now, .only-now),
    .showing-now :is(.then, .only-then) {
      display: none;
    }
  }
</style>
