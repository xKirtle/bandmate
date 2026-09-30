<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { closeOnBackdrop } from './backdrop';
  import {
    levelsOf,
    mixdownName,
    mixdownRate,
    renderMixdown,
    type MixdownLevels,
    type MixdownPlan,
    type MixdownProgress,
  } from './mixdown';
  import { formatDuration } from './time';
  import { encodeWav } from './wav';

  // Mixes the whole Timeline down to a WAV file and downloads it, in a
  // modal dialog: while it renders, nothing else on the page can be used,
  // and closing the dialog, or leaving the Song page, cancels it.
  let {
    songTitle,
    end,
    plan,
    onStart,
    onClose,
  }: {
    songTitle: string;
    /** Where the Mixdown ends, in seconds from 0:00. */
    end: number;
    /** What it renders, as it stands when it starts. */
    plan: () => Pick<MixdownPlan, 'clips' | 'gains' | 'load'>;
    /** Hears a render start, e.g. to stop playback. */
    onStart: () => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'ready' | 'rendering' | 'done'>('ready');
  let progress = $state<MixdownProgress>({ stage: 'loading' });
  let levels = $state<MixdownLevels | null>(null);
  let error = $state<string | null>(null);
  let rendering: AbortController | null = null;

  const name = $derived(mixdownName(songTitle));

  onMount(() => dialog?.showModal());
  onDestroy(() => rendering?.abort());

  async function mixDown() {
    onStart();
    const cancel = new AbortController();
    rendering = cancel;
    phase = 'rendering';
    progress = { stage: 'loading' };
    error = null;
    try {
      const audio = await renderMixdown({
        ...plan(),
        end,
        signal: cancel.signal,
        onProgress: (p) => (progress = p),
      });
      const channels = [audio.getChannelData(0), audio.getChannelData(1)];
      if (cancel.signal.aborted) return;
      levels = levelsOf(channels);
      save(new Blob([encodeWav(channels, mixdownRate)], { type: 'audio/wav' }));
      phase = 'done';
    } catch (e) {
      if (cancel.signal.aborted) return;
      error = `Couldn't mix down (${(e as Error).message}).`;
      phase = 'ready';
    } finally {
      if (rendering === cancel) rendering = null;
    }
  }

  /** Downloads the Mixdown's file. */
  function save(file: Blob) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    // Once the download has had it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function onclose() {
    rendering?.abort();
    onClose();
  }
</script>

<!-- A click outside closes it, but never while it renders: Cancel, or Esc, does. -->
<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => phase !== 'rendering')}
  {onclose}
  aria-labelledby="mixdown-heading"
>
  <header>
    <h2 id="mixdown-heading">Mix down</h2>
    {#if phase !== 'rendering'}
      <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'ready'}
    <p>
      The whole Timeline, 0:00 to {formatDuration(end)}, as it plays now: each Track at its volume, with mute and solo
      as they are.
    </p>
    <p class="muted">A stereo 24-bit WAV at 48 kHz, downloaded as “{name}”.</p>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'rendering'}
    <p role="status" aria-live="polite">
      {progress.stage === 'loading' ? 'Loading the audio…' : `Mixing down… ${Math.floor(progress.done * 100)}%`}
    </p>
    <!-- Without a value while loading: how long that takes isn't known. -->
    {#if progress.stage === 'mixing'}
      <progress max="1" value={progress.done} aria-label="How far the Mixdown has got"></progress>
    {:else}
      <progress aria-label="How far the Mixdown has got"></progress>
    {/if}
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else}
    <p role="status">Downloaded “{name}”.</p>
    {#if levels?.clips}
      <p class="problem">This Mixdown clips: turn some Tracks down.</p>
    {:else if levels?.silent}
      <p class="problem">This Mixdown is silent throughout: are all its Tracks muted?</p>
    {/if}
  {/if}

  <div class="actions">
    {#if phase === 'ready'}
      <button type="button" class="button primary" onclick={mixDown}>Mix down</button>
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
    {:else if phase === 'rendering'}
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
    {:else}
      <button type="button" class="button primary" onclick={() => dialog?.close()}>Done</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
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
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  p {
    margin: 0;
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .problem {
    color: var(--danger);
  }
  .muted {
    font-size: 0.875rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
