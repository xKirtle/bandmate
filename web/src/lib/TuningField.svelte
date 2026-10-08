<script lang="ts">
  import { tick } from 'svelte';
  import { tuningName, tuningNotes, tunings } from './chordFinder';
  import { customTuningField } from './customTuning';
  import Picker from './Picker.svelte';
  import { committedAsItGoes, type TypedField } from './typedField.svelte';

  // A Song's tuning in its Details: a picker of the named tunings, or six
  // notes for a custom one. It stays text on the Song: the picker writes a
  // tuning's name, or its six notes. Text that can't be read (ADR 0008) is
  // kept and shown as written, until another tuning is picked. The Chord
  // Finder's page uses it too, where there's always a tuning.
  //
  // A custom tuning's notes are a field typed in place (see customTuning.ts):
  // Enter or blur sets them as the tuning, and Esc takes them back. The Song
  // page gives its own, among its Details, which sets them as the tuning
  // when left behind too, e.g. as Read mode shows. Without one, the field
  // keeps its own, which nothing else knows of.
  let {
    id,
    labelledby,
    value = $bindable(''),
    allowNone = true,
    oncommit,
    oninvalid,
    customNotes,
  }: {
    id: string;
    /** The id of what labels the picker. */
    labelledby: string;
    /** The tuning as text, as the Song holds it. */
    value?: string;
    /** Whether no tuning (—) can be picked. */
    allowNone?: boolean;
    /** `value` was set to a tuning to save. */
    oncommit: () => void;
    /** Custom notes couldn't be read, so nothing was saved. */
    oninvalid: (message: string) => void;
    /** A custom tuning's notes as a field, set as the tuning when left behind (see customTuningField). */
    customNotes?: TypedField<string>;
  } = $props();

  type Choice = { kind: 'none' } | { kind: 'named'; name: string } | { kind: 'custom' } | { kind: 'unreadable' };

  const none: Choice = { kind: 'none' };
  const named: Choice[] = tunings.map((name) => ({ kind: 'named', name }));
  const custom: Choice = { kind: 'custom' };
  const unreadable: Choice = { kind: 'unreadable' };

  // Picking Custom shows the notes before any are saved.
  let customising = $state(false);

  /** What `value` is: no tuning, a named one, six other notes, or text that can't be read. */
  const valueChoice = $derived.by((): Choice => {
    if (!value.trim()) return none;
    const name = tuningName(value);
    if (name) return named[tunings.indexOf(name)];
    return tuningNotes(value) ? custom : unreadable;
  });
  const choice = $derived(customising ? custom : valueChoice);
  const options = $derived([
    ...(allowNone ? [none] : []),
    ...named,
    custom,
    ...(valueChoice === unreadable ? [unreadable] : []),
  ]);

  // The notes for a custom tuning: those of the tuning picked so far, or
  // standard tuning's, until typed in.
  const ownNotes = customTuningField({
    tuning: () => value,
    commit: (text) => {
      value = text;
      oncommit();
    },
    invalid: (message) => oninvalid(message),
    // On no list: there's nothing else to save them.
    typing: () => () => {},
  });
  const notes = $derived(customNotes ?? ownNotes);
  let notesField = $state<HTMLInputElement>();

  function label(c: Choice): string {
    switch (c.kind) {
      case 'none':
        return '—';
      case 'named':
        return c.name;
      case 'custom':
        return 'Custom';
      case 'unreadable':
        return value.trim();
    }
  }

  async function pick(c: Choice) {
    if (c.kind === 'custom') {
      customising = true;
      await tick();
      notesField?.focus();
      notesField?.select();
      return;
    }
    // Another tuning picked drops the notes typed, rather than set them as they go.
    notes.cancel();
    customising = false;
    if (c.kind === 'unreadable') return;
    value = c.kind === 'named' ? c.name : '';
    oncommit();
  }

  function commitNotes() {
    if (notes.commit()) customising = false;
  }

  // Esc takes back the notes typed: back to the tuning as it is, and to the
  // picker if that isn't a custom one.
  async function notesKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    notes.cancel();
    customising = false;
    if (valueChoice === custom) return;
    await tick();
    document.getElementById(id)?.focus();
  }
</script>

<div class="tuning-field">
  <Picker {id} aria-labelledby={labelledby} {options} value={choice} text={label} onpick={pick} />
  {#if choice === custom}
    <input
      class="notes"
      bind:this={notesField}
      bind:value={notes.shown}
      {@attach customNotes && committedAsItGoes(customNotes)}
      onchange={commitNotes}
      onkeydown={notesKey}
      aria-label="Custom tuning: six notes, low string to high"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      enterkeyhint="done"
      placeholder="E A D G B E"
    />
  {/if}
</div>

<style>
  .tuning-field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  /* Side by side when there's room, else the notes under the picker. */
  .tuning-field > :global(.picker) {
    flex: 1 1 9rem;
  }
  .notes {
    flex: 1 1 8.5rem;
    min-width: 0;
  }
</style>
