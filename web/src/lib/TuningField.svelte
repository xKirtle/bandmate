<script lang="ts">
  import { tick } from 'svelte';
  import { tuningName, tuningNotes, tunings, tuningText } from './chordFinder';
  import Picker from './Picker.svelte';

  // A Song's tuning in its Details: a picker of the named tunings, or six
  // notes for a custom one. It stays text on the Song: the picker writes a
  // tuning's name, or its six notes. Text that can't be read (ADR 0008) is
  // kept and shown as written, until another tuning is picked. The Chord
  // Finder's page uses it too, where there's always a tuning.
  let {
    id,
    labelledby,
    value = $bindable(''),
    allowNone = true,
    oncommit,
    oninvalid,
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

  // The notes being typed for a custom tuning: those of the tuning picked so
  // far, or standard tuning's.
  let notes = $state('');
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
      notes = tuningNotes(value) ?? tuningNotes(tunings[0])!;
      customising = true;
      await tick();
      notesField?.focus();
      notesField?.select();
      return;
    }
    customising = false;
    if (c.kind === 'unreadable') return;
    value = c.kind === 'named' ? c.name : '';
    oncommit();
  }

  function commitNotes() {
    const text = tuningText(notes);
    if (!text) {
      oninvalid('A custom tuning is six notes, low string to high, like D A D G B E');
      return;
    }
    customising = false;
    notes = text;
    value = text;
    oncommit();
  }

  // Esc takes back the notes typed: back to the tuning as it is, and to the
  // picker if that isn't a custom one.
  async function notesKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    customising = false;
    if (valueChoice === custom) {
      notes = value.trim();
      return;
    }
    await tick();
    document.getElementById(id)?.focus();
  }

  // Custom notes as saved show in the field, and change as the Song does.
  $effect(() => {
    if (valueChoice === custom && !customising) notes = value.trim();
  });
</script>

<div class="tuning-field">
  <Picker {id} aria-labelledby={labelledby} {options} value={choice} text={label} onpick={pick} />
  {#if choice === custom}
    <input
      class="notes"
      bind:this={notesField}
      bind:value={notes}
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
