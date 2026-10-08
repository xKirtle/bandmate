<script lang="ts" module>
  import type { Line } from './api';

  /** How a Section's Cues show on the text box of its active Alternate. */
  export interface Cueing {
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
      /** Given, a ▶ beside each Cue plays from it. */
      play?: (to: number) => void;
      /** Why a Line's Cue is out of order, or null if it isn't. */
      outOfOrder: (line: number) => string | null;
    };
    /**
     * Given, as in Sync mode, the text is read-only, the Line up next has a
     * Now button in its gutter slot, and clicking a Line makes it next.
     */
    sync?: {
      /** The Line up next, wherever it is: only one of this Alternate's is marked. */
      next: number | null;
      /** Cues the Line up next at the playhead. */
      now: () => void;
      /** Makes a Line the next one. */
      pick: (line: number) => void;
    };
  }
</script>

<script lang="ts">
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import { onDestroy, untrack } from 'svelte';
  import type { Alternate } from './api';
  import CueField from './CueField.svelte';
  import { isBlank, linesByRow } from './cues';
  import { rowAt, type GutterField } from './gutter';
  import { keyHints } from './keyHints';
  import type { LyricSheetEditing } from './lyricSheetEditing.svelte';
  import { shortcuts } from './shortcuts';

  let {
    alternate,
    sectionId,
    label,
    editing,
    cueing,
  }: {
    alternate: Alternate;
    /** The Section whose editor the text box is in. */
    sectionId: number;
    /** Names the text box for screen readers. */
    label: string;
    /** Saves the text typed, and holds it while it isn't saved. */
    editing: LyricSheetEditing;
    /** Given, the Lines get a backdrop behind the text box to highlight and cue them. */
    cueing?: Cueing;
  } = $props();

  // Saves always go to the Alternate this box was made for; a different
  // Alternate gets its own box.
  const box = untrack(() => editing.textBox(alternate.id, sectionId));
  const text = $derived(box.text);

  // The box going away, as on leaving the page, doesn't blur the text box.
  onDestroy(box.close);

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

  // The row under the pointer, so its Line's gutter shows its ✕. The text box
  // takes the pointer over the rows, so it's found by height.
  const rowEls: (HTMLElement | null | undefined)[] = [];
  let hoveredRow = $state<number | null>(null);

  function pointed(e: PointerEvent) {
    const rects = rowEls.slice(0, rows.length).map((el) => el?.getBoundingClientRect() ?? { top: 0, bottom: 0 });
    hoveredRow = rowAt(rects, e.clientY);
  }

  // The Now button names its keys as this platform does, but only with a
  // keyboard and mouse.
  const hints = keyHints();
  const cueNextKeys = shortcuts.cueNextLine.keys;
</script>

<label class="visually-hidden" for="text-{alternate.id}">{label}</label>
<!-- The backdrop renders the rows again behind the text box, wrapping them
     the same way, so each row's highlight and Cue line up with its text. The
     text box sits on top and takes every click, so it never plays, except
     in Sync mode, where clicks go through it to the rows to pick them. -->
<!-- Hovering only shows a Line's ✕; the keyboard reaches it in the gutter slot. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="line-field"
  class:cued={cueing}
  class:with-gutter={cueing?.gutter}
  class:syncing={cueing?.sync}
  style:--rows={rows.length}
  onpointermove={cueing?.gutter ? pointed : undefined}
  onpointerleave={() => (hoveredRow = null)}
