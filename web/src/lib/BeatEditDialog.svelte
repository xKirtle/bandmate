<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Beat } from './api';
  import BeatCredit from './BeatCredit.svelte';
  import BeatFields from './BeatFields.svelte';
  import { changedDetails, describeOffer, fromDraft, offeredChanges, toDraft, type BeatDraft } from './beatDraft';
  import { suggestForFile } from './beatTags';
  import { prepareUpload } from './upload';

  // Edits a Beat of the Beat Library in a dialog: its details, and, while no
  // Song uses it, its file and its deletion. Full-screen on a phone.
  let {
    beat,
    maxUploadBytes,
    onChange,
    onDelete,
    onClose,
  }: {
    beat: Beat;
    maxUploadBytes: number;
    onChange: (beat: Beat) => void;
    onDelete: (id: number) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  // Taken from the Beat as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  let draft = $state(toDraft(beat));
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  // Details a replaced file suggests, offered rather than applied.
  let offer = $state<{ fileName: string; changes: Partial<BeatDraft> } | null>(null);

  const inUse = $derived(beat.songs.length > 0);

  onMount(() => dialog?.showModal());

  function close() {
    dialog?.close();
  }

  // Esc doesn't close it halfway through saving, uploading or deleting. (A
  // browser may still let a repeated Esc through; the work then finishes
  // unseen.)
  function cancel(event: Event) {
    if (busy !== null) event.preventDefault();
  }

  function useOffer() {
    if (offer) Object.assign(draft, offer.changes);
    offer = null;
  }

  async function run(label: string, work: () => Promise<void>) {
    busy = label;
    error = null;
    try {
      await work();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const details = fromDraft(draft);
    if (typeof details === 'string') {
      error = details;
      return;
    }
    const changes = changedDetails(beat, details);
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    run('Saving…', async () => {
      onChange(await api.updateBeat(beat.id, changes));
      close();
    });
  }

  function replaceFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    offer = null;
    run('Reading file…', async () => {
      const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes), suggestForFile(file)]);
      busy = 'Uploading…';
      onChange(await api.replaceBeatFile(beat.id, file, decoded));
      const changes = offeredChanges(draft, suggestion);
      if (Object.keys(changes).length > 0) offer = { fileName: file.name, changes };
    });
  }

  function remove() {
    if (!confirm(`Delete “${beat.title}” and its file?\n\nThis can't be undone.`)) return;
    run('Deleting…', async () => {
      await api.deleteBeat(beat.id);
      close();
      onDelete(beat.id);
    });
  }
</script>

<dialog bind:this={dialog} onclose={onClose} oncancel={cancel} aria-labelledby="beat-edit-heading">
  <header>
    <div class="credit">
      <h2 id="beat-edit-heading">Edit “{beat.title}”</h2>
      <BeatCredit {beat} />
      {#if inUse}
        <p class="muted songs">Used in {beat.songs.map((s) => s.title).join(', ')}</p>
      {/if}
    </div>
    <button type="button" class="icon" onclick={close} aria-label="Close" disabled={busy !== null}>✕</button>
  </header>

  <form onsubmit={save}>
    {#if offer}
      <div class="offer" role="status">
        <p>“{offer.fileName}” suggests {describeOffer(offer.changes)}</p>
        <div class="actions">
          <button type="button" class="button" onclick={useOffer}>Use these</button>
          <button type="button" class="button" onclick={() => (offer = null)}>Keep current</button>
        </div>
      </div>
    {/if}
    <BeatFields bind:draft idPrefix="beat-edit" />
    <div class="footer">
      <div class="pair">
        <button type="submit" class="button primary" disabled={busy !== null}>Save</button>
        <button type="button" class="button" onclick={close} disabled={busy !== null}>Cancel</button>
      </div>
      {#if inUse}
        <p class="muted hint">Used by a Song, so its file can't be replaced or the Beat deleted.</p>
      {:else}
        <div class="pair">
          <label class="button" class:disabled={busy !== null}>
            Replace file
            <input class="visually-hidden" type="file" accept="audio/*" onchange={replaceFile} disabled={busy !== null} />
          </label>
          <button type="button" class="button danger" onclick={remove} disabled={busy !== null}>Delete</button>
        </div>
      {/if}
    </div>
  </form>

  {#if busy}
    <p class="muted" role="status">{busy}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(36rem, calc(100vw - 2rem));
    max-height: min(44rem, calc(100dvh - 2rem));
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  /* A phone gives the whole screen to it, clear of the notch and home
     indicator. */
  @media (width < 40rem) {
    dialog {
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      margin: 0;
      padding: max(1rem, env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right))
        max(1rem, env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
      border: none;
      border-radius: 0;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .credit {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
    overflow-wrap: anywhere;
  }
  .songs {
    margin: 0;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  /* Saving on the left, the file and deletion on the right. Each pair wraps
     as one, so a narrow dialog never leaves a button on a row of its own. */
  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .pair {
    display: flex;
    gap: 0.5rem;
  }
  /* On a phone, each pair takes a row, its two buttons sharing it evenly. */
  @media (width < 40rem) {
    .pair {
      flex: 1 1 100%;
    }
    .pair > * {
      flex: 1;
    }
  }
  .offer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .offer p {
    margin: 0;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .hint {
    margin: 0;
    font-size: 0.8125rem;
  }
  label.disabled {
    opacity: 0.6;
    cursor: default;
  }
  label.button:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  p[role] {
    margin: 0;
  }
</style>
