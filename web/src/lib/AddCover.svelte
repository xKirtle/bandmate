<script lang="ts">
  import { api, type Song, type SongAt, type Status } from './api';
  import CoverPlaceholder from './CoverPlaceholder.svelte';
  import { prepareCover } from './coverUpload';

  // The header's Cover placeholder in Write mode, as a button to pick a
  // picture for the Song's Cover.
  let {
    title,
    status,
    change,
    onError,
  }: {
    title: string;
    status: Status;
    /** Sends a change to the Song; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Shows why a picture couldn't be used. */
    onError: (message: string) => void;
  } = $props();

  let busy = $state(false);

  // The limit is checked on the picture chosen, before it's scaled down, so
  // it's waited for. Without it, the server still enforces its own.
  const maxCoverBytes = api.getConfig().then(
    (c) => c.maxCoverBytes,
    () => Infinity,
  );

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    try {
      const cover = await prepareCover(file, await maxCoverBytes);
      await change((at) => api.addCover(at, cover));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<label class="add" class:busy aria-busy={busy}>
  <CoverPlaceholder {title} {status} size="header" />
  <span class="caption">{busy ? 'Adding…' : 'Add Cover'}</span>
  <input class="visually-hidden" type="file" accept="image/*" onchange={pick} disabled={busy} />
</label>

<style>
  .add {
    position: relative;
    display: block;
    flex: none;
    border-radius: calc(var(--cover-header) * 0.18);
    cursor: pointer;
  }
  .add:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .busy {
    cursor: progress;
  }
  /* Along the bottom of the placeholder, over its initial's lower edge. */
  .caption {
    position: absolute;
    inset: auto 0 0;
    padding: 0.375rem 0;
    border-radius: 0 0 calc(var(--cover-header) * 0.18) calc(var(--cover-header) * 0.18);
    background: color-mix(in srgb, var(--surface-1) 85%, transparent);
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: center;
  }
  .add:hover .caption {
    background: var(--surface-1);
  }
</style>
