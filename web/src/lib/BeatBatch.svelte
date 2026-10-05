<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, commonKeys, type Beat, type BeatDetails } from './api';
  import {
    alreadyIn,
    anyEdited,
    byFileName,
    canAdd,
    canTick,
    draftOnceRead,
    setOnTicked,
    tickedState,
    tickRange,
    type BatchRow,
    type SharedField,
  } from './beatBatch';
  import { fromDraft, invalidFields, invalidValue, toDraft, type InvalidField } from './beatDraft';
  import { suggestForFile } from './beatTags';
  import Combobox from './Combobox.svelte';
  import { guardLeaving } from './router.svelte';
  import { formatDuration } from './time';
  import { prepareUpload } from './upload';

  // Adding several Beats at once: a review table of the files picked, each
  // read in turn, then the ticked ones uploaded one at a time.
  let {
    library,
    maxUploadBytes,
    uploading = $bindable(false),
    playingRow = null,
    onPreview,
    onLeave,
    onAdded,
    onClose,
  }: {
    /** The Beats in the Library, to flag files that are probably already there. Null until it's loaded. */
    library: readonly Beat[] | null;
    maxUploadBytes: number;
    /** Whether Beats are being uploaded, when no more files can be picked. */
    uploading?: boolean;
    /** The key of the row whose file the preview player bar is playing now, if any. */
    playingRow?: number | null;
    /**
     * A row's play button was clicked, to preview its file, or pause or resume
     * it. Null where there's no preview player bar, and the rows have no play button.
     */
    onPreview: ((row: BatchRow) => void) | null;
    /** A row has left the table: removed, its Beat added, or the batch cancelled. */
    onLeave: (key: number) => void;
    /** A Beat was saved, and its row has left the table. */
    onAdded: (beat: Beat) => void;
    /** The batch is empty, all added, removed or cancelled. */
    onClose: () => void;
  } = $props();

  let rows = $state<BatchRow[]>([]);
  let nextKey = 0;

  /**
   * Adds files to the batch, in file name order, and reads them in turn. A
   * file that's probably already in the Library or the batch starts unticked.
   */
  export function append(files: readonly File[]) {
    const added = files.map((file): BatchRow => ({
      key: nextKey++,
      file,
      status: 'reading',
      decoded: null,
      suggested: toDraft(null),
      draft: toDraft(null),
      ticked: true,
      setWhileReading: {},
      error: null,
    }));
    const all = [...rows, ...added];
    for (const row of added) {
      if (library) row.ticked = !alreadyIn(row, library, all);
      else unchecked.push(row.key);
    }
    rows = all.sort(byFileName);
    readUnread();
  }

  // Files picked before the Library has loaded are ticked or not once it has.
  let unchecked: number[] = [];
  $effect(() => {
    if (!library || unchecked.length === 0) return;
    for (const row of rows) if (unchecked.includes(row.key)) row.ticked = !alreadyIn(row, library, rows);
    unchecked = [];
  });

  // Files are read one at a time, in the table's order. The count is of the
  // files read since reading last stopped, out of those plus the ones left.
  let reading = false;
  let readCount = $state(0);
  const unread = $derived(rows.filter((row) => row.status === 'reading').length);

  // Once the table is gone, nothing more is read.
  let destroyed = false;
  const nextUnread = () => (destroyed ? undefined : rows.find((row) => row.status === 'reading'));

  async function readUnread() {
    if (reading) return;
    reading = true;
    readCount = 0;
    for (let row = nextUnread(); row; row = nextUnread()) {
      const key = row.key;
      const file = row.file;
      let read: Partial<BatchRow>;
      try {
        const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes), suggestForFile(file)]);
        const draft = toDraft(suggestion);
        read = { status: 'ready', decoded, suggested: draft, draft };
      } catch (e) {
        read = { status: 'unreadable', ticked: false, error: (e as Error).message };
      }
      // It may have been removed while being read.
      const now = rows.find((r) => r.key === key);
      if (now) Object.assign(now, { ...read, draft: read.draft ? draftOnceRead(now, read.draft) : now.draft });
      readCount++;
    }
    reading = false;
    readCount = 0;
  }

  // Worked out afresh as the Library and the batch change: a copy of a row
  // that's since been added is then flagged as being in the Library.
  const already = $derived(new Map(rows.map((row) => [row.key, alreadyIn(row, library ?? [], rows)])));

  const ticked = $derived(tickedState(rows));
  const tickedCount = $derived(rows.filter((row) => row.ticked).length);
  const ready = $derived(canAdd(rows));

  function tickAll(on: boolean) {
    for (const row of rows) if (canTick(row)) row.ticked = on;
  }

  // Shift-clicking a tick box ticks or unticks the rows from the one clicked last.
  let lastClickedKey: number | null = null;

  function tickRow(row: BatchRow, event: MouseEvent & { currentTarget: HTMLInputElement }) {
    const on = event.currentTarget.checked;
    if (event.shiftKey && lastClickedKey !== null) tickRange(rows, lastClickedKey, row.key, on);
    else row.ticked = on;
    lastClickedKey = row.key;
  }

  // The bar above the table sets one field to one value on every ticked row.
  // Notes isn't a column: a Beat's own notes are edited once it's added.
  const sharedFields: {
    field: SharedField;
    label: string;
    placeholder: string;
    type?: 'url';
    inputmode?: 'numeric' | 'url';
  }[] = [
    { field: 'producer', label: 'Producer', placeholder: '—' },
    { field: 'sourceLink', label: 'Source link', placeholder: 'https://…', type: 'url', inputmode: 'url' },
    { field: 'bpm', label: 'BPM', placeholder: '—', inputmode: 'numeric' },
    { field: 'key', label: 'Key', placeholder: '—' },
    { field: 'notes', label: 'Notes', placeholder: 'License, where it’s from…' },
  ];
  let sharedField = $state<SharedField>('producer');
  let sharedValue = $state('');
  const shared = $derived(sharedFields.find((f) => f.field === sharedField)!);
  const sharedInvalid = $derived(invalidValue(sharedField, sharedValue));

  function setShared(event: SubmitEvent) {
    event.preventDefault();
    if (tickedCount === 0 || sharedInvalid) return;
    setOnTicked(rows, sharedField, sharedValue);
  }

  function remove(key: number) {
    rows = rows.filter((row) => row.key !== key);
    onLeave(key);
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
      // Add only starts once every ticked row's details are valid.
      const details = fromDraft(row.draft) as BeatDetails;
      row.error = null;
      try {
        const beat = await api.addBeat(row.file, details, row.decoded);
        rows = rows.filter((r) => r.key !== key);
        onLeave(key);
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
    const left = rows;
    rows = [];
    for (const row of left) onLeave(row.key);
    onClose();
  }

  // Closing or reloading the tab can't wait for the uploads, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (uploading) event.preventDefault();
  }

  // Going to another page in the app asks first too. Leaving anyway ends the
  // batch after the upload in progress, rather than carrying on unseen.
  onDestroy(
    guardLeaving(
      () => !uploading || confirm('Beats are still being added. Leave, and stop after the one uploading now?'),
    ),
  );
  onDestroy(() => {
    stopping = true;
    destroyed = true;
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
  <form class="shared" novalidate onsubmit={setShared}>
    <fieldset disabled={uploading}>
      <label>
        Set
        <select bind:value={sharedField} onchange={() => (sharedValue = '')}>
          {#each sharedFields as { field, label } (field)}
            <option value={field}>{label}</option>
          {/each}
        </select>
      </label>
      <label for="batch-shared-value">to</label>
      {#if sharedField === 'key'}
        <Combobox
          id="batch-shared-value"
          bind:value={sharedValue}
          options={commonKeys}
          saved=""
          autocomplete="off"
          autocapitalize="characters"
          placeholder="—"
        />
      {:else}
        <input
          id="batch-shared-value"
          bind:value={sharedValue}
          aria-invalid={sharedInvalid}
          type={shared.type ?? 'text'}
          inputmode={shared.inputmode}
          autocomplete="off"
          placeholder={shared.placeholder}
        />
      {/if}
      <button type="submit" class="button" disabled={tickedCount === 0 || sharedInvalid}>
        Set on {tickedCount} ticked
      </button>
    </fieldset>
  </form>
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
            {#if onPreview}
              <th class="preview"><span class="visually-hidden">Preview</span></th>
            {/if}
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
            {@const where = already.get(row.key)}
            <tr class:unreadable={row.status === 'unreadable'}>
              <td class="tick">
                <input
                  type="checkbox"
                  aria-label="Add “{name}”"
                  checked={row.ticked}
                  disabled={!canTick(row)}
                  onclick={(e) => tickRow(row, e)}
                />
              </td>
              {#if onPreview}
                <td class="preview">
                  {#if row.status === 'ready'}
                    {@const playing = playingRow === row.key}
                    <button
                      type="button"
                      class="icon"
                      aria-label="{playing ? 'Pause' : 'Preview'} “{name}”"
                      onclick={() => onPreview(row)}
                    >
                      {playing ? '❚❚' : '▶'}
                    </button>
                  {/if}
                </td>
              {/if}
              <td class="file">
                <span class="ellipsis" title={name}>{name}</span>
                {#if where}
                  <span class="warning">
                    {where.in === 'batch' ? 'Already in this batch' : `Already in the Beat Library as “${where.title}”`}
                  </span>
                {/if}
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
    gap: var(--space-3);
    margin-bottom: var(--space-6);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .head p {
    margin: 0;
  }
  .scroll {
    overflow-x: auto;
  }
  .shared fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .shared label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-md);
  }
  .shared :global(input) {
    width: 16rem;
  }
  /* Shift-clicking a tick box shouldn't select the text between. */
  td.tick {
    user-select: none;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }
  table {
    --checkbox: 1rem;
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-md);
  }
  th {
    padding: 0 var(--space-1) var(--space-1);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: var(--space-1);
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
    padding-top: calc(var(--space-1) + (var(--control) - 1lh) / 2);
  }
  td input:not([type='checkbox']),
  td :global(input) {
    min-height: var(--control);
    padding-inline: var(--space-2);
    font-size: var(--text-md);
  }
  .shared input[aria-invalid='true'],
  td input[aria-invalid='true'] {
    border-color: var(--danger);
    box-shadow: var(--invalid-outline);
  }
  input[type='checkbox'] {
    width: var(--checkbox);
    min-height: 0;
    height: var(--checkbox);
    margin: 0;
    accent-color: var(--accent);
  }
  .tick {
    width: 2rem;
    text-align: center;
  }
  td.tick {
    padding-top: calc((var(--control) - var(--checkbox)) / 2 + var(--space-1));
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
  .file .warning,
  .file .error {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-sm);
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
  .preview,
  .remove {
    width: calc(var(--control) + 0.5rem);
  }
  .file .warning {
    color: var(--warning);
  }
  tr.unreadable .file .ellipsis {
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .actions p {
    margin: 0;
  }
</style>
