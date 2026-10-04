<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, commonKeys, type Beat } from './api';
  import {
    anyEdited,
    byFileName,
    canAdd,
    canTick,
    invalidFields,
    tickedState,
    type BatchRow,
    type InvalidField,
  } from './beatBatch';
  import { fromDraft, toDraft } from './beatDraft';
  import { suggestForFile } from './beatTags';
  import Combobox from './Combobox.svelte';
  import { formatDuration } from './time';
  import { prepareUpload } from './upload';

  // Adding several Beats at once: a review table of the files picked, each
  // read in turn, then the ticked ones uploaded one at a time.
  let {
    maxUploadBytes,
    uploading = $bindable(false),
    onAdded,
    onClose,
  }: {
    maxUploadBytes: number;
    /** Whether Beats are being uploaded, when no more files can be picked. */
    uploading?: boolean;
    /** A Beat was saved, and its row has left the table. */
    onAdded: (beat: Beat) => void;
    /** The batch is empty, all added, removed or cancelled. */
    onClose: () => void;
  } = $props();

  let rows = $state<BatchRow[]>([]);
  let nextKey = 0;

  /** Adds files to the batch, in file name order, and reads them in turn. */
  export function append(files: readonly File[]) {
    const added = files.map((file): BatchRow => ({
      key: nextKey++,
      file,
      status: 'reading',
      decoded: null,
      suggested: toDraft(null),
      draft: toDraft(null),
      ticked: true,
      error: null,
    }));
    rows = [...rows, ...added].sort(byFileName);
    readAll();
  }

  // Files are read one at a time, in the table's order. The count is of the
  // files read since reading last stopped, out of those plus the ones left.
  let reading = false;
  let readCount = $state(0);
  const unread = $derived(rows.filter((row) => row.status === 'reading').length);

  async function readAll() {
    if (reading) return;
    reading = true;
    readCount = 0;
    for (let row = rows.find((r) => r.status === 'reading'); row; row = rows.find((r) => r.status === 'reading')) {
      const key = row.key;
      const file = row.file;
      let read: Partial<BatchRow>;
      try {
        const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes), suggestForFile(file)]);
        const draft = toDraft(suggestion);
        read = { status: 'ready', decoded, suggested: draft, draft: { ...draft } };
      } catch (e) {
        read = { status: 'unreadable', ticked: false, error: (e as Error).message };
      }
      // It may have been removed while being read.
      const now = rows.find((r) => r.key === key);
      if (now) Object.assign(now, read);
      readCount++;
    }
    reading = false;
    readCount = 0;
  }

  const ticked = $derived(tickedState(rows));
  const tickedCount = $derived(rows.filter((row) => row.ticked).length);
  const ready = $derived(canAdd(rows));

  function tickAll(on: boolean) {
    for (const row of rows) if (canTick(row)) row.ticked = on;
  }

  function remove(key: number) {
    rows = rows.filter((row) => row.key !== key);
    if (rows.length === 0) onClose();
  }

  // Adding uploads the ticked rows in the table's order, one at a time.
  let addCount = $state(0);
  let addTotal = $state(0);
  let stopping = $state(false);

  async function add() {
    if (!ready || uploading) return;
    const queue = rows.filter((row) => row.ticked).map((row) => row.key);
    uploading = true;
    stopping = false;
    addTotal = queue.length;
    for (const [i, key] of queue.entries()) {
      if (stopping) break;
      const row = rows.find((r) => r.key === key);
      if (!row || !row.decoded) continue;
      addCount = i + 1;
      const details = fromDraft(row.draft);
      if (typeof details === 'string') {
        row.error = details;
        continue;
      }
      row.error = null;
      try {
        const beat = await api.addBeat(row.file, details, $state.snapshot(row.decoded));
        rows = rows.filter((r) => r.key !== key);
        onAdded(beat);
      } catch (e) {
        const failed = rows.find((r) => r.key === key);
        if (failed) failed.error = (e as Error).message;
      }
    }
    uploading = false;
    stopping = false;
    if (rows.length === 0) onClose();
  }

  function cancel() {
    if (anyEdited(rows) && !confirm('Cancel adding these Beats? The details you typed will be lost.')) return;
    rows = [];
    onClose();
  }

  // Closing or reloading the tab can't wait for the uploads, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (uploading) event.preventDefault();
  }

  // Leaving the Library within the app ends the batch after the upload in
  // progress, rather than carrying on unseen.
  onDestroy(() => {
    stopping = true;
  });

  const marked = (row: BatchRow, field: InvalidField) =>
    row.status === 'ready' && invalidFields(row.draft).includes(field);
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

