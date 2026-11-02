<script lang="ts">
  // The Tuner's own page (see the glossary): the device's Tuning, picked as
  // in the Chord Finder, the same one, and a guitar's 3+3 headstock, each
  // string's note on the peg that tunes it, mirrored on a left-handed device.
  // Tapping a peg plays its string's note from the guitar's recorded samples,
  // ringing once, and tapping it again plays it again. Tapping it also holds
  // the Tuner to that string, marked as held, until it's released, another
  // string is tapped, or another Tuning is picked. It's a guitar's whatever
  // the device's Instrument. Once Listen is pressed, it listens on its own
  // Input, showing between the pegs the note it hears, the string held or
  // else the one whose note is nearest, how many cents sharp or flat of it
  // the note is, which way to tune to it, with an arrow and words, and a wave
  // that drifts as a strobe tuner's does, until Stop is pressed or the page is
  // left. Once a note fades, it keeps showing where it landed, muted and
  // labelled Last heard, the wave at rest, until the next note is heard, or
  // listening stops, a string is held or released, or another Tuning is
  // picked. Its Input is picked under the headstock, from the Inputs connected,
  // as the Timeline's mic button lists them: the Input recorded from until
  // another is picked, and the Input recorded from again wherever the one
  // picked isn't connected.
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import { untrack } from 'svelte';
  import { listenProblem } from '../lib/capture';
  import { hear, prepareToHear } from '../lib/hear';
  import InputPicker from '../lib/InputPicker.svelte';
  import { InputRows } from '../lib/inputRows.svelte';
  import { inputName, sameInput } from '../lib/inputSettings';
  import { reducedMotion } from '../lib/motion';
  import { OpenedInput } from '../lib/openedInput.svelte';
  import { detectPitch, LastHeard, loudness, SteadyPitch } from '../lib/pitch';
  import { input } from '../lib/sharedInput.svelte';
  import { leftHanded } from '../lib/sharedLeftHanded.svelte';
  import { tunerInput } from '../lib/sharedTunerInput.svelte';
  import { deviceTuning } from '../lib/sharedTuning.svelte';
  import Toasts from '../lib/Toasts.svelte';
  import {
    tunerDrift,
    tunerPeg,
    tunerReading,
    tunerSound,
    tunerStrings,
    tunerWay,
    type TunerString,
  } from '../lib/tuner';
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

  // The string the Tuner's held to, one of the Tuning's, kept raw so it's
  // that very string, told apart from the others by identity: null for none,
  // the nearest string read instead.
  let held = $state.raw<TunerString | null>(null);

  function keep() {
    tuningError = '';
    // Another Tuning's strings aren't the ones held to, or the ones the note
    // kept was read against: it lets go of both.
    if (tuning !== deviceTuning.value) hold(null);
    deviceTuning.set(tuning);
  }

  /** Holds the Tuner to a string, or releases it with null: the note kept was read against another, so it goes. */
  function hold(string: TunerString | null) {
    held = string;
    forgetLastHeard();
  }

  /** Plays a string's note and holds the Tuner to that string. */
  function playAndHold(string: TunerString) {
    hold(string);
    hear([string.heard], tunerSound);
  }

  // The Inputs to pick the Tuner's from, the Input recorded from used
  // wherever the one picked isn't connected.
  const inputs = new InputRows({
    value: () => tunerInput.value,
    set: (choice) => tunerInput.set(choice),
    instead: () => input.value,
  });

  /** How many samples it hears a note in: 4096, nearly four periods of the lowest string's at 48 kHz. */
  const heardIn = 4096;
  /** How often it reads the pitch, in ms. */
  const every = 50;
  /** How far sharp or flat the meter reaches, in cents: past it, it reads as the end. */
  const reach = 50;

  // Listening: from Listen till Stop, or till the page is left, on the
  // Tuner's Input, or where it isn't connected, the Input recorded from.
  const listened = new OpenedInput(() => ({ choice: tunerInput.value, instead: input.value }), {
    size: heardIn,
    say: listenProblem,
    stopOnFailure: true,
  });
  const listening = $derived(listened.on);
  const opening = $derived(listened.opening);

  // The pitch heard, steadied, in Hz; null for nothing heard.
  let pitch = $state<number | null>(null);
  // Where the last note landed, in Hz, kept once it's faded, while nothing's
  // heard; null for none.
  const lastHeard = new LastHeard();
  let kept = $state<number | null>(null);
  function forgetLastHeard() {
    lastHeard.forget();
    kept = null;
  }
  // What's shown: the note heard, else the one kept, read against the strings.
  const shown = $derived(pitch ?? kept);
  const reading = $derived(shown !== null && strings ? tunerReading(shown, strings, held) : null);
  // Whether what's shown is the note kept, Last heard, rather than one heard now.
  const last = $derived(pitch === null && kept !== null);

  // Read every so often while the Input is open, and nothing once it isn't.
  $effect(() => {
    const level = listened.level;
    if (!level) return;
    const steady = new SteadyPitch();
    const timer = setInterval(() => {
      // While the audio's suspended, e.g. in a background tab, the samples
      // stand still: nothing's heard, rather than the last note held.
      const running = audioContext().state === 'running' && !document.hidden;
      const samples = level.samples();
      const heard = running ? detectPitch(samples, level.sampleRate) : null;
      pitch = steady.hear(heard, performance.now());
      kept = lastHeard.hear(heard, pitch, loudness(samples));
    }, every);
    return () => {
      clearInterval(timer);
      pitch = null;
      forgetLastHeard();
    };
  });

  // The device picked when it isn't connected, so another is listened on:
  // as opened while listening, and as far as can be told without opening it
  // while not.
  const gone = $derived(listening ? listened.gone : inputs.chosenGone);
  // What's listened on in its place: the Input recorded from in place of
  // the one picked, unless it isn't connected either; else the default input.
  const usedInstead = $derived(
    tunerInput.picked && sameInput(inputs.used, input.value) ? 'the Input you record from' : 'the default input',
  );
  // The Input named on the picker's button: the one listened on.
  const named = $derived(inputName(inputs.used));

  // A Tuning that can't be read can't be tuned to: listening stops with it.
  $effect(() => {
    if (!strings) untrack(() => listened.stop());
  });

  const cents = $derived(reading ? Math.round(reading.cents) : 0);
  const howFarOff = $derived(
    !reading
      ? 'Nothing heard'
      : reading.inTune
        ? 'In tune'
        : `${Math.abs(cents)} ${Math.abs(cents) === 1 ? 'cent' : 'cents'} ${cents > 0 ? 'sharp' : 'flat'}`,
  );
  // Which way to turn to the note, off it: up when flat, down when sharp.
  const way = $derived(tunerWay(reading));
  // What the meter says to a screen reader: how far off, with the way to
  // tune, and for the note kept, that it's the one last heard.
  const meterText = $derived(`${last ? 'Last heard: ' : ''}${way ? `${howFarOff}, tune ${way}` : howFarOff}`);

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
  // other, faster the further off. In tune, with nothing heard, on the note
  // kept, or under reduced motion, it stands still where it is.
  const drift = $derived(tunerDrift(last ? null : reading));
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
          <button type="button" class="button" onclick={() => listened.stop()}>Stop</button>
        {:else}
          <button type="button" class="button primary" onclick={() => listened.start()}>Listen</button>
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
                class:held={held === s}
                aria-label="Hear the {s.number} string, {s.name}"
                aria-current={held === s ? 'true' : undefined}
                title="Hear the {s.number} string, and hold the Tuner to it"
                onclick={() => playAndHold(s)}
              >
                <span class="note">{s.name}</span>
                <span class="which">{s.number}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="readout" class:last>
          <p class="last-heard">
            {#if last}Last heard{/if}
          </p>
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
            class:hearing={reading && !last}
            class:in-tune={reading?.inTune && !last}
            role="meter"
            aria-label="Cents sharp or flat"
            aria-valuemin={-reach}
            aria-valuemax={reach}
            aria-valuenow={Math.max(-reach, Math.min(reach, cents))}
            aria-valuetext={meterText}
          >
            <svg viewBox="0 0 {2 * wavelength} {waveHeight}" preserveAspectRatio="none" aria-hidden="true">
              <path d={wavePath} transform="translate({drifted * wavelength} 0)" vector-effect="non-scaling-stroke" />
            </svg>
          </div>
          {#if reading?.inTune}
            <p class="off"><span class="badge tuned">In tune</span></p>
          {:else}
            <!-- How far off, and under it which way to tune: the words say it
                 so the arrow can't be read as where the pitch sits. -->
            <p class="off tabular">
              {#if reading}
                <span>{howFarOff}</span>
                {#if way}
                  <span class="way">
                    {#if way === 'up'}<ArrowUp aria-hidden="true" />{:else}<ArrowDown aria-hidden="true" />{/if}
                    Tune {way}
                  </span>
                {/if}
              {/if}
            </p>
          {/if}
        </div>
      </div>
      {#if held}
        <p class="holding">
          <span>Held to the {held.number} string, {held.name}</span>
          <button type="button" class="button quiet" onclick={() => hold(null)}>Release</button>
        </p>
      {:else}
        <p class="muted">Tap a peg to hear its string's note and hold the Tuner to that string.</p>
      {/if}
      <div class="input">
        <span>Listens on</span>
        <InputPicker {inputs} {named} label="Input to listen on" legend="Listen on" instead={usedInstead} note={null} />
      </div>
      {#if opening}
        <p class="muted" role="status">Opening the input…</p>
      {:else if listened.problem}
        <p class="error" role="alert">{listened.problem}</p>
      {:else if gone}
        <p class="notice" role="status">{gone} isn't connected, so {usedInstead} is used.</p>
      {:else if !listening}
        {#if !tunerInput.picked}
          <p class="muted">The Input you record from, until you pick another here.</p>
        {/if}
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
  /* The Input listened on, its name on the picker's button, cut short where it's long. */
  .input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .input > span {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-md);
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
  /* The string held: its peg filled with the accent, as a picked chip is. */
  .peg.held {
    border-color: var(--accent);
    background: var(--accent);
  }
  .peg.held .note,
  .peg.held .which {
    color: var(--accent-text);
  }
  @media (hover: hover) {
    .peg.held:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--accent) 85%, var(--text));
      background: color-mix(in srgb, var(--accent) 85%, var(--text));
    }
  }
  /* What it's held to, and Release beside it. */
  .holding {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  /* What's heard, centred between the pegs: Last heard over the note kept,
     the note, its string, the wave and how far off it is, each holding its
     line while empty, so nothing jumps as it's heard. */
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
  .listen .last-heard {
    min-height: 1lh;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .listen .nothing,
  .listen .nearest,
  .listen .off {
    min-height: 1lh;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* How far off over the way to tune, or the In tune badge: two lines held
     whichever shows, as the room between a phone's pegs fits no more than
     one a line, so the wave above never jumps as a string comes in tune. */
  .listen .off {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 2lh;
  }
  .off > span {
    white-space: nowrap;
  }
  /* The way to tune, in --text: what to do, so it reads over the muted cents. */
  .way {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
    font-weight: 600;
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
  .wave.hearing {
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
  /* The note kept, Last heard: all of it muted, the In tune badge outlined
     as a Tag is, so it doesn't read as what's heard now. */
  .last .heard .note,
  .last .way {
    color: var(--text-muted);
  }
  .last .tuned {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
  }
</style>
