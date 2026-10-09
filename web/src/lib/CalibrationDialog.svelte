<script lang="ts">
  import { onDestroy } from 'svelte';
  import { clickTime, formatOffset, Measuring, minHits, steadyOver, type Tap } from './calibration';
  import CalibrationTaps from './CalibrationTaps.svelte';
  import { Capture, CaptureError, frameAt } from './capture';
  import Dialog from './Dialog.svelte';
  import { channelName, inputName, sameInput, type InputChoice } from './inputSettings';
  import { RecordedInput } from './recordedInput.svelte';
  import { calibrations } from './sharedCalibration.svelte';
  import { audioContext } from './timelinePlayer';

  // Calibrates an Input's Latency Offset in a dialog, naming the Input:
  // clicks play until the user ends it, and they tap or clap on the mic along
  // with them. Each tap is measured as it's heard, and the running average
  // shown, with how steady it's been and a graph of the taps, so they can
  // stop once it reads steady. Use this keeps the average for the Input it
  // was measured on; Cancel, or closing it, keeps nothing. Offered before an
  // Input's first recording, where it can be skipped, for that Input, to
  // record straight away; also run from the recording settings and Settings,
  // where a listed Input is measured as itself or not at all.
  let {
    input,
    exact = false,
    offer = false,
    onSkip,
    onClose,
  }: {
    /** The Input to calibrate, as chosen: the default input is calibrated as the Input it turns out to be. */
    input: InputChoice;
    /** Whether only that Input is measured: where it can't be opened, e.g. unplugged, the default isn't measured in its place. */
    exact?: boolean;
    /** Whether it's offered before recording, so it can be skipped, and records once done. */
    offer?: boolean;
    /** Hears calibration skipped, to record straight away. */
    onSkip?: () => void;
    /** Hears it closed, and whether to record now. */
    onClose: (record: boolean) => void;
  } = $props();

  // The Input measured, once it's open; until then, the one it will be, where that can be told.
  let measuring = $state.raw<InputChoice | null>(null);
  const recorded = new RecordedInput(() => input);
  // The Input it looks to measure: only ever the one given, where it's exact.
  const expected = $derived(exact ? input : recorded.current);
  const calibrated = $derived(measuring ?? expected);
  const name = $derived(calibrated ? channelName(calibrated.label, calibrated.channel) : inputName(input));

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'ready' | 'measuring' | 'done'>('ready');
  // Whether the first click has played, while measuring.
  let clicking = $state(false);
  // What's been measured so far, while measuring.
  let reading = $state.raw<{ taps: readonly Tap[]; average: number | null; counted: number; steady: number | null }>({
    taps: [],
    average: null,
    counted: 0,
    steady: null,
  });
  // The Latency Offset kept, and how many taps it's from, once used.
  let kept = $state.raw<{ offset: number; taps: number } | null>(null);
  let error = $state<string | null>(null);
  let record = false;

  let capture: Capture | null = null;
  let clickNodes = new Set<OscillatorNode>();
  let timer = 0;
  // Each measuring, so one cancelled finds nothing to show.
  let generation = 0;

  onDestroy(stopMeasuring);

  // How far ahead clicks are scheduled, and how often more are, in seconds.
  const ahead = 1;
  const scheduleEvery = 0.25;

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
    clickNodes.add(tone);
    tone.onended = () => clickNodes.delete(tone);
  }

  async function measure() {
    const context = audioContext();
    // Resumed while the click that started it still counts.
    const resumed = context.resume().catch(() => {});
    stopMeasuring();
    const mine = generation;
    phase = 'measuring';
    clicking = false;
    reading = { taps: [], average: null, counted: 0, steady: null };
    kept = null;
    error = null;
    try {
      await resumed;
      const opened = await Capture.open(context, $state.snapshot(input));
      if (mine !== generation) return opened.close();
      capture = opened;
      // Where the browser doesn't say which Input it opened, the one it looked to be.
      const which =
        opened.opened ??
        (exact && (opened.gone || opened.channel !== input.channel) ? null : $state.snapshot(expected));
      if (exact && (!which || !sameInput(which, input))) {
        throw new CaptureError(
          `${name} couldn't be opened, so nothing was measured. Check its device is connected and has that input.`,
        );
      }
      measuring = which;
      if (opened.opened) calibrations.opened($state.snapshot(input), opened.opened);
      // A moment on, so the first click is scheduled clear of now.
      const from = context.currentTime + 0.1;
      const first = frameAt(from, opened.sampleRate);
      const meter = new Measuring(opened.sampleRate);
      opened.hand(({ frame, samples }) => {
        const skip = Math.max(0, first - frame);
        if (skip >= samples.length || !meter.hear(samples.subarray(skip), frame + skip - first)) return;
        const { taps, average, counted, steady } = meter;
        reading = { taps, average, counted, steady };
      });
      // Clicks, one after another, until it's ended.
      let next = 0;
      const schedule = () => {
        for (; from + clickTime(next) < context.currentTime + ahead; next++) playClick(context, from + clickTime(next));
        clicking = context.currentTime >= from + clickTime(0);
      };
      schedule();
      timer = window.setInterval(schedule, scheduleEvery * 1000);
    } catch (e) {
      if (mine !== generation) return;
      fail(e);
    }
  }

  function fail(e: unknown) {
    stopMeasuring();
    error = e instanceof CaptureError ? e.message : `Couldn't calibrate (${(e as Error).message}).`;
    phase = 'done';
  }

  /** Ends measuring, keeping the average as the Latency Offset of the Input measured. */
  function use() {
    const { average, counted } = reading;
    stopMeasuring();
    if (average === null || counted < minHits) return;
    if (!measuring) {
      fail(new CaptureError("The browser didn't say which input it measured, so nothing was kept."));
      return;
    }
    // Applied even where storage can't keep it, until reload.
    calibrations.set(measuring, { offset: average, offered: true });
    kept = { offset: average, taps: counted };
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
    clickNodes = new Set();
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

  const taps = (n: number) => `${n} ${n === 1 ? 'tap' : 'taps'}`;
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
      With the headphones or speakers you record with, tap or clap on the mic along with the clicks. Keep going until
      the average holds steady, then use it.
    </p>
  {:else if phase === 'measuring'}
    <p class="reading" role="status" aria-live="polite">
      {#if !clicking}
        Get ready…
      {:else if reading.average === null}
        Tap along with the clicks
      {:else}
        <strong>{formatOffset(reading.average)}</strong>, from {taps(reading.counted)}
      {/if}
    </p>
    <p class="muted">
      {#if reading.counted < minHits}
        It takes {minHits} taps in time with the clicks.
      {:else if reading.steady === null}
        Keep tapping until it holds steady.
      {:else}
        Steady: ±{formatOffset(reading.steady)} over the last {steadyOver}
      {/if}
    </p>
    <CalibrationTaps taps={reading.taps} average={reading.average} />
  {:else if error}
    <p class="problem" role="alert">{error}</p>
  {:else if kept}
    <p role="status">
      The Latency Offset of {name} is <strong class="tabular">{formatOffset(kept.offset)}</strong>, from
      {taps(kept.taps)}. New Takes from it are placed earlier by it; Takes already recorded stay where they are.
    </p>
  {/if}

  {#if offer && !kept}
    <p class="muted">Skipped, it can be run any time from Recording settings… in the Timeline's ⋯ menu.</p>
  {/if}

  <div class="actions">
    {#if phase === 'ready'}
      <button type="button" class="button primary" onclick={measure}>Start</button>
    {:else if phase === 'measuring'}
      <button type="button" class="button primary" disabled={reading.counted < minHits} onclick={use}>Use this</button>
      <button type="button" class="button" onclick={() => close()}>Cancel</button>
    {:else if kept}
      {#if offer}
        <button type="button" class="button primary" onclick={() => close(true)}>Record</button>
      {:else}
        <button type="button" class="button primary" onclick={() => close()}>Done</button>
      {/if}
      <button type="button" class="button" onclick={measure}>Calibrate again</button>
    {:else}
      <button type="button" class="button primary" onclick={measure}>Try again</button>
    {/if}
    {#if offer && !kept && phase !== 'measuring'}
      <button type="button" class="button" onclick={skip}>Skip and record</button>
    {/if}
  </div>
</Dialog>

<style>
  p {
    margin: 0;
  }
  .reading {
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