<section class="batch" aria-labelledby="batch-heading">
  <div class="head">
    <h2 id="batch-heading">Add Beats</h2>
    {#if unread > 0}
      <p class="muted" role="status">Reading {readCount + 1} of {readCount + unread}</p>
    {/if}
  </div>
  <div class="scroll">
    <fieldset disabled={uploading}>
      <table>
        <thead>
          <tr>
            <th class="tick">
              <input
                type="checkbox"
                aria-label="Tick every file"
                checked={ticked === 'all'}
                indeterminate={ticked === 'some'}
                disabled={!rows.some(canTick)}
                onchange={(e) => tickAll(e.currentTarget.checked)}
              />
            </th>
            <th>File</th>
            <th class="num">Duration</th>
            <th>Title</th>
            <th>Producer</th>
            <th>BPM</th>
            <th>Key</th>
            <th>Source link</th>
            <th class="remove"><span class="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.key)}
            {@const name = row.file.name}
            {@const editable = row.status === 'ready'}
            <tr class:unreadable={row.status === 'unreadable'}>
              <td class="tick">
                <input type="checkbox" aria-label="Add “{name}”" bind:checked={row.ticked} disabled={!canTick(row)} />
              </td>
              <td class="file">
                <span class="ellipsis" title={name}>{name}</span>
                {#if row.error}
                  <span class="error">{row.error}</span>
                {/if}
              </td>
              <td class="num muted">
                {#if row.decoded}
                  {formatDuration(row.decoded.duration)}
                {:else if row.status === 'reading'}
                  Reading…
                {:else}
                  —
                {/if}
              </td>
              <td class="title">
                <input
                  bind:value={row.draft.title}
                  aria-label="Title of “{name}”"
                  aria-invalid={marked(row, 'title')}
                  disabled={!editable}
                  autocomplete="off"
                />
              </td>
              <td class="producer">
                <input
                  bind:value={row.draft.producer}
                  aria-label="Producer of “{name}”"
                  disabled={!editable}
                  autocomplete="off"
                  placeholder="—"
                />
              </td>
              <td class="bpm">
                <input
                  bind:value={row.draft.bpm}
                  aria-label="BPM of “{name}”"
                  aria-invalid={marked(row, 'bpm')}
                  disabled={!editable}
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="—"
                />
              </td>
              <td class="key">
                <Combobox
                  id="batch-key-{row.key}"
                  bind:value={row.draft.key}
                  options={commonKeys}
                  saved=""
                  aria-label="Key of “{name}”"
                  disabled={!editable}
                  autocomplete="off"
                  autocapitalize="characters"
                  placeholder="—"
                />
              </td>
              <td class="link">
                <input
                  bind:value={row.draft.sourceLink}
                  aria-label="Source link of “{name}”"
                  aria-invalid={marked(row, 'sourceLink')}
                  disabled={!editable}
                  type="url"
                  inputmode="url"
                  autocomplete="off"
                  placeholder="https://…"
                />
              </td>
              <td class="remove">
                <button type="button" class="icon" aria-label="Remove “{name}”" onclick={() => remove(row.key)}>
                  ✕
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </fieldset>
  </div>
  <div class="actions">
    {#if uploading}
      <button type="button" class="button" onclick={() => (stopping = true)} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
      <p class="muted" role="status">Adding {addCount} of {addTotal}</p>
    {:else}
      <button type="button" class="button primary" onclick={add} disabled={!ready}>
        Add {tickedCount}
        {tickedCount === 1 ? 'Beat' : 'Beats'}
      </button>
      <button type="button" class="button" onclick={cancel}>Cancel</button>
    {/if}
  </div>
</section>

<style>
  .batch {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  .head p {
    margin: 0;
  }
  .scroll {
    overflow-x: auto;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  th {
    padding: 0 0.25rem 0.25rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: 0.25rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  td.num,
  th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  td.num,
  td.file {
    padding-top: calc(0.25rem + (var(--control) - 1.25rem) / 2);
  }
  td input:not([type='checkbox']),
  td :global(input) {
    min-height: var(--control);
    padding-inline: 0.5rem;
    font-size: 0.875rem;
  }
  td input[aria-invalid='true'] {
    border-color: var(--danger);
    box-shadow: inset 0 0 0 1px var(--danger);
  }
  input[type='checkbox'] {
    width: 1rem;
    min-height: 0;
    height: 1rem;
    margin: 0;
    accent-color: var(--accent);
  }
  .tick {
    width: 2rem;
    text-align: center;
  }
  td.tick {
    padding-top: calc((var(--control) - 1rem) / 2 + 0.25rem);
  }
  .file {
    width: 16rem;
    max-width: 16rem;
  }
  .ellipsis {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file .error {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.8125rem;
  }
  .title {
    min-width: 12rem;
  }
  .producer,
  .link {
    min-width: 9rem;
  }
  .bpm {
    width: 4.5rem;
    min-width: 4.5rem;
  }
  .key {
    width: 6rem;
    min-width: 6rem;
  }
  .remove {
    width: calc(var(--control) + 0.5rem);
  }
  tr.unreadable .file .ellipsis {
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .actions p {
    margin: 0;
  }
</style>
