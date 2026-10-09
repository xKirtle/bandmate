<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    clickTime,
    finishingAt,
    formatOffset,
    Measuring,
    minHits,
    noReading,
    offsetChange,
    verdict,
    type Reading,
  } from './calibration';
  import { Capture, CaptureError, frameAt } from './capture';
  import Dialog from './Dialog.svelte';
  import { channelName, inputName, sameInput, type InputChoice } from './inputSettings';
  import Metronome, { type Mark } from './Metronome.svelte';
  import { RecordedInput } from './recordedInput.svelte';
  import { calibrations } from './sharedCalibration.svelte';
  import { audioContext } from './timelinePlayer';

  // Calibrates one Input's Latency Offset, in a sheet that names it. First
  // the calibration method: hands-free, the default, where the mic hears the
  // clicks from headphones resting on it, or tap along, where the user taps
  // or claps on it with the clicks they hear. Then clicks play, a metronome
  // swinging upright as each is heard, and each tap is measured as it's
  // heard, until the average is known well enough, or the user finishes
  // early, once enough count. Pause never leaves:
  // it offers Start over, Finish, Change method or Quit. The result shows
  // the change from the Input's offset there was, or the browser's
  // estimate, and nothing is kept until Save. Offered before an Input's
  // first recording, where it can be skipped for that Input, to record
  // straight away with the browser's estimate; also run from the recording
  // settings and Settings, where a listed Input is measured as itself or not
  // at all.
  let {
    input,
    exact = false,
    offer = null,
    onSkip,
    onClose,
  }: {
    /** The Input to calibrate, as chosen: the default input is calibrated as the Input it turns out to be. */
    input: InputChoice;
    /** Whether only that Input is measured: where it can't be opened, e.g. unplugged, the default isn't measured in its place. */
    exact?: boolean;
    /**
     * Where it's offered before recording, the latency the browser reports
     * for the Input, in seconds: it can then be skipped, recording with
     * that, and records once saved.
     */
    offer?: { reported: number } | null;
    /** Hears calibration skipped, to record straight away. */
    onSkip?: () => void;
    /** Hears it closed, and whether to record now. */
    onClose: (record: boolean) => void;
  } = $props();

  type Step = 'setup' | 'measure' | 'paused' | 'result';
  type Method = 'handsFree' | 'tap';

  // The Input measured, once it's open; until then, the one it will be, where that can be told.
  let measured = $state.raw<InputChoice | null>(null);
  const recorded = new RecordedInput(() => input);
  // The Input it looks to measure: only ever the one given, where it's exact.
  const expected = $derived(exact ? input : recorded.current);
  const calibrated = $derived(measured ?? expected);
  const name = $derived(calibrated ? channelName(calibrated.label, calibrated.channel) : inputName(input));
  // Its Latency Offset now, which nothing changes until Save.
  const was = $derived(measured || exact ? calibrations.of(measured ?? input).offset : recorded.calibration.offset);

  let dialog = $state<HTMLDialogElement>();
  let actions = $state<HTMLElement>();
  let step = $state<Step>('setup');
  let method = $state<Method>('handsFree');
  // The context time clicks are scheduled from, while they play.
  let from = $state<number | null>(null);
  // Whether the first click has been heard, while measuring.
  let clicking = $state(false);
  // What's been measured so far, and each tap with when it was heard, by performance.now().
  let reading = $state.raw<Reading>(noReading);
  let marks = $state.raw<Mark[]>([]);
  // The latency the browser reports for the Input measured, in seconds, once
  // it's open; until then, where it's offered, for the Input recording opened.
  let reportedOpen = $state<number | null>(null);
  const reported = $derived(reportedOpen ?? offer?.reported ?? null);
  let error = $state<string | null>(null);
  let record = false;

  let capture: Capture | null = null;
  let clickNodes = new Set<OscillatorNode>();
  let timer = 0;
  // Each measuring, so one stopped finds nothing to show.
  let generation = 0;

  onDestroy(stopMeasuring);

  // How far ahead clicks are scheduled, and how often more are, in seconds.
  const ahead = 1;
  const scheduleEvery = 0.25;

  // Whether the reading has enough taps that agree to keep, and how near it is to finishing by itself.
  const judged = $derived(verdict(reading));
  const usable = $derived(judged.usable);

  /** The context time being heard from the speakers now, as the browser says. */
  function heardNow(): number {
    const context = audioContext();
    const stamp = context.getOutputTimestamp?.();
    if (stamp?.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0) {
      return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
    }
    return context.currentTime - (context.outputLatency || 0) - context.baseLatency;
  }

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

  /** Measures from the start, forgetting any taps so far. */
  async function measure() {
    const context = audioContext();
    // Resumed while the click that started it still counts.
    const resumed = context.resume().catch(() => {});
    stopMeasuring();
    const mine = generation;
    step = 'measure';
    clicking = false;
    reading = noReading;
    marks = [];
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
      measured = which;
      reportedOpen = opened.latency;
      if (opened.opened) calibrations.opened($state.snapshot(input), opened.opened);
      // A moment on, so the first click is scheduled clear of now.
      const start = context.currentTime + 0.1;
      const first = frameAt(start, opened.sampleRate);
      const meter = new Measuring(opened.sampleRate);
      opened.hand(({ frame, samples }) => {
        const skip = Math.max(0, first - frame);
        if (skip >= samples.length || !meter.hear(samples.subarray(skip), frame + skip - first)) return;
        heard(meter.reading);
      });
      // Clicks, one after another, until it's paused or finished.
      let next = 0;
      const schedule = () => {
        for (; start + clickTime(next) < context.currentTime + ahead; next++)
          playClick(context, start + clickTime(next));
        clicking = heardNow() >= start + clickTime(0);
      };
      from = start;
      schedule();
      timer = window.setInterval(schedule, scheduleEvery * 1000);
    } catch (e) {
      if (mine !== generation) return;
      fail(e);
    }
  }

  /** Takes a new reading, marking each tap new in it as heard now, and finishes once it's known well enough. */
  function heard(next: Reading) {
    if (step !== 'measure') return;
    const now = performance.now();
    marks = next.taps.map((tap, i) => ({ ...tap, at: marks[i]?.at ?? now }));
    reading = next;
    const { finished, usable } = verdict(next);
    if (!finished) return;
    if (usable) finish();
    // Heard all it listens for, with too few agreeing to keep.
    else
      fail(
        new CaptureError(
          `Only ${next.counted} of ${taps(next.taps.length)} agreed, too few to measure. Try again, or change the calibration method.`,
        ),
      );
  }

  /** Back to the method, saying why it stopped. */
  function fail(e: unknown) {
    stopMeasuring();
    error = e instanceof CaptureError ? e.message : `Couldn't calibrate (${(e as Error).message}).`;
    step = 'setup';
  }

  function pause() {
    stopMeasuring();
    step = 'paused';
  }

  /** Ends measuring, to show the average before it's saved. */
  function finish() {
    stopMeasuring();
    if (!usable) return;
    if (!measured) {
      fail(new CaptureError("The browser didn't say which input it measured, so nothing was kept."));
      return;
    }
    step = 'result';
  }

  /** Keeps the average as the Latency Offset of the Input measured, and closes, recording where offered. */
  function save() {
    if (!measured || reading.average === null) return;
    // Applied even where storage can't keep it, until reload.
    calibrations.keep(measured, reading.average);
    close(offer !== null);
  }

  /** Back to choosing the method, forgetting the taps. */
  function changeMethod() {
    stopMeasuring();
    reading = noReading;
    marks = [];
    step = 'setup';
  }

  function stopMeasuring() {
    generation++;
    from = null;
    clicking = false;
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

  // Before measuring there's nothing to lose, so Esc closes, as a click
  // outside does. After, it never does: while measuring, it pauses. Taken
  // as the key's pressed, so the browser never closes it on a second Esc
  // as it may a dialog that keeps refusing to.
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || step === 'setup') return;
    e.preventDefault();
    if (step === 'measure') pause();
  }

  // Other ways of asking to close, e.g. Android's back gesture, do as Esc does.
  function oncancel(e: Event) {
    if (step === 'setup') return;
    e.preventDefault();
    if (step === 'measure') pause();
  }

  // Each step's first action takes focus, as the one pressed is gone.
  let shown = false;
  $effect(() => {
    void step;
    if (!shown) {
      shown = true;
      return;
    }
    tick().then(() => actions?.querySelector<HTMLElement>('button')?.focus());
  });

  const taps = (n: number) => `${n} ${n === 1 ? 'tap' : 'taps'}`;
  // A spread or precision, in whole milliseconds; as none from a single tap.
  const ms = (seconds: number | null) => `${Math.round((seconds ?? 0) * 1000)} ms`;
