<script lang="ts" module>
  import type { Line } from './api';

  /** How an Occurrence's Cues show on the text box of its active Alternate. */
  export interface Cueing {
    /** Line ids to their Cues in the Occurrence, in seconds. */
    cues: Readonly<Record<number, number>>;
    /** The Line playback is on, highlighted. */
    current: number | null;
    /** Keeps track of a Line's row, to follow playback to. */
    track: (el: HTMLElement, line: number) => () => void;
    /** Given, a gutter beside each Line shows its Cue, to change it with. */
    gutter?: {
      /** Ends each Line's name for screen readers, e.g. " of Chorus". */
      labelSuffix: string;
      save: (line: Line, cue: number | null) => void;
      /** Hands over a Line's field, or null once it's gone, so Enter elsewhere can go on to it. */
      field: (line: number, field: GutterField | null | undefined) => void;
      /** Opens the next Line's field; answers whether there was one. */
      next: (line: number) => boolean;
    };
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, type Alternate, type Song, type SongAt } from './api';
  import CueField from './CueField.svelte';
  import { isBlank, linesByRow } from './cues';
  import type { GutterField } from './gutter';

  let {
    uid,
    alternate,
    label,
    change,
    onUnsaved,
    cueing,
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
    /** Given, the Lines get a backdrop behind the text box to highlight and cue them. */
    cueing?: Cueing;
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

  // The rows of the text box as typed, each with the saved Line it is. Until
  // typing is saved, a row may be matched to the wrong Line; the save
  // matches them for real.
  const rows = $derived(cueing ? text.split('\n') : []);
  const rowLines = $derived(cueing ? linesByRow(text, alternate.lines) : []);
</script>

<label class="visually-hidden" for="text-{uid}">{label}</label>
<!-- The backdrop renders the rows again behind the text box, wrapping them
     the same way, so each row's highlight and Cue line up with its text. The
     text box sits on top and takes every click, so it never seeks. -->
<div class="field" class:cued={cueing} class:with-gutter={cueing?.gutter} style:--rows={rows.length}>
  {#if cueing}
    <div class="backdrop"></div>
    {#each rows as row, i (i)}
      {@const line = rowLines[i]}
      {@const gridRow = i + 2}
      {#if line}
        <div
          class="row"
          class:current={line.id === cueing.current}
          style:grid-row={gridRow}
          aria-hidden="true"
          {@attach (el) => cueing.track(el, line.id)}
        >
          {row || ' '}
        </div>
      {:else}
        <div class="row" style:grid-row={gridRow} aria-hidden="true">{row || ' '}</div>
      {/if}
      {#if cueing.gutter && line && !isBlank(line)}
        {@const gutter = cueing.gutter}
        <div class="gutter" style:grid-row={gridRow}>
          <CueField
            bind:this={() => undefined, (field) => gutter.field(line.id, field)}
            gutter
            cue={cueing.cues[line.id] ?? null}
            label="Line {alternate.lines.indexOf(line) + 1}{gutter.labelSuffix}"
            save={(cue) => gutter.save(line, cue)}
            next={() => gutter.next(line.id)}
          />
        </div>
      {/if}
    {/each}
  {/if}
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
</div>

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
  /* One grid row per row of text, between rows as tall as the text box's
     top and bottom border and padding. The text box spans them all, and the
     last takes whatever the text box's minimum height adds. Its own stacking
     context keeps the text box's and rows' z-index inside it, so they never
     draw over the sticky header or Timeline. */
  .field.cued {
    --inset-block: calc(0.5rem + 1px);
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--inset-block) repeat(var(--rows), auto) minmax(var(--inset-block), 1fr);
    column-gap: 0.5rem;
  }
  .field.with-gutter {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .cued .text {
    grid-area: 1 / 1 / -1 / 2;
    z-index: 2;
    background: transparent;
  }
  .cued .text,
  .row {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  /* The text box's background, behind the rows. */
  .backdrop {
    grid-area: 1 / 1 / -1 / 2;
    border-radius: 0.5rem;
    background: var(--bg);
  }
  /* Set like the text box's text, so it wraps the same; its text is never
     seen, only its highlight. */
  .row {
    grid-column: 1;
    z-index: 1;
    margin-inline: 1px;
    padding-inline: 0.75rem;
    color: transparent;
    font-size: max(1rem, 16px);
    line-height: 1.6;
    pointer-events: none;
    user-select: none;
    scroll-margin: 5rem 0;
    transition: background-color 0.2s;
  }
  .row.current {
    background: var(--surface-2);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  /* Takes no height, so however tall its field, the rows stay as tall as
     their text. */
  .gutter {
    grid-column: 2;
    align-self: start;
    height: 0;
  }
</style>
