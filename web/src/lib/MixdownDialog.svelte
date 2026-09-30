<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { closeOnBackdrop } from './backdrop';
  import {
    levelsOf,
    mixdownName,
    mixdownRanges,
    mixdownRate,
    mixDown,
    type MixdownLevels,
    type MixdownPlan,
    type MixdownProgress,
    type MixdownRange,
  } from './mixdown';
  import { formatDuration } from './time';
  import { encodeWav } from './wav';

  // Mixes the whole Timeline, or the Loop's stretch of it, down to a WAV file
  // and downloads it, in a modal dialog: while it's mixing, nothing else on the page can be used,
  // and closing the dialog, or leaving the Song page, cancels it.
  let {
    songTitle,
    end,
    loop,
    plan,
    onStart,
    onClose,
  }: {
    songTitle: string;
    /** Where the whole Timeline's Mixdown ends, in seconds from 0:00. */
    end: number;
    /** The Song's Loop, if it has one, and whether it's on. */
    loop: { start: number; end: number; on: boolean } | null;
    /** What it mixes, as it stands when it starts. */
    plan: () => Pick<MixdownPlan, 'clips' | 'gains' | 'load'>;
    /** Hears the Mixdown start, e.g. to stop playback. */
    onStart: () => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'ready' | 'mixing' | 'done'>('ready');
  let progress = $state<MixdownProgress>({ step: 'loading' });
  let levels = $state<MixdownLevels | null>(null);
  let error = $state<string | null>(null);
  let mixing: AbortController | null = null;

  // What it can cover. Which is chosen isn't remembered: it follows the
  // Loop each time the dialog opens.
  const { ranges, chosen: first } = untrack(() => mixdownRanges(end, loop));
  let chosen = $state.raw<MixdownRange>(first);
  const name = $derived(mixdownName(songTitle, chosen));
  const span = (range: MixdownRange) => `${formatDuration(range.start)}–${formatDuration(range.end)}`;

  onMount(() => dialog?.showModal());
  onDestroy(() => mixing?.abort());

  async function start() {
    onStart();
    const cancel = new AbortController();
    mixing = cancel;
    phase = 'mixing';
    progress = { step: 'loading' };
    error = null;
    try {
      const audio = await mixDown({
        ...plan(),
        start: chosen.start,
        end: chosen.end,
        signal: cancel.signal,
        onProgress: (p) => (progress = p),
      });
      if (cancel.signal.aborted) return;
      const channels = [audio.getChannelData(0), audio.getChannelData(1)];
      levels = levelsOf(channels);
      save(new Blob([encodeWav(channels, mixdownRate)], { type: 'audio/wav' }));
      phase = 'done';
    } catch (e) {
      if (cancel.signal.aborted) return;
      error = `Couldn't mix down (${(e as Error).message}).`;
      phase = 'ready';
    } finally {
      if (mixing === cancel) mixing = null;
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
    mixing?.abort();
    onClose();
  }
</script>

<!-- A click outside closes it, but never while it's mixing: Cancel, or Esc, does. -->
<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => phase !== 'mixing')}
  {onclose}
  aria-labelledby="mixdown-heading"
>
  <header>
    <h2 id="mixdown-heading">Mix down</h2>
    {#if phase !== 'mixing'}
      <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'ready'}
    {#if ranges.length > 1}
      <fieldset>
        <legend>What to mix down</legend>
        {#each ranges as range (range.of)}
          <label>
            <input type="radio" name="mixdown-range" checked={chosen === range} onchange={() => (chosen = range)} />
            <span>{range.of === 'loop' ? 'Loop' : 'Whole Timeline'} <span class="times">({span(range)})</span></span>
          </label>
        {/each}
      </fieldset>
      <p>As it plays now: each Track at its volume, with mute and solo as they are.</p>
    {:else}
      <p>
        The whole Timeline, 0:00 to {formatDuration(end)}, as it plays now: each Track at its volume, with mute and solo
        as they are.
      </p>
    {/if}
    <p class="muted">A stereo 24-bit WAV at 48 kHz, downloaded as “{name}”.</p>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'mixing'}
    <p role="status" aria-live="polite">
      {progress.step === 'loading' ? 'Loading the audio…' : `Mixing down… ${Math.floor(progress.done * 100)}%`}
    </p>
    <!-- Without a value while loading: how long that takes isn't known. -->
    {#if progress.step === 'mixing'}
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
      <p class="problem">
        This Mixdown is silent throughout: {chosen.of === 'loop'
          ? 'is the Loop over no Clips, or are all its Tracks muted?'
          : 'are all its Tracks muted?'}
      </p>
    {/if}
  {/if}

  <div class="actions">
    {#if phase === 'ready'}
      <button type="button" class="button primary" onclick={start}>Mix down</button>
    {/if}
    {#if phase === 'done'}
      <button type="button" class="button primary" onclick={() => dialog?.close()}>Done</button>
    {:else}
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
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
  fieldset {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 0.375rem;
    padding: 0;
    font-weight: 600;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    cursor: pointer;
  }
  label input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    min-height: 0;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  .times {
    white-space: nowrap;
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
