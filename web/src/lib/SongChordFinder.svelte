<script lang="ts">
  import { onMount } from 'svelte';
  import { on } from 'svelte/events';
  import ChordFinder from './ChordFinder.svelte';
  import { keyAsShown, readTuning, standard, tuningName, tuningNotes } from './chordFinder';
  import TuningField from './TuningField.svelte';

  // The Chord Finder opened from a Song: a side panel beside the Lyric Sheet
  // on desktop, a full-screen sheet on narrower windows. It follows the
  // Song's tuning, capo and Key as shown, Transpose included, and says so
  // above the tabs. They're changed only in the Details. An unset tuning is
  // standard, with a picker to try another, and an unset Key makes Suggest
  // ask for one; neither is saved to the Song. A tuning or Key that can't be
  // read is quoted in a notice, the tuning taken as standard and the Key
  // asked for. Opened only by the user, it takes focus as it opens.
  let {
    tuning,
    capo,
    songKey,
    transpose,
    sheet,
    triedTuning = $bindable('Standard'),
    pickedKey = $bindable(null),
    onclose,
  }: {
    /** The Song's tuning, as its Details hold it. */
    tuning: string;
    /** The Song's capo, null for none set. */
    capo: number | null;
    /** The Song's Key, as written. */
    songKey: string;
    /** How far the Chords are shown transposed, in semitones: Read mode's Transpose amount, else 0. */
    transpose: number;
    /** Whether it's a full-screen sheet, not a side panel. */
    sheet: boolean;
    /** The tuning tried in the Finder while the Song has none, not saved to the Song. */
    triedTuning?: string;
    /** The Key picked for Suggest while the Song has none, not saved to the Song. */
    pickedKey?: string | null;
    onclose: () => void;
  } = $props();

  const written = $derived(tuning.trim());
  const tuningText = $derived(written || triedTuning);
  const pitches = $derived(readTuning(tuningText));
  const tuningLabel = $derived.by(() => {
    if (!pitches) return 'Standard tuning';
    const name = tuningName(tuningText);
    return name === 'Standard' ? 'Standard tuning' : (name ?? tuningNotes(tuningText) ?? '');
  });

  const shown = $derived(keyAsShown(songKey, transpose));
  const key = $derived(shown.kind === 'key' ? shown.key : pickedKey);
  const keyPrompt = $derived(
    shown.kind === 'unset'
      ? 'This Song has no Key. Pick one to get suggestions; it isn’t saved to the Song.'
      : shown.kind === 'unreadable'
        ? `This Song’s Key “${shown.written}” can’t be read. Pick one to get suggestions; it isn’t saved to the Song.`
        : undefined,
  );

  const context = $derived({ tuning: pitches ?? standard, capo: capo ?? 0, key });

  let tuningError = $state('');
  let dialog = $state<HTMLDialogElement>();
  let panel = $state<HTMLElement>();

  // Esc closes the side panel too, as it closes the sheet, unless something
  // in it, like an open picker, took it first.
  function closeOnEscape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onclose();
  }

  onMount(() => {
    if (sheet) dialog?.showModal();
    else panel?.focus();
  });
</script>

{#snippet content()}
  <header class="head">
    <h2 id="song-finder-heading">Chord Finder</h2>
    <button
      type="button"
      class="icon close"
      onclick={() => (sheet ? dialog?.close() : onclose())}
      aria-label="Close the Chord Finder">✕</button
    >
  </header>
  <div class="following">
    {#if written}
      <span>{tuningLabel}</span>
    {:else}
      <span class="visually-hidden" id="song-finder-tuning-label">Tuning</span>
      <span class="tuning">
        <TuningField
          id="song-finder-tuning"
          labelledby="song-finder-tuning-label"
          allowNone={false}
          bind:value={triedTuning}
          oncommit={() => (tuningError = '')}
          oninvalid={(message) => (tuningError = message)}
        />
      </span>
    {/if}
    <span class="muted" aria-hidden="true">·</span>
    <span>{context.capo > 0 ? `Capo ${context.capo}` : 'No capo'}</span>
    {#if shown.kind === 'key'}
      <span class="muted" aria-hidden="true">·</span>
      <span>Key of {shown.short}</span>
    {:else if shown.kind === 'unreadable'}
      <span class="muted" aria-hidden="true">·</span>
      <span>Key “{shown.written}” can’t be read</span>
    {/if}
  </div>
  {#if tuningError}
    <p class="notice error" role="alert">{tuningError}</p>
  {/if}
  {#if written && !pitches}
    <p class="notice" role="status">
      This Song’s tuning “{written}” can’t be read, so the Chord Finder uses standard tuning.
    </p>
  {:else if !written}
    <p class="notice muted">This Song has no tuning, so the Chord Finder uses standard. Trying another isn’t saved.</p>
  {/if}
  <ChordFinder
    {context}
    suggestKey={key}
    onpickkey={shown.kind === 'key' ? undefined : (picked) => (pickedKey = picked)}
    {keyPrompt}
  />
{/snippet}

{#if sheet}
  <dialog bind:this={dialog} class="sheet" {onclose} aria-labelledby="song-finder-heading">
    {@render content()}
  </dialog>
{:else}
  <aside
    bind:this={panel}
    class="panel"
    aria-labelledby="song-finder-heading"
    tabindex="-1"
    {@attach (el) => on(el, 'keydown', closeOnEscape)}
  >
    {@render content()}
  </aside>
{/if}

<style>
  .panel,
  .sheet[open] {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .panel {
    padding: 0 0.75rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .panel:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* The whole window on a phone, keeping clear of a notch. */
  .sheet {
    width: 100%;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: max(0.5rem, env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right))
      max(1rem, env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
    border: 0;
    background: var(--bg);
    color: var(--text);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: var(--control);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  .following {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .tuning {
    flex: 0 1 14rem;
    min-width: 9rem;
    font-weight: normal;
  }
  .notice {
    margin: 0;
    font-size: 0.8125rem;
  }
</style>