>
  {#if cueing}
    <div class="backdrop"></div>
    {#each rows as row, i (i)}
      {@const line = rowLines[i]}
      {@const gridRow = i + 2}
      {#if line}
        <!-- Sync mode skips Chord Lines, so only Lines with words are picked. -->
        {@const sync = cueing.sync && !isBlank(line) && !line.chordLine ? cueing.sync : undefined}
        <!-- Picking a Line is also in its gutter slot, which takes the keyboard. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          bind:this={rowEls[i]}
          class="row"
          class:current={line.id === cueing.current}
          class:pickable={sync}
          style:grid-row={gridRow}
          aria-hidden="true"
          title={sync ? 'Cue this Line next' : undefined}
          onclick={sync ? () => sync.pick(line.id) : undefined}
          {@attach (el) => cueing.track(el, line.id)}
        >
          {row || ' '}
        </div>
      {:else}
        <div bind:this={rowEls[i]} class="row" style:grid-row={gridRow} aria-hidden="true">{row || ' '}</div>
      {/if}
      {#if cueing.gutter && line && !isBlank(line)}
        {@const gutter = cueing.gutter}
        {@const sync = cueing.sync}
        {@const lineLabel = `Line ${alternate.lines.indexOf(line) + 1}${gutter.labelSuffix}`}
        <div class="gutter" style:grid-row={gridRow}>
          {#if sync && line.id === sync.next}
            <!-- Clicked, it keeps focus where it was, so Space still plays and pauses. -->
            <button
              type="button"
              class="now"
              onpointerdown={(e) => e.preventDefault()}
              onclick={sync.now}
              aria-label="Cue {lineLabel} now"
              aria-keyshortcuts={hints.aria(cueNextKeys)}
              title={hints.withKeys('Cue this Line at the playhead', cueNextKeys)}>Now <CornerDownLeft /></button
            >
          {:else}
            <CueField
              bind:this={() => undefined, (field) => gutter.field(line.id, field)}
              cue={line.cue}
              label={lineLabel}
              save={(cue) => gutter.save(line, cue)}
              typing={editing.typing}
              section={sectionId}
              next={() => gutter.next(line.id)}
              play={gutter.play}
              current={line.id === cueing.current}
              hovered={i === hoveredRow}
              pick={sync && !line.chordLine ? () => sync.pick(line.id) : undefined}
              syncing={!!sync}
              outOfOrder={gutter.outOfOrder(line.id)}
            />
          {/if}
        </div>
      {/if}
    {/each}
  {/if}
  <textarea
    id="text-{alternate.id}"
    class="text"
    bind:value={() => text, box.type}
    readonly={!!cueing?.sync}
    onfocus={box.focus}
    onblur={box.blur}
    rows="3"
    placeholder="Write the Lines here, one per line"
    autocapitalize="sentences"
    {@attach fitText}></textarea>
</div>

<style>
  .text {
    display: block;
    min-height: 5.5rem;
    background: var(--bg);
    font-size: var(--lyric-write);
    line-height: var(--leading-content);
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
  .line-field.cued {
    --inset-block: calc(var(--space-2) + 1px);
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--inset-block) repeat(var(--rows), auto) minmax(var(--inset-block), 1fr);
    column-gap: var(--space-2);
  }
  .line-field.with-gutter {
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
    border-radius: var(--radius-md);
    background: var(--bg);
  }
  /* Set like the text box's text, so it wraps the same; its text is never
     seen, only its highlight. */
  .row {
    grid-column: 1;
    z-index: 1;
    margin-inline: 1px;
    padding-inline: var(--space-3);
    color: transparent;
    font-size: var(--lyric-write);
    line-height: var(--leading-content);
    pointer-events: none;
    user-select: none;
    scroll-margin: 5rem 0;
    transition: background-color var(--duration-base) var(--ease);
  }
  /* Highlighted as in Read mode. */
  .row.current {
    background: var(--surface-1);
    box-shadow: var(--selected-edge);
  }
  .syncing .text {
    pointer-events: none;
  }
  .row.pickable {
    pointer-events: auto;
    cursor: pointer;
  }
  /* As wide as a Cue's ▶, time and ✕, so the gutter doesn't shift as it moves on. */
  .now {
    width: var(--cue-slot);
    min-height: 1.5rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
  }
  /* Takes no height, so however tall its field, the rows stay as tall as
     their text. */
  .gutter {
    grid-column: 2;
    align-self: start;
    height: 0;
  }
</style>
