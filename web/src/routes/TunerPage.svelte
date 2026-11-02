<script lang="ts">
  // The Tuner's own page (see the glossary): the device's Tuning, picked as
  // in the Chord Finder, the same one, and a guitar's 3+3 headstock, each
  // string's note on the peg that tunes it, mirrored on a left-handed device.
  // Tapping a peg plays its string's note from the guitar's recorded samples,
  // ringing once, and tapping it again plays it again. Tapping it also holds
  // the Tuner to that string and turns Auto off, until Auto is tapped, another
  // string is tapped, or another Tuning is picked. With Auto on, it picks the
  // string nearest the note heard. Either way, the peg of the string it's
  // tuning shows pressed. It's a guitar's whatever the device's Instrument.
  // Once Listen is pressed, it listens on its own Input, showing between the
  // pegs the note it hears, the string held or else the one whose note is
  // nearest, how many cents sharp or flat of it the note is, which way to
  // tune to it, with an arrow and words, and the note heard drawn as a wave
  // over the string's, until Stop is pressed or the page is left. Once a
  // note fades, it keeps showing where it landed, muted and labelled Last
  // heard, its string's peg muted under Auto, its wave frozen, until the next
  // note is heard, or listening stops, a string is held, Auto is tapped, or
  // another Tuning is picked. Its Input is picked under the headstock, from
  // the Inputs connected, as the Timeline's mic button lists them: the Input
  // recorded from until another is picked, and the Input recorded from again
  // wherever the one picked isn't connected.
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
    tunerPeg,
    tunerReading,
    tunerSound,
    tunerStrings,
    tunerWaveHeight,
    tunerWavelength,
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
  // Auto on, the nearest string read instead.
  let held = $state.raw<TunerString | null>(null);

  function keep() {
    tuningError = '';
    // Another Tuning's strings aren't the ones held to, or the ones the note
    // kept was read against: it lets go of both.
    if (tuning !== deviceTuning.value) hold(null);
    deviceTuning.set(tuning);
  }

  /**
   * Holds the Tuner to a string, turning Auto off, or lets go with null,
   * Auto on: the note kept was read against another, so it goes.
   */
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
  // How loud the note heard is (see `loudness`), from its last reading while
  // it's heard, so once it's faded its wave stays as it was.
  let heardLoudness = $state(0);
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
  const showingKept = $derived(pitch === null && kept !== null);
  // The reading of a note heard now: null on the note kept, as on nothing heard.
  const live = $derived(showingKept ? null : reading);
  // The string it's tuning, its peg shown pressed: the one held, else under
  // Auto the one the note shown is read against, none with nothing heard.
  const tuned = $derived(held ?? reading?.string ?? null);
  // Under Auto, the string of the note kept, its peg muted as the rest of Last heard is.
  const pegFaded = $derived(!held && showingKept);

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
      const detected = running ? detectPitch(samples, level.sampleRate) : null;
      const loud = loudness(samples);
      pitch = steady.hear(detected, performance.now());
      if (pitch !== null) heardLoudness = loud;
      kept = lastHeard.hear(detected, pitch, loud);
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
  const meterText = $derived(`${showingKept ? 'Last heard: ' : ''}${way ? `${howFarOff}, tune ${way}` : howFarOff}`);

  // The waves, in their drawing's own units, this wide and tall: the target's,
  // the string's note, two wavelengths showing, swinging this far either
  // side of the middle, and over it the heard note's, its wavelength and
  // height against the target's (see tunerWavelength and tunerWaveHeight).
  const waveWidth = 100;
  const waveHeight = 24;
  const wavelength = 50;
  const swing = 8;
  /** How many straight steps draw each wavelength: enough to look smooth. */
  const steps = 16;
  /** How far both waves scroll a second while a note's heard: a quarter of the target's wavelength. */
  const pace = wavelength / 4;
  /** The target's dash and gap, in the units its path's length is measured in: each of its wavelengths holds this many of them, whole, so its dashes don't jump as it scrolls a wavelength on. */
  const dash = 4;
  const gap = 3;
  const dashes = 13;
  /**
   * A sine wave from a wavelength before the window to one past it, so it
   * fills the window however far it's scrolled within one.
   */
  function sine(length: number, height: number): string {
    const count = Math.ceil(((waveWidth + 2 * length) / length) * steps);
    return Array.from({ length: count + 1 }, (_, i) => {
      const x = -length + (i * length) / steps;
      const y = waveHeight / 2 - height * Math.sin((2 * Math.PI * x) / length);
      return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  }
  const targetPath = sine(wavelength, swing);
  /** How many wavelengths the target's path is long: a wavelength either side of the window. */
  const targetWaves = waveWidth / wavelength + 2;
  // The heard note's wave, the note heard now or the one kept: none with nothing heard.
  const heardLength = $derived(reading ? wavelength * tunerWavelength(reading) : wavelength);
  const heardPath = $derived(reading ? sine(heardLength, swing * tunerWaveHeight(heardLoudness)) : null);
  /** How far both waves have scrolled, in the drawing's units: they carry on from there, so they never jump. */
  let scrolled = $state(0);
  // Both scroll together at one pace while a note's heard, off its note or
  // in tune, so they're never still while there's a note. With nothing
  // heard, on the note kept, or under reduced motion, they stand still
  // where they are.
  const scrolling = $derived(live !== null);
  $effect(() => {
    if (!scrolling || reducedMotion()) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      if (!reducedMotion()) scrolled += (pace * (now - last)) / 1000;
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
                class:pressed={tuned === s}
                class:faded={tuned === s && pegFaded}
                aria-label="Hear the {s.number} string, {s.name}"
                aria-current={tuned === s ? 'true' : undefined}
                title="Hear the {s.number} string, and hold the Tuner to it"
                onclick={() => playAndHold(s)}
              >
                <span class="note">{s.name}</span>
                <span class="which">{s.number}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="readout" class:kept={showingKept}>
          <p class="last-heard">
            {#if showingKept}Last heard{/if}
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
            role="meter"
            aria-label="Cents sharp or flat"
            aria-valuemin={-reach}
            aria-valuemax={reach}
            aria-valuenow={Math.max(-reach, Math.min(reach, cents))}
            aria-valuetext={meterText}
          >
            <!-- The string's note, dashed, and over it the note heard, scrolling
                 together, each shifted on by how far they've scrolled within
                 a wavelength of its own, which draws it the same. -->
            <svg viewBox="0 0 {waveWidth} {waveHeight}" preserveAspectRatio="none" aria-hidden="true">
              <path
                class="target-wave"
                d={targetPath}
                pathLength={targetWaves * dashes * (dash + gap)}
                stroke-dasharray="{dash} {gap}"
                transform="translate({scrolled % wavelength} 0)"
                vector-effect="non-scaling-stroke"
              />
              {#if heardPath}
                <path
                  class="heard-wave"
                  class:in-tune={live?.inTune}
                  class:kept={showingKept}
                  d={heardPath}
                  transform="translate({scrolled % heardLength} 0)"
                  vector-effect="non-scaling-stroke"
                />
              {/if}
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
      <!-- Auto, on while no string is held: tapping it lets go of the one held. -->
      <p class="holding">
        <button
          type="button"
          class="chip"
          aria-pressed={!held}
          aria-describedby="tuner-holding"
          onclick={() => held && hold(null)}
        >
          Auto
        </button>
        <span id="tuner-holding">
          {#if held}Held to the {held.number} string, {held.name}{:else}Picks the string nearest the note heard{/if}
        </span>
      </p>
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
  /* As wide as the headstock, at the left under the Tuning, however wide
     the page: a wide window's page has no width of its own. */
  .card {
    max-width: calc(var(--tuner-headstock) + 2 * var(--space-4));
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
  /* The string it's tuning, held or picked under Auto: its peg filled with
     the accent, as a picked chip is. */
  .peg.pressed {
    border-color: var(--accent);
    background: var(--accent);
  }
  .peg.pressed:not(.faded) .note,
  .peg.pressed:not(.faded) .which {
    color: var(--accent-text);
  }
  @media (hover: hover) {
    .peg.pressed:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--accent) 85%, var(--text));
      background: color-mix(in srgb, var(--accent) 85%, var(--text));
    }
  }
  /* The string of the note last heard, under Auto: muted with the readout,
     a tint of the accent edged in a deeper one, its note and number left
     as an unpressed peg's. */
  .peg.pressed.faded {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  @media (hover: hover) {
    .peg.pressed.faded:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      background: color-mix(in srgb, var(--accent) 24%, transparent);
    }
  }
  /* Auto, and beside it what picks the string: the Tuner, or the string held. */
  .holding {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .holding > span {
    min-width: 0;
    color: var(--text-muted);
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
  /* The waves: the string's note dashed in --text-muted, always there, and
     over it, a little thicker, the note heard, in the accent, in the
     finished Status's colour in tune, and muted once it's the note kept. */
  .wave {
    width: 100%;
    height: var(--tuner-wave);
    margin: var(--space-2) 0;
    overflow: hidden;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  path {
    fill: none;
  }
  .target-wave {
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
  .heard-wave {
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-linecap: round;
    transition: stroke var(--duration-base) var(--ease);
  }
  .heard-wave.in-tune {
    stroke: var(--finished-fg);
  }
  .heard-wave.kept {
    stroke: var(--text-muted);
  }
  .tuned {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
  /* The note kept, Last heard: all of it muted, the In tune badge outlined
     as a Tag is, so it doesn't read as what's heard now. */
  .kept .heard .note,
  .kept .way {
    color: var(--text-muted);
  }
  .kept .tuned {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
  }
</style>