</script>

<svelte:window onkeydowncapture={onkeydown} />

<Dialog
  bind:dialog
  sheet
  title="Calibrate the latency"
  closeButton={step === 'measure' ? 'hidden' : 'shown'}
  dismissible={() => step === 'setup'}
  {oncancel}
  {onclose}
  --dialog-width="40rem"
>
  {#snippet detail()}
    <p class="detail">{name}</p>
  {/snippet}

  {#if step === 'setup'}
    <p>
      {#if offer}
        Before the first recording from it, measure how late your voice reaches the recording after the Beat plays, so
        Takes line up with it.
      {:else}
        Measure how late your voice reaches the recording after the Beat plays, so Takes line up with it.
      {/if}
    </p>
    <fieldset class="choice-group">
      <legend>Calibration method</legend>
      <label class="choice-row">
        <input type="radio" name="method" checked={method === 'handsFree'} onchange={() => (method = 'handsFree')} />
        <span>Hands-free: rest your headphones on the mic, and it hears the clicks itself. Most exact.</span>
      </label>
      {#if method === 'handsFree'}
        <div class="choice-under muted">Turn the volume up for the test, so the mic hears each click clearly.</div>
      {/if}
      <label class="choice-row">
        <input type="radio" name="method" checked={method === 'tap'} onchange={() => (method = 'tap')} />
        <span>Tap along: tap or clap on the mic in time with the clicks you hear</span>
      </label>
    </fieldset>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    {#if offer}
      <p class="muted">Skipped, it can be run any time from Recording settings… in the Timeline's ⋯ menu.</p>
    {/if}
    <div class="actions" bind:this={actions}>
      <button type="button" class="button primary" onclick={measure}>Start</button>
      {#if offer}
        <button type="button" class="button" onclick={skip}
          >Skip, use the browser's {formatOffset(offer.reported)}</button
        >
      {/if}
    </div>
  {:else if step === 'measure' || step === 'paused'}
    <div class="stage">
      <Metronome from={step === 'measure' ? from : null} heard={heardNow} {marks} average={reading.average} />
      <p class="reading tabular" role="status" aria-live="polite">
        {#if step === 'paused'}
          Paused
        {:else if !clicking}
          Get ready…
        {:else if reading.average === null}
          {method === 'tap' ? 'Tap along with the clicks you hear' : 'Listening for the clicks…'}
        {:else}
          <strong>{formatOffset(reading.average)}</strong>, from {taps(reading.counted)}
        {/if}
      </p>
      <div
        class="progress"
        role="progressbar"
        aria-label="Progress to finishing"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(judged.progress * 100)}
      >
        <div style:width="{judged.progress * 100}%"></div>
      </div>
      <p class="muted">
        {#if step === 'paused'}
          {taps(reading.taps.length)} so far.
        {:else if !usable}
          Finding the taps: {Math.min(reading.counted, minHits)} of {minHits}
        {:else}
          Your taps spread ±{ms(reading.spread)} · average good to ±{ms(reading.precision)}, finishing at ±{ms(
            finishingAt,
          )}
        {/if}
      </p>
    </div>
    <div class="actions" bind:this={actions}>
      {#if step === 'measure'}
        <button type="button" class="button" onclick={pause}>Pause</button>
        {#if usable}
          <button type="button" class="button primary" onclick={finish}>Finish now</button>
        {/if}
      {:else}
        <!-- Finishing is what it's for, once it can; until then, starting over. -->
        {#if usable && reading.average !== null}
          <button type="button" class="button primary" onclick={finish}
            >Finish with {formatOffset(reading.average)}</button
          >
        {/if}
        <button type="button" class={usable ? 'button' : 'button primary'} onclick={measure}>Start over</button>
        <button type="button" class="button" onclick={changeMethod}>Change method</button>
        <button type="button" class="button" onclick={() => close()}>Quit</button>
      {/if}
    </div>
  {:else if reading.average !== null}
    <div class="stage" role="status">
      <p class="result tabular">{formatOffset(reading.average)}</p>
      <p>
        {#if was !== null}
          Was {formatOffset(was)}: {offsetChange(reading.average, was)}.
        {:else if reported !== null}
          The browser guessed {formatOffset(reported)}.
        {/if}
        From {taps(reading.counted)} spread ±{ms(reading.spread)}: good to ±{ms(reading.precision)}.
      </p>
      <p class="muted">New Takes from it are placed earlier by it; Takes already recorded stay where they are.</p>
    </div>
    <div class="actions" bind:this={actions}>
      <button type="button" class="button primary" onclick={save}>{offer ? 'Save and record' : 'Save'}</button>
      <button type="button" class="button" onclick={measure}>Start over</button>
      <button type="button" class="button" onclick={() => close()}>Discard</button>
    </div>
  {/if}
</Dialog>

<style>
  p {
    margin: 0;
  }
  .detail {
    color: var(--text-muted);
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
  }
  .reading {
    font-size: var(--text-xl);
  }
  .result {
    font-size: var(--text-2xl);
    font-weight: 600;
  }
  .progress {
    width: 100%;
    height: var(--space-2);
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--surface-2);
  }
  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width var(--duration-base) var(--ease);
  }
  .muted {
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .stage + .actions {
    justify-content: center;
  }
</style>
