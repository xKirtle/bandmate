<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Beat } from './api';
  import { toggleSort, type BeatColumn, type Sort } from './listViews';
  import { formatDuration, timeAgo } from './time';

  // Beats as the Library's desktop table, sorted by picking a column's header.
  // The Beat Library and the Beat picker share it; each says what its title
  // cell does, and what clicking a row does, if anything.
  let {
    beats,
    sort = $bindable(),
    title,
    lead,
    trail,
    openId = null,
    onRowClick,
  }: {
    /** Already filtered and sorted. */
    beats: readonly Beat[];
    sort: Sort<BeatColumn>;
    /** The title cell's content, e.g. a button that opens or picks the Beat. */
    title: Snippet<[Beat]>;
    /** A narrow first column, with its hidden header label, e.g. a preview button. */
    lead?: { label: string; cell: Snippet<[Beat]> };
    /** A last column, with its hidden header label, e.g. an Edit button. */
    trail?: { label: string; cell: Snippet<[Beat]> };
    /** The Beat whose row shows as open. */
    openId?: number | null;
    onRowClick?: (event: MouseEvent, beat: Beat) => void;
  } = $props();

  // Title fills the spare width up to 28rem and Producer up to its cap, and both
  // cut off with an ellipsis; BPM, Key, Duration and Added take their content's
  // width, and Used by takes whatever is left.
  const columns: { id: BeatColumn; label: string; num?: boolean }[] = [
    { id: 'title', label: 'Title' },
    { id: 'producer', label: 'Producer' },
    { id: 'bpm', label: 'BPM', num: true },
    { id: 'key', label: 'Key' },
    { id: 'duration', label: 'Duration', num: true },
    { id: 'usedBy', label: 'Used by' },
    { id: 'added', label: 'Added' },
  ];

  const sortState = (column: BeatColumn) =>
    sort.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
</script>

<table class="beats-table">
  <thead>
    <tr>
      {#if lead}
        <th class="lead"><span class="visually-hidden">{lead.label}</span></th>
      {/if}
      {#each columns as column (column.id)}
        <th class:num={column.num} aria-sort={sortState(column.id)}>
          <button type="button" onclick={() => (sort = toggleSort(sort, column.id))}>
            {column.label}<span class="arrow" aria-hidden="true"
              >{{ ascending: '↑', descending: '↓', none: '' }[sortState(column.id) ?? 'none']}</span
            >
          </button>
        </th>
      {/each}
      {#if trail}
        <th class="trail"><span class="visually-hidden">{trail.label}</span></th>
      {/if}
    </tr>
  </thead>
  <tbody>
    {#each beats as beat (beat.id)}
      {@const usedBy = beat.songs.map((s) => s.title).join(', ')}
      <tr
        class:open={beat.id === openId}
        class:clickable={onRowClick}
        onclick={onRowClick && ((event) => onRowClick(event, beat))}
      >
        {#if lead}
          <td class="lead">{@render lead.cell(beat)}</td>
        {/if}
        <td class="title"><span class="clip" title={beat.title}>{@render title(beat)}</span></td>
        <td class="producer">
          <span class="clip" title={beat.producer || undefined}>{beat.producer || '—'}</span>
        </td>
        <td class="num fit">{beat.bpm ?? '—'}</td>
        <td class="fit">{beat.key || '—'}</td>
        <td class="num fit">{formatDuration(beat.duration)}</td>
        <td><span class="clip" title={usedBy || undefined}>{usedBy || '—'}</span></td>
        <td class="muted fit"><time datetime={beat.createdAt}>{timeAgo(beat.createdAt)}</time></td>
        {#if trail}
          <td class="trail">{@render trail.cell(beat)}</td>
        {/if}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .beats-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  th {
    padding: 0;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  th button {
    width: 100%;
    min-height: var(--control);
    padding: 0 0.5rem;
    border: none;
    border-radius: 0.25rem;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: inherit;
    cursor: pointer;
  }
  th button:hover,
  th[aria-sort] button {
    color: var(--text);
  }
  .arrow {
    display: inline-block;
    width: 1em;
    margin-left: 0.25rem;
  }
  td {
    height: calc(var(--control) + 0.5rem);
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  /* A clipped cell's content adds nothing to its column's width, so the column
     is as wide as its own width says when there's room and shrinks when there
     isn't, rather than growing to fit a long title. */
  .clip {
    display: block;
    width: 0;
    min-width: 100%;
    overflow: clip;
    /* Room for a focused title button's outline. */
    overflow-clip-margin: 0.25rem;
    text-overflow: ellipsis;
  }
  td.title {
    width: 28rem;
    font-weight: 600;
  }
  td.producer {
    width: 12rem;
  }
  td.fit {
    width: 0;
  }
  td.title :global(button) {
    all: unset;
    /* A button stays one box on the line, so it cuts off its own title. */
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
    cursor: pointer;
  }
  td.title :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .lead {
    width: calc(var(--control) + 0.5rem);
    padding: 0 0.25rem;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .trail {
    width: calc(var(--control) + 0.5rem);
    padding: 0 0.25rem;
  }
  tbody tr.clickable {
    cursor: pointer;
  }
  tbody tr:hover,
  tbody tr:focus-within {
    background: var(--surface-1);
  }
  tbody tr.open {
    background: var(--surface-2);
    box-shadow: inset 3px 0 0 var(--accent);
  }
</style>
