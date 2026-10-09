<script lang="ts">
  import { onDestroy } from 'svelte';
  import { clickCount, clickTimes, formatOffset, measureOffset, type Measurement } from './calibration';
  import { Capture, CaptureError } from './capture';
  import Dialog from './Dialog.svelte';
  import { channelName, inputName, type InputChoice } from './inputSettings';
  import { RecordedInput } from './recordedInput.svelte';
  import { calibrations } from './sharedCalibration.svelte';
  import { audioContext } from './timelinePlayer';

  // Calibrates an Input's Latency Offset in a dialog, naming the Input:
  // clicks play, the user taps or claps on the mic along with them, and the
  // delay found is shown, and kept for the Input it was measured on. Offered
  // before an Input's first recording, where it can be skipped, for that
  // Input, to record straight away; also run from the recording settings
  // and Settings.
  let {
    input,
    offer = false,
    onSkip,
    onClose,
  }: {
    /** The Input to calibrate, as chosen: the default input is calibrated as the Input it turns out to be. */
    input: InputChoice;
    /** Whether it's offered before recording, so it can be skipped, and records once done. */
    offer?: boolean;
    /** Hears calibration skipped, to record straight away. */
    onSkip?: () => void;
    /** Hears it closed, and whether to record now. */
    onClose: (record: boolean) => void;
  } = $props();

  // The Input measured, once it's open; until then, the one it will be, where that can be told.
  let measuring = $state.raw<InputChoice | null>(null);
  const expected = new RecordedInput(() => input);
  const calibrated = $derived(measuring ?? expected.current);
  const name = $derived(calibrated ? channelName(calibrated.label, calibrated.channel) : inputName(input));

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'ready' | 'measuring' | 'done'>('ready');
  // Which click is playing, from 1, while measuring.
  let currentClick = $state(0);
  let result = $state<Measurement | null>(null);
  let error = $state<string | null>(null);
  let record = false;

  let capture: Capture | null = null;
  let clickNodes: OscillatorNode[] = [];
  let timer = 0;
  // Each measuring, so one cancelled finds nothing to show.
  let generation = 0;

  onDestroy(stopMeasuring);

  /** Plays a click at a context time: a short, bright blip. */
  function playClick(context: AudioContext, at: number) {
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 1500;
    gain.gain.setValueAtTime(0.6, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    tone.connect(gain).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.05);
    clickNodes.push(tone);
  }

  async function measure() {
    const context = audioContext();
    // Resumed while the click that started it still counts.
    const resumed = context.resume().catch(() => {});
    stopMeasuring();
    const mine = generation;
    phase = 'measuring';
    currentClick = 0;
    result = null;
    error = null;
    try {
      await resumed;
      const opened = await Capture.open(context, $state.snapshot(input));
      if (mine !== generation) return opened.close();
      capture = opened;
      // Where the browser doesn't say which Input it opened, the one it looked to be.
      measuring = opened.opened ?? expected.current;
      if (opened.opened) calibrations.opened($state.snapshot(input), opened.opened);
      // A moment on, so the first click is scheduled clear of now.
      const from = context.currentTime + 0.1;
      const times = clickTimes();
      for (const t of times) playClick(context, from + t);
      timer = window.setInterval(() => {
        const played = times.filter((t) => from + t <= context.currentTime).length;
        currentClick = Math.max(1, played);
      }, 50);
      // Until the last click's hit has had time to be heard.
      const end = from + times.at(-1)! + 0.6;
      await new Promise((resolve) => setTimeout(resolve, (end - context.currentTime) * 1000));
      if (mine !== generation) return;
      window.clearInterval(timer);
      const samples = await opened.stop(from);
      capture = null;
      if (mine !== generation) return;
      const found = measureOffset(samples, opened.sampleRate, times);
      if (found.ok && !measuring) {
        throw new CaptureError("The browser didn't say which input it measured, so nothing was kept.");
      }
      result = found;
      // Applied even where storage can't keep it, until reload.
      if (result.ok && measuring) calibrations.set(measuring, { offset: result.offset, offered: true });
    } catch (e) {
      if (mine !== generation) return;
      stopMeasuring();
      error = e instanceof CaptureError ? e.message : `Couldn't calibrate (${(e as Error).message}).`;
    }
    phase = 'done';
  }

  function stopMeasuring() {
    generation++;
    window.clearInterval(timer);
    for (const node of clickNodes) {
      try {
        node.stop();
      } catch {
        // Not started yet, or already done.
      }
    }
    clickNodes = [];
    capture?.close();
    capture = null;
  }

  /** Skips calibrating the Input, so it isn't offered again, and records. */
  function skip() {
    const skipped = calibrated ?? input;
    calibrations.set(skipped, { ...calibrations.of(skipped), offered: true });
    onSkip?.();
    close(true);
  }

  function close(andRecord = false) {
    record = andRecord;
    dialog?.close();
  }

  function onclose() {
    stopMeasuring();
    onClose(record);
  }

  const measured = $derived(result?.ok ? result : null);
</script>

<!-- A click outside closes it, but never while measuring. -->
<Dialog bind:dialog title="Calibrate the latency" dismissible={() => phase !== 'measuring'} {onclose}>
  {#if phase === 'ready'}
    <p>
      {#if offer}
        Before the first recording from <strong>{name}</strong>, measure how late your voice reaches the recording after
        the Beat plays, so Takes line up with it.
      {:else}
        Measure how late your voice reaches the recording from <strong>{name}</strong> after the Beat plays, so Takes line
        up with it.
      {/if}
    </p>
    <p>
      With the headphones or speakers you record with, tap or clap on the mic along with {clickCount} clicks. It takes about
      ten seconds.
    </p>
  {:else if phase === 'measuring'}
    <p class="count" role="status" aria-live="polite">
      {currentClick === 0 ? 'Get ready…' : `Click ${currentClick} of ${clickCount}: tap along`}
    </p>
  {:else if error}
    <p class="problem" role="alert">{error}</p>
  {:else if measured}
    <p role="status">
      The Latency Offset of {name} is <strong class="tabular">{formatOffset(measured.offset)}</strong>, from {measured.hits}
      of {clickCount} taps. New Takes from it are placed earlier by it; Takes already recorded stay where they are.
    </p>
  {:else if result}
    <p class="problem" role="alert">
      {result.hits === 0 ? 'No taps were heard' : `Only ${result.hits} taps were heard in time with the clicks`}, so
      nothing was measured. Tap or clap firmly, close to the mic, once with each click, and try again.
    </p>
  {/if}

  {#if offer && !measured}
    <p class="muted">Skipped, it can be run any time from Recording settings… in the Timeline's ⋯ menu.</p>
  {/if}

  <div class="actions">
    {#if phase === 'ready'}
      <button type="button" class="button primary" onclick={measure}>Start</button>
    {:else if phase === 'measuring'}
      <button type="button" class="button" onclick={() => close()}>Cancel</button>
    {:else if measured}
      {#if offer}
        <button type="button" class="button primary" onclick={() => close(true)}>Record</button>
      {:else}
        <button type="button" class="button primary" onclick={() => close()}>Done</button>
      {/if}
      <button type="button" class="button" onclick={measure}>Calibrate again</button>
    {:else}
      <button type="button" class="button primary" onclick={measure}>Try again</button>
    {/if}
    {#if offer && !measured && phase !== 'measuring'}
      <button type="button" class="button" onclick={skip}>Skip and record</button>
    {/if}
  </div>
</Dialog>

<style>
  p {
    margin: 0;
  }
  .count {
    font-size: var(--text-xl);
    font-variant-numeric: tabular-nums;
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
