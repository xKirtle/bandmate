<script lang="ts" module>
  import type { DecodedAudio, Fetched } from './api';
  import type { BeatDraft } from './beatDraft';

  /** A link's audio, fetched and read: ready for the adding form. */
  export interface FromLink {
    fetched: Fetched;
    /** The fetched audio, read once from the server. */
    file: File;
    decoded: DecodedAudio;
    /** The details the link and the file suggest. */
    draft: BeatDraft;
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from './api';
  import { toDraft } from './beatDraft';
  import { suggestFromLink } from './beatSuggestion';
  import { readTags } from './beatTags';
  import { prepareUpload } from './upload';

  // The box a link is pasted into. It fetches the link's audio on the
  // server, then reads it once, to decode it and read its tags as for an
  // upload, and hands it on to be added.
  let {
    maxUploadBytes,
    onFetched,
    onClose,
  }: {
    maxUploadBytes: number;
    onFetched: (fromLink: FromLink) => void;
    onClose: () => void;
  } = $props();

  let link = $state('');
  // What it's doing: a fetch, which can be cancelled, or reading what it fetched.
  let phase = $state<'idle' | 'fetching' | 'reading'>('idle');
  let error = $state<string | null>(null);
  // Stops the fetch, or reading what it fetched, whichever is under way.
  let busy: AbortController | null = null;

  const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

  async function fetchLink(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    phase = 'fetching';
    const stop = (busy = new AbortController());
    let fetched: Fetched;
    try {
      fetched = await api.fetchLink(link.trim(), stop.signal);
    } catch (e) {
      busy = null;
      phase = 'idle';
      if (!aborted(e)) error = (e as Error).message;
      return;
    }
    phase = 'reading';
    try {
      const file = await api.fetchedAudio(fetched, stop.signal);
      const [decoded, tags] = await Promise.all([prepareUpload(file, maxUploadBytes), readTags(file)]);
      if (stop.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      busy = null;
      onFetched({ fetched, file, decoded, draft: toDraft(suggestFromLink(fetched, tags)) });
    } catch (e) {
      // Nobody will add it now.
      api.discardFetched(fetched.id).catch(() => {});
      busy = null;
      phase = 'idle';
      if (!aborted(e)) error = (e as Error).message;
    }
  }

  /** Stops a fetch under way, deleting what it fetched, or closes the box. */
  function cancel() {
    if (busy) {
      busy.abort();
      return;
    }
    onClose();
  }

  // Leaving the page stops it too.
  onDestroy(() => busy?.abort());
</script>

<form class="card from-link" onsubmit={fetchLink} aria-labelledby="from-link-heading">
  <h2 id="from-link-heading">Add from link</h2>
  <label class="field" for="from-link-link">Link to one video</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    id="from-link-link"
    type="url"
    inputmode="url"
    autocomplete="off"
    placeholder="https://"
    required
    autofocus
    bind:value={link}
    disabled={phase !== 'idle'}
    aria-describedby="from-link-hint"
  />
  <p id="from-link-hint" class="muted hint">From YouTube, SoundCloud, Bandcamp and many more sites.</p>
  {#if phase === 'fetching'}
    <p role="status">Fetching…</p>
    <progress aria-label="Fetching the link's audio"></progress>
  {:else if phase === 'reading'}
    <p role="status">Reading the audio…</p>
    <progress aria-label="Reading the fetched audio"></progress>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <div class="actions">
    {#if phase === 'idle'}
      <button type="submit" class="button primary">Fetch</button>
    {/if}
    <button type="button" class="button" onclick={cancel}>Cancel</button>
  </div>
</form>

<style>
  .from-link {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
    padding: var(--space-4);
  }
  h2 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-lg);
  }
  p {
    margin: 0;
  }
  .hint {
    font-size: var(--text-sm);
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
