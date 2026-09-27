<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { api, type Section, type Song } from './api';

  let {
    songId,
    uid,
    section,
    shared,
    autofocus = false,
    change,
    onUnsaved,
    actions,
  }: {
    songId: number;
    /** Makes element ids unique, e.g. when a shared Section shows more than once. */
    uid: string;
    section: Section;
    /** Other Occurrences show this Section too. */
    shared: boolean;
    /** Focus the Label when this becomes true, e.g. for a Section just added. */
    autofocus?: boolean;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: () => Promise<Song>) => Promise<boolean>;
    /** Tells the page whether this editor holds edits not yet saved. */
    onUnsaved: (editor: object, unsaved: boolean) => void;
    actions: Snippet;
  } = $props();

  // How long typing has to pause before the text is saved.
  const saveDelay = 800;

  // The server guarantees exactly one active Alternate.
  const active = $derived(section.alternates.find((a) => a.active)!);
  const savedText = $derived(active.lines.map((l) => l.text).join('\n'));

  let label = $state(untrack(() => section.label));
  let text = $state(untrack(() => savedText));
  let editingLabel = false;
  let editingText = false;
  // The last text sent to or loaded from the server.
  let sent = untrack(() => savedText);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = 0;
  // The last save failed, so the text box holds edits the server doesn't have.
  let failed = false;
  // Identifies this editor to onUnsaved.
  const editor = {};

  // Show what the server has, unless it would overwrite something being
  // typed or not yet saved here.
  $effect(() => {
    const t = savedText;
    untrack(() => {
      if (!editingText && timer === undefined && inFlight === 0 && !failed) text = sent = t;
    });
  });
  $effect(() => {
    const l = section.label;
    if (!editingLabel) label = l;
  });

  function typed() {
    clearTimeout(timer);
    onUnsaved(editor, true);
    timer = setTimeout(save, saveDelay);
  }

  async function save() {
    clearTimeout(timer);
    timer = undefined;
    const t = text;
    if (t !== sent || failed) {
      const previous = sent;
      sent = t;
      inFlight++;
      failed = !(await change(() => api.replaceAlternateText(songId, active.id, t)));
      inFlight--;
      if (failed) sent = previous;
    }
    settle();
  }

  // Once nothing is waiting to be saved, show the server's text again, unless
  // the last save failed and the text box is the only copy of the edits.
  function settle() {
    if (timer !== undefined || inFlight > 0) return;
    if (failed) return;
    onUnsaved(editor, false);
    if (!editingText) text = sent = savedText;
  }

  function textBlurred() {
    editingText = false;
    save();
  }

  async function commitLabel() {
    editingLabel = false;
    const next = label.trim();
    if (next === section.label) {
      label = section.label;
      return;
    }
    if (!(await change(() => api.setSectionLabel(songId, section.id, next)))) label = section.label;
  }

  // Leaving the page doesn't blur the text box, so save what's still waiting
  // or failed last time.
  onDestroy(() => {
    if (timer !== undefined || failed) save();
  });

  function focusWhen(on: boolean) {
    return (el: HTMLElement) => {
      if (!on) return;
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    };
  }

  // Grows the text box to fit its text, so long Sections don't scroll inside
  // a small box (which is awkward with an on-screen keyboard).
  function fitText(el: HTMLTextAreaElement) {
    void text;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }
</script>

<article class="section" class:is-shared={shared} aria-label={section.label || 'Section without a Label'}>
  <div class="head">
    <label class="visually-hidden" for="label-{uid}">Label</label>
    <input
      id="label-{uid}"
      class="label"
      bind:value={label}
      onfocus={() => (editingLabel = true)}
      onchange={commitLabel}
      onblur={() => (editingLabel = false)}
      list="label-suggestions"
      placeholder="Label"
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="next"
      {@attach focusWhen(autofocus)}
    />
    {#if shared}
      <span class="shared" title="This Section appears more than once. Editing it changes every Occurrence.">
        Shared
      </span>
    {/if}
    <div class="actions">{@render actions()}</div>
  </div>
  <label class="visually-hidden" for="text-{uid}">Lines</label>
  <textarea
    id="text-{uid}"
    class="text"
    bind:value={text}
    oninput={typed}
    onfocus={() => (editingText = true)}
    onblur={textBlurred}
    rows="3"
    placeholder="Write the Lines here, one per line"
    autocapitalize="sentences"
    {@attach fitText}
  ></textarea>
</article>

<style>
  .section {
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.5rem;
  }
  .label {
    flex: 1 1 8rem;
    width: auto;
    min-width: 0;
    border-color: transparent;
    background: transparent;
    font-weight: 700;
  }
  .label:hover,
  .label:focus {
    border-color: var(--border);
    background: var(--bg);
  }
  .section.is-shared {
    border-left: 4px solid var(--accent);
  }
  .shared {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }
  .text {
    display: block;
    min-height: 5.5rem;
    background: var(--bg);
    line-height: 1.6;
    resize: none;
    overflow: hidden;
    /* Keeps the text box clear of the sticky header when it scrolls into view. */
    scroll-margin: 4.5rem 0 1rem;
  }
</style>
