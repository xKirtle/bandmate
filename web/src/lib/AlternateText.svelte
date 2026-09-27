<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, type Alternate, type Song, type SongAt } from './api';

  let {
    uid,
    alternate,
    label,
    change,
    onUnsaved,
  }: {
    /** Makes the element id unique. */
    uid: string;
    alternate: Alternate;
    /** Names the text box for screen readers. */
    label: string;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Tells the page whether this text box holds edits not yet saved. */
    onUnsaved: (editor: object, unsaved: boolean) => void;
  } = $props();

  // How long typing has to pause before the text is saved.
  const saveDelay = 800;

  // Saves always go to the Alternate this box was made for; a different
  // Alternate gets its own box.
  const alternateId = untrack(() => alternate.id);
  const savedText = $derived(alternate.lines.map((l) => l.text).join('\n'));

  let text = $state(untrack(() => savedText));
  let editingText = false;
  // The last text sent to or loaded from the server.
  let sent = untrack(() => savedText);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = 0;
  // The last save failed, so the text box holds edits the server doesn't have.
  let failed = false;
  // Identifies this text box to onUnsaved.
  const editor = {};

  // Show what the server has, unless it would overwrite something being
  // typed or not yet saved here.
  $effect(() => {
    const t = savedText;
    untrack(() => {
      if (!editingText && timer === undefined && inFlight === 0 && !failed) text = sent = t;
    });
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
      failed = !(await change((at) => api.replaceAlternateText(at, alternateId, t)));
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

  // Leaving the page, or the box going away, doesn't blur the text box, so
  // save what's still waiting or failed last time.
  onDestroy(() => {
    if (timer !== undefined || failed) save();
  });

  // Grows the text box to fit its text, so long Sections don't scroll inside
  // a small box (which is awkward with an on-screen keyboard).
  function fitText(el: HTMLTextAreaElement) {
    void text;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }
</script>

<label class="visually-hidden" for="text-{uid}">{label}</label>
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

<style>
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
