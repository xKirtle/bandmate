<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Beat } from './api';
  import { toggleSort, type BeatColumn, type Sort } from './listViews';
  import { formatDuration, timeAgo } from './time';

  // Beats as the Library's desktop table, sorted by picking a column's header.
  // The Beat Library and the Beat picker share it; each says what its title
  // cell does and what clicking a row does.
  let {
    beats,
    sort = $bindable(),
    title,
    lead,
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
    /** The Beat whose row shows as open. */
    openId?: number | null;
    onRowClick: (event: MouseEvent, beat: Beat) => void;
  } = $props();

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
    </tr>
  </thead>
  <tbody>
    {#each beats as beat (beat.id)}
      <tr class:open={beat.id === openId} onclick={(event) => onRowClick(event, beat)}>
        {#if lead}
          <td class="lead">{@render lead.cell(beat)}</td>
        {/if}
        <td class="title">{@render title(beat)}</td>
        <td>{beat.producer || '—'}</td>
        <td class="num">{beat.bpm ?? '—'}</td>
        <td>{beat.key || '—'}</td>
        <td class="num">{formatDuration(beat.duration)}</td>
        <td class="used-by">{beat.songs.map((s) => s.title).join(', ') || '—'}</td>
        <td class="muted"><time datetime={beat.createdAt}>{timeAgo(beat.createdAt)}</time></td>
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
  td.title {
    width: 100%;
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  td.title :global(button) {
    all: unset;
    cursor: pointer;
  }
  td.title :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  td.used-by {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lead {
    width: calc(var(--control) + 0.5rem);
    padding: 0 0.25rem;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tbody tr {
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
