<script lang="ts">
  // The Tuner's own page (see the glossary): the device's Tuning, picked as
  // in the Chord Finder, the same one, and a guitar's 3+3 headstock, each
  // string's note on the peg that tunes it, mirrored on a left-handed device.
  // Tapping a peg plays its string's note from the guitar's recorded samples,
  // ringing once, and tapping it again plays it again. It's a guitar's
  // whatever the device's Instrument. Once Listen is pressed, it listens on
  // the Input recorded from, showing between the pegs the note it hears, the
  // string whose note is nearest and how many cents sharp or flat of it the
  // note is, and a wave that drifts as a strobe tuner's does, until Stop is
  // pressed or the page is left.
  import { onDestroy, untrack } from 'svelte';
  import { InputLevel, listenProblem } from '../lib/capture';
  import { hear, prepareToHear } from '../lib/hear';
  import { sameInput, type InputChoice } from '../lib/inputSettings';
  import { reducedMotion } from '../lib/motion';
  import { detectPitch, SteadyPitch } from '../lib/pitch';
  import { input } from '../lib/sharedInput.svelte';
  import { leftHanded } from '../lib/sharedLeftHanded.svelte';
  import { deviceTuning } from '../lib/sharedTuning.svelte';
  import Toasts from '../lib/Toasts.svelte';
  import { tunerDrift, tunerPeg, tunerReading, tunerSound, tunerStrings } from '../lib/tuner';
  import TuningField from '../lib/TuningField.svelte';
  import { audioContext } from '../lib/timelinePlayer';
  import { unheard, unheardToasts } from '../lib/unheard.svelte';

  // The field's own copy, set as the device's once picked.
  let tuning = $state(deviceTuning.value);
  let tuningError = $state('');
  const strings = $derived(tunerStrings(tuning));

  // Loaded on opening, so the first tap plays at once (ADR 0030).
  $effect(() => prepareToHear(tunerSound));
  // A note that couldn't be heard here is this page's to say: leaving it goes.
  $effect(() => () => unheard.dismiss());

  function keep() {
    tuningError = '';
    deviceTuning.set(tuning);
  }

  // Listening: from Listen till Stop, or till the page is left.
  let listening = $state(false);
  let opening = $state(false);
  // Why it can't listen, from the last Listen pressed.
  let problem = $state<string | null>(null);
  // The audio device recorded from when it isn't connected, so the default is listened on instead.
  let gone = $state<string | null>(null);
  // The pitch heard, steadied, in Hz; null for nothing heard.
  let pitch = $state<number | null>(null);
  const reading = $derived(pitch !== null && strings ? tunerReading(pitch, strings) : null);

  /** How many samples it hears a note in: 4096, nearly four periods of the lowest string's at 48 kHz. */
  const heardIn = 4096;
  /** How often it reads the pitch, in ms. */
  const every = 50;
  /** How far sharp or flat the meter reaches, in cents: past it, it reads as the end. */
  const reach = 50;

  let level: InputLevel | null = null;
  // The Input opened, to open another given in its place.
  let opened: InputChoice | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  // Each opening of the Input, so a slower one opened before is let go.
  let generation = 0;

  /** Opens the Input recorded from, in place of any open, and listens on it. */
  async function listen() {
    const mine = ++generation;
    close();
    listening = true;
    opening = true;
    problem = null;
    // Resumed while the click on Listen still counts.
    audioContext()
      .resume()
      .catch(() => {});
    opened = $state.snapshot(input.value);
    try {
      const open = await InputLevel.open(audioContext(), opened, heardIn);
      if (mine !== generation) {
        open.close();
        return;
      }
      level = open;
      gone = open.gone;
      const steady = new SteadyPitch();
      timer = setInterval(() => {
        // While the audio's suspended, e.g. in a background tab, the samples
        // stand still: nothing's heard, rather than the last note held.
        const running = audioContext().state === 'running' && !document.hidden;
        pitch = steady.hear(running ? detectPitch(open.samples(), open.sampleRate) : null, performance.now());
      }, every);
    } catch (e) {
      if (mine !== generation) return;
      problem = listenProblem(e);
      listening = false;
      opened = null;
    }
    opening = false;
  }

  /** Lets go of the Input, if it's open. */
  function close() {
    clearInterval(timer);
    level?.close();
    level = null;
    pitch = null;
    gone = null;
  }

  /** Stops listening, keeping any problem with the last Listen shown. */
  function stop() {
    generation++;
    close();
    opened = null;
    listening = false;
    opening = false;
  }

  // Another Input recorded from, e.g. chosen in another tab: it's listened on in place of the one before.
  $effect(() => {
    const given = input.value;
    if (opened && !sameInput(given, opened)) untrack(listen);
  });

  // A Tuning that can't be read can't be tuned to: listening stops with it.
  $effect(() => {
    if (!strings) untrack(stop);
  });

  onDestroy(stop);

  const cents = $derived(reading ? Math.round(reading.cents) : 0);
  const howFarOff = $derived(
    !reading
      ? 'Nothing heard'
      : reading.inTune
        ? 'In tune'
        : `${Math.abs(cents)} ${Math.abs(cents) === 1 ? 'cent' : 'cents'} ${cents > 0 ? 'sharp' : 'flat'}`,
  );

  // The wave, in its drawing's own units: a wavelength is this wide, two
  // show at once, and it swings this far either side of its middle.
  const wavelength = 50;
  const waveHeight = 24;
  const swing = 9;
  /** How many straight steps draw each wavelength: enough to look smooth. */
  const steps = 16;
  /** A sine wave from a wavelength before the window to two past it, so it fills the window however far it's drifted within one. */
  const wavePath = Array.from({ length: 4 * steps + 1 }, (_, i) => {
    const x = -wavelength + (i * wavelength) / steps;
    const y = waveHeight / 2 - swing * Math.sin((2 * Math.PI * x) / wavelength);
    return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  /** How far the wave has drifted, in wavelengths, 0 to 1: it carries on from there, so it never jumps. */
  let drifted = $state(0);
  // Drifts while a string is heard off its note: flat one way, sharp the
  // other, faster the further off. In tune, with nothing heard, or under
  // reduced motion, it stands still where it is.
  const drift = $derived(tunerDrift(reading));
  $effect(() => {
    const speed = drift;
    if (!speed || reducedMotion()) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      if (!reducedMotion()) drifted = (((drifted + (speed * (now - last)) / 1000) % 1) + 1) % 1;
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<header class="bar">
  <h1>Tuner</h1>
</header>

<main class="page">
  <div class="field tuning">
    <span id="tuner-tuning-label">Tuning</span>
    <TuningField
      id="tuner-tuning"
      labelledby="tuner-tuning-label"
      allowNone={false}
      bind:value={tuning}
      oncommit={keep}
      oninvalid={(message) => (tuningError = message)}
    />
  </div>
  {#if tuningError}
    <p class="error" role="alert">{tuningError}</p>
  {/if}
  {#if strings}
    <section class="card listen" aria-labelledby="tuner-listen-heading">
      <div class="head">
        <h2 id="tuner-listen-heading">Play a string to see how far off it is</h2>
        <!-- In the accent while idle to be seen, plain while it listens. -->
        {#if listening}
          <button type="button" class="button" onclick={stop}>Stop</button>
        {:else}
          <button type="button" class="button primary" onclick={listen}>Listen</button>
        {/if}
      </div>
      <!-- A 3+3 headstock: the pegs down either side, and between them what's heard. -->
      <div class="headstock">
        <ul aria-label="Strings">
          {#each strings as s, i (s.number)}
            {@const peg = tunerPeg(i, leftHanded.value)}
            <li style:grid-column={peg.side === 'left' ? 1 : 3} style:grid-row={peg.row}>
              <button
                type="button"
                class="button peg"
                aria-label="Hear the {s.number} string, {s.name}"
                title="Hear the {s.number} string"
                onclick={() => hear([s.heard], tunerSound)}
              >
                <span class="note">{s.name}</span>
                <span class="which">{s.number}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="readout">
          <p class="heard">
            {#if reading}
              <span class="note">{reading.heard}</span>
            {:else if listening && !opening}
              <span class="nothing">Nothing heard</span>
            {/if}
          </p>
          <p class="nearest">
            {#if reading}
              {reading.string.number} string, {reading.string.name}
            {/if}
          </p>
          <div
            class="wave"
            class:heard={reading}
            class:in-tune={reading?.inTune}
            role="meter"
            aria-label="Cents sharp or flat"
            aria-valuemin={-reach}
            aria-valuemax={reach}
            aria-valuenow={Math.max(-reach, Math.min(reach, cents))}
            aria-valuetext={howFarOff}
          >
            <svg viewBox="0 0 {2 * wavelength} {waveHeight}" preserveAspectRatio="none" aria-hidden="true">
              <path d={wavePath} transform="translate({drifted * wavelength} 0)" vector-effect="non-scaling-stroke" />
            </svg>
          </div>
          {#if reading?.inTune}
            <p class="off"><span class="badge tuned">In tune</span></p>
          {:else}
            <p class="off tabular">{reading ? howFarOff : ''}</p>
          {/if}
        </div>
      </div>
      <p class="muted">Tap a peg to hear its string's note.</p>
      {#if opening}
        <p class="muted" role="status">Opening the input…</p>
      {:else if problem}
        <p class="error" role="alert">{problem}</p>
      {:else if gone}
        <p class="notice" role="status">{gone} isn't connected, so the default input is used.</p>
      {:else if !listening}
        <p class="muted">Listens on the Input you record from.</p>
      {:else if !reading}
        <p class="muted">Play a string near the microphone or input.</p>
      {/if}
    </section>
  {/if}
</main>

<!-- A note that couldn't be heard, the guitar's samples not loading. -->
<Toasts toasts={unheardToasts()} />

<style>
  .tuning {
    max-width: 24rem;
    margin: 0 0 var(--space-4);
  }
  .error {
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  }
  .card {
    padding: var(--space-4);
  }
  .listen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .listen .error {
    margin: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .listen p {
    margin: 0;
    font-size: var(--text-md);
  }
  .notice {
    color: var(--warning);
  }
  /* The headstock, wider at the top and narrowing to the nut, a bar across
     its foot. The pegs go down either side, in the columns either side of
     the readout, which sits in the same row between them. */
  .headstock {
    display: grid;
    grid-template-columns: var(--tuner-peg) minmax(0, 1fr) var(--tuner-peg);
    column-gap: var(--space-2);
    width: 100%;
    max-width: var(--tuner-headstock);
    margin: 0 auto;
    padding: var(--space-4) var(--space-3);
    border-bottom: var(--space-1) solid var(--text-muted);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-2);
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--space-2)) 100%, var(--space-2) 100%);
  }
  ul {
    display: grid;
    grid-template-columns: subgrid;
    grid-template-rows: repeat(3, auto);
    grid-row: 1;
    grid-column: 1 / -1;
    align-content: space-between;
    row-gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Each peg round, its string's note over the string's number. */
  .peg {
    flex-direction: column;
    gap: 0;
    width: var(--tuner-peg);
    height: var(--tuner-peg);
    padding: 0;
    border-radius: var(--radius-full);
  }
  .peg .note {
    color: var(--text);
    font-size: var(--text-lg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .which {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 400;
  }
  /* What's heard, centred between the pegs: the note, its string, the wave
     and how far off it is, each holding its line while empty, so nothing
     jumps as it's heard. */
  .readout {
    display: flex;
    grid-row: 1;
    grid-column: 2;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-width: 0;
    text-align: center;
  }
  .listen .heard {
    min-height: 1lh;
    font-size: var(--text-2xl);
  }
  .heard .note {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .listen .nothing,
  .listen .nearest,
  .listen .off {
    min-height: 1lh;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* The wave: at rest in the border's colour, muted while a note's heard,
     and in the finished Status's colour in tune. */
  .wave {
    width: 100%;
    height: var(--tuner-wave);
    margin: var(--space-2) 0;
    overflow: hidden;
    color: var(--border);
    transition: color var(--duration-base) var(--ease);
  }
  .wave.heard {
    color: var(--text-muted);
  }
  .wave.in-tune {
    color: var(--finished-fg);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .tuned {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
</style>
