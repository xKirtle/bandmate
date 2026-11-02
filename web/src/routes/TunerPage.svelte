<script lang="ts">
  // The Tuner's own page (see the glossary): the device's Tuning, picked as
  // in the Chord Finder, the same one, and its six strings, low to high, each
  // with its note. Tapping one plays its note from the guitar's recorded
  // samples, ringing once, and tapping it again plays it again. It's a
  // guitar's whatever the device's Instrument. Once Listen is pressed, it
  // listens on the Input recorded from, showing the note it hears, the
  // string whose note is nearest and how many cents sharp or flat of it the
  // note is, until Stop is pressed or the page is left.
  import { onDestroy, untrack } from 'svelte';
  import { InputLevel, listenProblem } from '../lib/capture';
  import { hear, prepareToHear } from '../lib/hear';
  import { sameInput, type InputChoice } from '../lib/inputSettings';
  import { detectPitch, SteadyPitch } from '../lib/pitch';
  import { input } from '../lib/sharedInput.svelte';
  import { deviceTuning } from '../lib/sharedTuning.svelte';
  import Toasts from '../lib/Toasts.svelte';
  import { tunerReading, tunerSound, tunerStrings } from '../lib/tuner';
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
  /** How far sharp or flat the needle reaches, in cents: past it, it stays at the end. */
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
        pitch = steady.hear(detectPitch(open.samples(), open.sampleRate), performance.now());
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

  /** Where the needle sits, from 0 at the flat end to 100 at the sharp end. */
  const needle = $derived(reading ? 50 + (Math.max(-reach, Math.min(reach, reading.cents)) / reach) * 50 : 50);
  const cents = $derived(reading ? Math.round(reading.cents) : 0);
  const off = $derived(
    !reading
      ? 'Nothing heard'
      : reading.inTune
        ? 'In tune'
        : `${Math.abs(cents)} ${Math.abs(cents) === 1 ? 'cent' : 'cents'} ${cents > 0 ? 'sharp' : 'flat'}`,
  );
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
      {#if listening && !opening}
        <div class="readout">
          <p class="heard">
            {#if reading}
              <span class="note">{reading.heard}</span>
            {:else}
              <span class="nothing">Nothing heard</span>
            {/if}
          </p>
          <p class="nearest">
            {#if reading}
              {reading.string.number} string, {reading.string.name}
            {:else}
              Play a string near the microphone or input.
            {/if}
          </p>
          <div class="scale">
            <span aria-hidden="true">Flat</span>
            <div
              class="meter"
              role="meter"
              aria-label="Cents sharp or flat"
              aria-valuemin={-reach}
              aria-valuemax={reach}
              aria-valuenow={Math.max(-reach, Math.min(reach, cents))}
              aria-valuetext={off}
            >
              <div class="zone"></div>
              {#if reading}
                <div class="needle" style:left="{needle}%"></div>
              {/if}
            </div>
            <span aria-hidden="true">Sharp</span>
          </div>
          {#if reading?.inTune}
            <p class="off"><span class="badge tuned">In tune</span></p>
          {:else}
            <p class="off tabular">{reading ? off : ''}</p>
          {/if}
        </div>
      {/if}
      {#if opening}
        <p class="muted" role="status">Opening the input…</p>
      {:else if problem}
        <p class="error" role="alert">{problem}</p>
      {:else if gone}
        <p class="notice" role="status">{gone} isn't connected, so the default input is used.</p>
      {:else if !listening}
        <p class="muted">Listens on the Input you record from.</p>
      {/if}
    </section>
    <section class="card strings" aria-labelledby="tuner-strings-heading">
      <h2 id="tuner-strings-heading">Tap a string to hear its note</h2>
      <ul>
        {#each strings as s (s.number)}
          <li>
            <button
              type="button"
              class="button"
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
    margin: 0 0 var(--space-4);
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
    margin: 0 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .head h2 {
    margin: 0;
  }
  .listen p {
    margin: 0;
    font-size: var(--text-md);
  }
  .notice {
    color: var(--warning);
  }
  /* The note heard, large, over its string and the needle, centred. */
  .readout {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  .listen .heard {
    display: flex;
    align-items: center;
    min-height: 1lh;
    font-size: var(--text-2xl);
  }
  .heard .note {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .nothing {
    color: var(--text-muted);
    font-size: var(--text-lg);
  }
  .nearest {
    color: var(--text-muted);
  }
  /* Flat, the needle's scale, and Sharp, in a row as wide as the card allows. */
  .scale {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    max-width: 32rem;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .meter {
    position: relative;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  /* In tune: within 5 cents either way of the middle, of the 50 each end reaches. */
  .zone {
    position: absolute;
    inset: 0 45%;
    background: color-mix(in srgb, var(--finished-fg) 40%, transparent);
  }
  .needle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0.25rem;
    border-radius: var(--radius-full);
    background: var(--text);
    translate: -50% 0;
  }
  .off {
    min-height: 1lh;
  }
  .tuned {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
  /* The six strings in a row, low to high, as a guitar is held: on a 320px
     phone too. */
  ul {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .strings .button {
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-3) var(--space-1);
  }
  .strings .note {
    color: var(--text);
    font-size: var(--text-xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .which {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>
