<script lang="ts">
  import { onDestroy } from 'svelte';
  import { clickTime, formatOffset, Measuring, minHits, noReading, steadyOver, type Reading } from './calibration';
  import CalibrationTaps from './CalibrationTaps.svelte';
  import { Capture, CaptureError, frameAt, openInput } from './capture';
  import Dialog from './Dialog.svelte';
  import OffsetField from './OffsetField.svelte';
  import { channelName, inputName, sameInput, type InputChoice } from './inputSettings';
  import { RecordedInput } from './recordedInput.svelte';
  import { calibrations } from './sharedCalibration.svelte';
  import { audioContext } from './timelinePlayer';

  // Calibrates an Input's Latency Offset in a dialog, naming the Input:
  // clicks play until the user ends it, and they tap or clap on the mic along
  // with them. Each tap is measured as it's heard, and the running average
  // shown, with how steady it's been and a graph of the taps, so they can
  // stop once it reads steady. Use this keeps the average for the Input it
  // was measured on; Cancel, or closing it, keeps nothing. An offset already
  // known can be typed instead, for the Input it names. Offered before an
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
  // Its Latency Offset now, to type from.
  const offset = $derived(
    measuring || exact ? calibrations.of(measuring ?? input).offset : recorded.calibration.offset,
  );

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'ready' | 'measuring' | 'done'>('ready');
  // Whether the first click has played, while measuring.
  let clicking = $state(false);
  // What's been measured so far, while measuring.
  let reading = $state.raw<Reading>(noReading);
  // The Latency Offset kept, once used, and how many taps it's from, or that it was typed.
  let kept = $state.raw<{ offset: number; taps: number } | { offset: number; typed: true } | null>(null);
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
    reading = noReading;
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
        reading = meter.reading;
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
    if (!usable(reading) || average === null) return;
    if (!measuring) {
      fail(new CaptureError("The browser didn't say which input it measured, so nothing was kept."));
      return;
    }
    // Applied even where storage can't keep it, until reload.
    calibrations.keep(measuring, average);
    kept = { offset: average, taps: counted };
    phase = 'done';
  }

  /**
   * Keeps an offset typed as the Latency Offset of the Input calibrated, as
   * if measured. Where that isn't known for sure, e.g. the default input, or
   * one chosen that may be unplugged, it's opened a moment to find out,
   * as only opening an Input says which it is.
   */
  async function keepTyped(typed: number) {
    stopMeasuring();
    const mine = generation;
    error = null;
    let which = measuring ?? (exact ? input : null);
    if (!which) {
      try {
        const opened = await openInput($state.snapshot(input));
        for (const track of opened.stream.getTracks()) track.stop();
        if (mine !== generation) return;
        which = opened.input;
        if (which) calibrations.opened($state.snapshot(input), which);
      } catch (e) {
        if (mine === generation) fail(e);
        return;
      }
    }
    if (!which) {
      fail(new CaptureError("The browser didn't say which input it is, so nothing was kept."));
      return;
    }
    measuring = which;
    calibrations.keep(which, typed);
    kept = { offset: typed, typed: true };
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

  /** Whether a reading has enough taps that agree to keep. */
  const usable = (r: Reading) => r.counted >= minHits;

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
      The Latency Offset of {name} is
      <strong class="tabular">{formatOffset(kept.offset)}</strong>{#if 'taps' in kept}, from
        {taps(kept.taps)}{/if}. New Takes from it are placed earlier by it; Takes already recorded stay where they are.
    </p>
  {/if}

  {#if phase !== 'measuring'}
    <div class="typed">
      <p class="muted">Or, if you know it, type it in whole milliseconds.</p>
      <OffsetField {name} {offset} onSet={keepTyped} />
    </div>
  {/if}

  {#if offer && !kept}
    <p class="muted">Skipped, it can be run any time from Recording settings… in the Timeline's ⋯ menu.</p>
  {/if}

  <div class="actions">
    {#if phase === 'ready'}
      <button type="button" class="button primary" onclick={measure}>Start</button>
    {:else if phase === 'measuring'}
      <button type="button" class="button primary" disabled={!usable(reading)} onclick={use}>Use this</button>
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
  .typed {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
