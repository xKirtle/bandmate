<script lang="ts">
  import { api, type Song, type SongAt, type Status } from './api';
  import type { Square } from './cover';
  import CoverCrop from './CoverCrop.svelte';
  import CoverPlaceholder from './CoverPlaceholder.svelte';
  import { cropCover, openCover, type CoverToCrop } from './coverUpload';

  // The header's Cover placeholder in Write mode, as a button to pick a
  // picture for the Song's Cover, which then opens the crop step.
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

  let busy = $state<string | null>(null);
  let toCrop = $state<CoverToCrop | null>(null);

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
    await run('Opening…', async () => {
      toCrop = await openCover(file, await maxCoverBytes);
    });
  }

  async function add(picture: CoverToCrop, crop: Square) {
    toCrop = null;
    await run('Adding…', async () => {
      const cover = await cropCover(picture, crop);
      await change((at) => api.addCover(at, cover));
    });
  }

  async function run(label: string, work: () => Promise<void>) {
    busy = label;
    try {
      await work();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      busy = null;
    }
  }
</script>

<label class="add" class:busy={busy !== null} aria-busy={busy !== null}>
  <CoverPlaceholder {title} {status} size="header" />
  <span class="caption">{busy ?? 'Add Cover'}</span>
  <input class="visually-hidden" type="file" accept="image/*" onchange={pick} disabled={busy !== null || toCrop !== null} />
</label>

{#if toCrop}
  {@const picture = toCrop}
  <CoverCrop {picture} onConfirm={(crop) => add(picture, crop)} onCancel={() => (toCrop = null)} />
{/if}

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
