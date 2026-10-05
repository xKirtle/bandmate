<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { TimelineLoop } from './api';
  import Dialog from './Dialog.svelte';
  import {
    levelsOf,
    mixdownFormats,
    mixdownName,
    mixdownRanges,
    mixdownRate,
    mixDown,
    readMixdownFormat,
    sampleBits,
    storeMixdownFormat,
    type MixdownFormat,
    type MixdownLevels,
    type MixdownPlan,
    type MixdownProgress,
    type MixdownRange,
  } from './mixdown';
  import { formatDuration } from './time';
  import { deviceStorage } from './timelineHeight';
  import { encodeWav } from './wav';

  // Mixes the whole Timeline, or the Loop's stretch of it, down to a file in
  // the format picked and downloads it, in a modal dialog: while it's
  // mixing, nothing else on the page can be used, and closing the dialog, or
  // leaving the Song page, cancels it.
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
    loop: TimelineLoop | null;
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
  const offered = untrack(() => mixdownRanges(end, loop));
  const ranges = offered.ranges;
  let chosen = $state.raw<MixdownRange>(offered.chosen);
  // The format picked, which this browser remembers.
  let format = $state.raw<MixdownFormat>(readMixdownFormat(deviceStorage()));
  const name = $derived(mixdownName(songTitle, chosen, format));
  const span = (range: MixdownRange) => `${formatDuration(range.start)}–${formatDuration(range.end)}`;

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
      levels = levelsOf(channels, sampleBits(format));
      const file = await encode(channels, cancel.signal);
      if (cancel.signal.aborted) return;
      save(file);
      phase = 'done';
    } catch (e) {
      if (cancel.signal.aborted) return;
      error = `Couldn't mix down (${(e as Error).message}).`;
      phase = 'ready';
    } finally {
      if (mixing === cancel) mixing = null;
    }
  }

  /** Encodes the Mixdown's file in the format picked, loading the MP3 encoder only once it's needed. */
  async function encode(channels: Float32Array[], signal: AbortSignal): Promise<Blob> {
    if (format.of === 'wav') return new Blob([encodeWav(channels, mixdownRate, format.bits)], { type: 'audio/wav' });
    progress = { step: 'encoding', done: 0 };
    const { encodeMp3 } = await import('./mp3');
    return encodeMp3(channels, mixdownRate, format.kbps, {
      signal,
      onProgress: (done) => (progress = { step: 'encoding', done }),
    });
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

  function pick(picked: MixdownFormat) {
    format = picked;
    storeMixdownFormat(deviceStorage(), picked);
  }

  function onclose() {
    mixing?.abort();
    onClose();
  }
</script>

<!-- A click outside closes it, but never while it's mixing: Cancel, or Esc, does. -->
<Dialog
  bind:dialog
  title="Mix down"
  close={phase === 'mixing' ? 'hidden' : 'shown'}
  dismissible={() => phase !== 'mixing'}
  {onclose}
>
  {#if phase === 'ready'}
    {#if ranges.length > 1}
      <fieldset class="choice-group">
        <legend>What to mix down</legend>
        {#each ranges as range (range.of)}
          <label class="choice-row">
            <input type="radio" name="mixdown-range" checked={chosen === range} onchange={() => (chosen = range)} />
            <span
              >{range.of === 'loop' ? 'Loop' : 'Whole Timeline'}
              <span class="times tabular">({span(range)})</span></span
            >
          </label>
        {/each}
      </fieldset>
      <p>As it plays now: each Track at its volume, with mute and solo as they are.</p>
    {:else}
      <p>
        The whole Timeline, <span class="tabular">0:00 to {formatDuration(end)}</span>, as it plays now: each Track at
        its volume, with mute and solo as they are.
      </p>
    {/if}
    <fieldset class="choice-group">
      <legend>Format</legend>
      {#each mixdownFormats as f (f.id)}
        <label class="choice-row">
          <input type="radio" name="mixdown-format" checked={format === f} onchange={() => pick(f)} />
          <span>{f.label}</span>
        </label>
      {/each}
    </fieldset>
    <p class="muted">Stereo at 48 kHz, downloaded as “{name}”.</p>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'mixing'}
    <p role="status" aria-live="polite">
      {progress.step === 'loading'
        ? 'Loading the audio…'
        : `${progress.step === 'mixing' ? 'Mixing down' : 'Encoding the MP3'}… ${Math.floor(progress.done * 100)}%`}
    </p>
    <!-- Without a value while loading: how long that takes isn't known. -->
    {#if progress.step !== 'loading'}
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
</Dialog>

<style>
  p {
    margin: 0;
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
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
