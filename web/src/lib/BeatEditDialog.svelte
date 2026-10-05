<script lang="ts">
  import { api, type Beat } from './api';
  import BeatCredit from './BeatCredit.svelte';
  import BeatFields from './BeatFields.svelte';
  import Dialog from './Dialog.svelte';
  import {
    changedDetails,
    describeOffer,
    fromDraft,
    offeredChanges,
    toDraft,
    type BeatDraft,
    wouldLoseEdits,
  } from './beatDraft';
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
  // The details as last saved: taken from the Beat as the dialog opens, and
  // again once its file is replaced. Read only on a click outside, so not
  // state.
  // svelte-ignore state_referenced_locally
  let saved = toDraft(beat);
  // Taken from the Beat as the dialog opens, and not followed after.
  let draft = $state({ ...saved });
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  // Details a replaced file suggests, offered rather than applied.
  let offer = $state<{ fileName: string; changes: Partial<BeatDraft> } | null>(null);

  const inUse = $derived(beat.songs.length > 0);

  function close() {
    dialog?.close();
  }

  // Esc doesn't close it halfway through saving, uploading or deleting. (A
  // browser may still let a repeated Esc through; the work then finishes
  // unseen.)
  function cancel(event: Event) {
    if (busy !== null) event.preventDefault();
  }

  // A click outside closes it only while nothing has been changed since it
  // opened or its file was replaced, no suggested details are waiting, and
  // nothing is being saved, uploaded or deleted.
  const nothingToLose = () => busy === null && !wouldLoseEdits(draft, saved, offer?.changes ?? null);

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
      const updated = await api.replaceBeatFile(beat.id, file, decoded);
      onChange(updated);
      // As if it had just opened on the new file.
      saved = toDraft(updated);
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

<Dialog
  bind:dialog
  title="Edit “{beat.title}”"
  closeButton={busy === null ? 'shown' : 'disabled'}
  dismissible={nothingToLose}
  sheet
  onclose={onClose}
  oncancel={cancel}
  --dialog-width="36rem"
  --dialog-max-height="min(44rem, calc(100dvh - 2rem))"
>
  {#snippet detail()}
    <BeatCredit {beat} />
    {#if inUse}
      <p class="muted songs">Used in {beat.songs.map((s) => s.title).join(', ')}</p>
    {/if}
  {/snippet}

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
    <BeatFields bind:draft idPrefix="beat-edit" savedKey={beat.key} />
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
            <input
              class="visually-hidden"
              type="file"
              accept="audio/*"
              onchange={replaceFile}
              disabled={busy !== null}
            />
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
</Dialog>

<style>
  .songs {
    margin: 0;
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  /* Saving on the left, the file and deletion on the right. Each pair wraps
     as one, so a narrow dialog never leaves a button on a row of its own. */
  .footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .pair {
    display: flex;
    gap: var(--space-2);
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
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  .offer p {
    margin: 0;
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
  }
  p[role] {
    margin: 0;
  }
</style>
