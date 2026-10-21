<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Eraser from '@lucide/svelte/icons/eraser';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Cueing } from './AlternateText.svelte';
  import type { Section, Song } from './api';
  import type { CueChange } from './cueChanges';
  import { CueGutter } from './cueGutter.svelte';
  import { canShiftCuesEarlier, currentPosition, everyCue, hasCues } from './cues';
  import { follower, lineKey } from './follow';
  import { keyHints } from './keyHints';
  import { chordsInRead } from './chordChart';
  import ChordChart from './ChordChart.svelte';
  import ChordPopover from './ChordPopover.svelte';
  import LyricSheetView from './LyricSheetView.svelte';
  import ActionsMenu from './ActionsMenu.svelte';
  import CuesMenu from './CuesMenu.svelte';
  import type { MenuAction } from './menu';
  import ReadingMenu from './ReadingMenu.svelte';
  import type { LyricSheetEditing } from './lyricSheetEditing.svelte';
  import SectionEditor from './SectionEditor.svelte';
  import type { Drop } from './sectionDrag';
  import type { SectionDragging } from './sectionDragging.svelte';
  import { dropMove, sectionMove, type Landing, type SectionMove } from './sectionMoves';
  import type { SheetNotice } from './sheetNotice.svelte';
  import { describe, isEmpty, places, sectionsInArrangement } from './sections';
  import type { Mode } from './songMode';
  import { rebound } from './shortcutKeys';
  import { cuesNextLine } from './syncKeys';
  import type { SyncMode } from './syncMode.svelte';
  import type { RhymeMode } from './rhymeMode.svelte';
  import { songChordsShown } from './chordsShown';
  import { lyricSize } from './sharedLyricSize.svelte';
  import { songTranspose } from './sharedTranspose.svelte';
  import type { CaretListener } from './lyricsLanguage';

  let {
    song,
    mode,
    drag,
    changeCues,
    editing,
    playhead = null,
    hasClips = false,
    playFrom,
    recording = false,
    syncMode,
    rhymeMode,
    onCaret,
    notice,
  }: {
    song: Song;
    /** The Song page's mode: Write edits the raw text; Read shows Chords above the lyrics. */
    mode: Mode;
    /** The drag of a Section, shared with the Scrapbook. */
    drag: SectionDragging;
    /**
     * Makes a Cue change, shown at once and undone with the Timeline's edits,
     * naming what it changes, e.g. "the Cue of Line 3 of Verse", in case it
     * has to be taken back; resolves to whether it was saved.
     */
    changeCues: (change: CueChange, what: string) => Promise<boolean>;
    /**
     * Makes every change to the Lyric Sheet, ending Sync mode as it does,
     * saves the Lines typed, and holds the edits typed into the Lyric Sheet
     * while they aren't saved.
     */
    editing: LyricSheetEditing;
    /** Where the Timeline is playing, in seconds; null while it isn't. */
    playhead?: number | null;
    /** Whether the Timeline has any Clip, so there's something to cue to. */
    hasClips?: boolean;
    /** Plays the Timeline from a time, or jumps there if it's playing, e.g. to lead into a Cue from its ▶. */
    playFrom?: (at: number) => void;
    /** Whether the Timeline is recording, which keeps Sync mode off, to say why it can't come on. */
    recording?: boolean;
    /** Sync mode, which the Lyric Sheet draws, and sends its switching, cueing and picking through. */
    syncMode: SyncMode;
    /** Rhyme mode, whose toggle the Lyric Sheet draws, where it can be on. */
    rhymeMode: RhymeMode;
    /** Given, as in Rhyme mode, hears where the caret is in a Section's Lines, to suggest Rhymes. */
    onCaret?: CaretListener;
    /** What the Lyric Sheet says about a Section just moved, which it shows, said from here and the Scrapbook alike. */
    notice: SheetNotice;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  // What taking a Section out of the Arrangement does to it: it goes to the
  // Scrapbook, or is deleted if nothing is written in it.
  function removal(section: Section): { label: string; title: string } {
    if (isEmpty(section)) {
      return { label: 'Delete this Section', title: "Delete this Section: nothing is written in it, so it isn't kept" };
    }
    return {
      label: 'Move to the Scrapbook',
      title: 'Move to the Scrapbook: take it out of the Lyric Sheet but keep it',
    };
  }
  // A Section's actions after ↑ and ↓, folded into ⋯ on phones.
  function sectionActions(section: Section, i: number): MenuAction[] {
    const actions: MenuAction[] = [
      { icon: Plus, label: 'Add a Section below', run: () => add(i + 1) },
      { icon: CopyPlus, label: 'Duplicate this Section below', run: () => duplicate(section.id, i + 1) },
    ];
    if (gutter.offered && hasCues({ arrangement: [section.id], sections: song.sections })) {
      // Doesn't ask first: it can be undone. It clears dormant Cues too.
      actions.push({
        icon: Eraser,
        label: "Clear this Section's Cues",
        run: () =>
          changeCues({ kind: 'clearSectionCues', sectionId: section.id }, `clearing the Cues of ${describe(section)}`),
      });
    }
    const others = inArrangement.filter((other) => other.id !== section.id);
    if (others.length > 0) {
      // Where there's room, it's dragged onto the Section instead.
      actions.push({
        icon: ArrowLeftRight,
        label: 'Add as an Alternate of…',
        choices: others.map((other) => ({
          label: describe(other),
          run: () => apply(sectionMove(song, { ontoSection: { sectionId: section.id, targetId: other.id } })),
        })),
      });
    }
    actions.push({
      icon: X,
      ...removal(section),
      run: () => apply(sectionMove(song, { outOfArrangement: section.id })),
    });
    return actions;
  }
  // The Sections in the Arrangement, in order: the ones a Duplicate can be
  // made of.
  const inArrangement = $derived(sectionsInArrangement(song, sections));
  // Where an Alternate can be moved out to, as a Section of its own.
  const placesOut = $derived(places(inArrangement));
  // Cues are edited in Write mode, on wider screens only; whether the gutter
  // is offered at all, and everything else it keeps, is the Cue gutter's
  // own: see cueGutter.svelte.ts. It's made once here, for the whole page,
  // and each Section's Lines ask it.
  const wide = new MediaQuery('min-width: 40.0625rem');
  const gutter = new CueGutter({
    song: () => song,
    wide: () => wide.current,
    hasClips: () => hasClips,
    cue: (change, what) => changeCues(change, what),
    playFrom: () => playFrom,
    // Read as it's asked for, like the rest, so the gutter never holds a
    // Sync mode the page has moved on from.
    get sync() {
      return syncMode;
    },
  });

  // In Write mode, each Line is tracked, to follow playback to. Read mode
  // follows playback in LyricSheetView.
  const { track, follow } = follower();

  /** How a Section's Cues show on its text box in Write mode. */
  function cueingFor(section: Section): Cueing {
    return {
      current: current?.line ?? null,
      track: (el, line) => track(el, lineKey(line)),
      gutter: gutter.offered
        ? {
            labelSuffix: gutter.labelSuffix(section.id),
            save: (line, cue) => gutter.save({ section: section.id, line: line.id }, cue),
            has: (line) => gutter.has(line),
            field: (line, field) => gutter.setField(line, field),
            next: (line) => gutter.editAfter(line),
            play: gutter.play,
            outOfOrder: (line) => gutter.outOfOrder(line),
          }
        : undefined,
      sync: gutter.syncing
        ? {
            next: gutter.upNext,
            now: () => gutter.now(),
            pick: (line) => gutter.pick({ section: section.id, line }),
          }
        : undefined,
    };
  }

  // Sync mode cues the next Line at the playhead with Enter, or its Now
  // button, in Write mode on wider screens only, and only once there's a
  // Clip to cue along to: see syncMode.svelte.ts. The Line up next is
  // marked by a Now button in its gutter slot.
  const upNext = $derived(syncMode.next);

  // Where playback is in the Lyric Sheet. In Sync mode, the Line up next is
  // being retaken, so its old Cue is ignored until it's cued again.
  const current = $derived(playhead === null ? null : currentPosition(song, playhead, upNext));
  // Write mode shows every Line, Chord Lines included, so whatever is
  // current is on screen.
  const writeKey = $derived(mode === 'write' && current ? lineKey(current.line) : null);

  // Playback is followed down the Lyric Sheet in Write mode, but in Sync
  // mode it's the Line up next that's kept in view instead: following both
  // would pull the page two ways at once.
  const followKey = $derived(syncMode.on ? upNext && lineKey(upNext.line) : writeKey);
  $effect(() => {
    follow(followKey);
  });

  // The Sync hints name the keys that cue as this platform does, but only
  // with a keyboard and mouse: on a phone or a narrow window, Now is the
  // way to cue.
  const hints = keyHints();
  const cueNextLabel = $derived(hints.label(rebound().cueNextLine.keys));
  const cueNextWays = $derived(cueNextLabel ? `${cueNextLabel} or Now` : 'Now');

  // In Sync mode, Enter cues on a button too, and anywhere else it isn't the
  // control's own, e.g. a text field's or a popover's: syncing along
  // shouldn't depend on where focus was left.
  function cueKey(event: KeyboardEvent) {
    if (!cuesNextLine(event, syncMode.on)) return;
    event.preventDefault();
    syncMode.cue();
  }

  // The Section just added or duplicated, whose Label gets focus as it
  // shows, and only then: the same Section brought back later, by an Undo
  // or a Redo, comes back without taking focus.
  let focusing = $state<number | null>(null);

  /** Focuses the Label of the Section just added, which shows by the next tick, as the Song is replaced once the change is saved. */
  async function focusAdded(sectionId: number | null) {
    focusing = sectionId;
    await tick();
    focusing = null;
  }

  // Where the Song has Chords, as Read mode shows it: only the Arrangement's
  // active Alternates count.
  const chords = $derived(chordsInRead(song));
  // Whether Read mode shows the Chords, kept on this device for each Song.
  // It isn't an edit, so it's never saved with the Song.
  // Read again only for another Song: the Song is replaced after every edit.
  const songId = $derived(song.id);
  const showChords = $derived(songChordsShown.of(songId));

  // Whether Chord Lines are on screen: always in Write mode, which shows the raw text.
  const chordsOnScreen = $derived(mode === 'write' || (showChords && chords === 'shown'));

  // A Chord's diagram, opened from a Chord in a Line or the Chord Chart in
  // Read mode while the Chords show.
  let chordPopover = $state<ChordPopover>();

  // How far Read mode transposes the Chords, kept on this device for each
  // Song like hiding them, and kept while they're hidden.
  const transpose = $derived(songTranspose.of(songId));

  // How large Read mode shows the lyrics, kept on this device for every Song.
  const size = $derived(lyricSize.value);

  async function add(position: number) {
    if (await editing.change({ kind: 'addSection', position })) {
      await focusAdded(song.arrangement[position] ?? null);
    }
  }

  /** Duplicates a Section at position in the Arrangement, or at the end. */
  async function duplicate(sectionId: number, position?: number) {
    if (await editing.change({ kind: 'duplicateSection', sectionId, position })) {
      await focusAdded((position === undefined ? song.arrangement.at(-1) : song.arrangement[position]) ?? null);
    }
  }

  /** What the Tour calls the Section at index, which it spotlights the first and last of. */
  function tourName(index: number) {
    if (index === 0) return 'first-section';
    if (index === song.arrangement.length - 1) return 'last-section';
    return undefined;
  }

  function move(index: number, by: -1 | 1) {
    apply(sectionMove(song, { within: { from: index, to: index + by } }));
  }

  // On desktop, a Section is also dragged by the grip on its header: within
  // the Arrangement, or out of it to the Scrapbook. A drop within it saves
  // the same order as pressing ↑ or ↓ that many times, so Cues go with their
  // Sections.
  // The gap the dragged Section would land in, if it moves at all.
  const dropAt = $derived(drag.drop && 'gap' in drag.drop ? drag.drop.gap : null);
  // The place in the Arrangement of the Section the dragged one would be
  // added to.
  const dropOnto = $derived(drag.drop && 'addTo' in drag.drop ? drag.drop.addTo.arrangementAt : null);

  // Where a Section dropped by its grip lands, and what that comes to, is
  // worked out in one place (see sectionMoves.ts), as it is for the ↑ and ↓
  // and the menu choices that move a Section from the keyboard.
  const dropSection = (drop: Drop) => apply(dropMove(song, drop));

  /**
   * Makes a move's change, saying what it says once it's saved. A Section
   * added to another, or taken out, isn't asked first: it's undone by moving
   * it back. Everything still being typed in a Section remade is sent first,
   * by Lyric Sheet editing, which leaves the caret where it is (see
   * LyricSheetEditing.change).
   */
  async function apply(move: SectionMove | null) {
    if (!move) return false;
    if (!(await editing.change(move.change))) return false;
    if (move.notice) notice.say(move.notice);
    // Nothing of a move made here closes: only the Scrapbook shows a Section
    // in an editor of its own, so move.closes is never one of these Sections.
    return true;
  }

  /** Makes a move of one of a Section's Alternates, for its editor. */
  const moveOut = (landing: Landing) => apply(sectionMove(song, landing));

  function onKey(event: KeyboardEvent) {
    if (drag.current && event.key === 'Escape') {
      event.preventDefault();
      drag.cancel();
      return;
    }
    cueKey(event);
  }
</script>

<svelte:window onkeydown={onKey} onscroll={() => drag.current && drag.aim(drag.current.x, drag.current.y)} />

<section class="sheet" aria-labelledby="sheet-heading">
  <div class="head">
    <!-- Read mode keeps its chrome out of the way of the Lines: the heading is for screen readers only. -->
    <h2 id="sheet-heading" class:visually-hidden={mode === 'read'}>Lyric Sheet</h2>
    <span class="spacer"></span>
    {#if mode === 'read'}
      <ReadingMenu {songId} {chords} />
    {/if}
    {#if rhymeMode.canBeOn}
      <!-- Clicked, it keeps focus where it was, so the caret stays on the word it suggests Rhymes for. -->
      <button
        type="button"
        class="button toggle"
        aria-pressed={rhymeMode.on}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => rhymeMode.switch()}
        title="Suggest Rhymes for the word at the cursor">Rhymes</button
      >
    {/if}
    {#if mode === 'write' && wide.current}
      <!-- Clicked, it keeps focus where it was, so Space then plays rather than switching it back off. -->
      <button
        type="button"
        class="button toggle"
        aria-pressed={syncMode.on}
        disabled={!syncMode.canBeOn}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => syncMode.switch()}
        title={recording
          ? 'Stop recording to sync lyrics'
          : syncMode.canBeOn
            ? `Sync lyrics: press ${cueNextWays} as each Line starts to cue it at the playhead`
            : 'Add a Beat to the Timeline to sync lyrics to it'}>Sync lyrics</button
      >
    {/if}
    {#if mode === 'write' && gutter.offered && hasCues(song)}
      <CuesMenu
        shift={(by) => changeCues({ kind: 'shiftCues', ...everyCue, by }, 'shifting every Cue')}
        clear={() => changeCues({ kind: 'clearCues' }, 'clearing every Cue')}
        canShiftEarlier={(step) => canShiftCuesEarlier(song, step)}
      />
    {/if}
    <p class="notice muted" role="status">{notice.text ?? ''}</p>
    {#if syncMode.hint}
      <p class="sync-hint muted">
        Play, then press {cueNextWays} as each Line starts. Click a Line to start from it.
      </p>
    {/if}
  </div>

  {#if song.arrangement.length === 0}
    <p class="muted">
      No Sections here yet.{#if mode === 'write'}
        Add one to start writing{song.scrapbook.length > 0 ? ', or put one back from the Scrapbook' : ''}.{/if}
    </p>
  {/if}

  {#if mode === 'read'}
    {#if chordsOnScreen}
      <ChordChart {song} {transpose} opener={chordPopover?.opener} />
      <!-- Transposing closes it, rather than leave it on a Chord no longer shown. -->
      {#key transpose}
        <ChordPopover {song} bind:this={chordPopover} />
      {/key}
    {/if}
    <LyricSheetView
      {song}
      showChords={chordsOnScreen}
      {transpose}
      {size}
      {current}
      play={gutter.play}
      opener={chordPopover?.opener}
    />
  {:else}
    <ol
      class="arrangement"
      class:drop-into={dropAt === 0 && song.arrangement.length === 0}
      {@attach drag.placeArrangement}
    >
      {#each song.arrangement as sectionId, i (sectionId)}
        {@const section = sections.get(sectionId)}
        {#if section}
          <li
            class:dragged={drag.arrangementAt === i}
            class:drop-above={dropAt === i}
            class:drop-below={dropAt === song.arrangement.length && i === song.arrangement.length - 1}
            class:drop-onto={dropOnto === i}
            data-section={sectionId}
            {@attach (el) => drag.placeRow(el, i)}
          >
            <SectionEditor
              {section}
              {moveOut}
              dropped={dropSection}
              autofocus={focusing === section.id}
              {editing}
              cueing={cueingFor(section)}
              {onCaret}
              more={sectionActions(section, i)}
              {drag}
              places={placesOut}
              tour={tourName(i)}
            >
              {#snippet grip()}
                {#if drag.on}
                  <!-- Pointer only: ↑ and ↓ move it from the keyboard, × to the Scrapbook, and ⋯ onto a Section. -->
                  <span
                    class="grip"
                    aria-hidden="true"
                    title="Drag to move, onto the Scrapbook, or onto another Section to add it as Alternates; Esc cancels"
                    {...drag.grip({ arrangementAt: i }, dropSection)}><GripVertical /></span
                  >
                {/if}
              {/snippet}
              {#snippet actions()}
                <button type="button" class="icon" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  class="icon"
                  onclick={() => move(i, 1)}
                  disabled={i === song.arrangement.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown />
                </button>
              {/snippet}
            </SectionEditor>
          </li>
        {/if}
      {/each}
    </ol>

    <div class="add-row">
      <button type="button" class="button add" onclick={() => add(song.arrangement.length)}>Add Section</button>
      {#if inArrangement.length > 0}
        <div class="duplicate">
          <ActionsMenu
            label="Duplicate a Section at the end"
            text="Duplicate a Section…"
            align="start"
            entries={inArrangement.map((section) => ({ label: describe(section), run: () => duplicate(section.id) }))}
          />
        </div>
      {/if}
    </div>
    <p class="hint muted">Put Chords in brackets where they fall: <code>Hel[Am]lo</code>.</p>
  {/if}
</section>

<style>
  .sheet {
    margin-bottom: var(--space-8);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  h2 {
    font-size: var(--text-lg);
    margin: 0;
  }
  .spacer {
    flex: 1;
  }
  .notice:empty {
    display: none;
  }
  .sync-hint,
  .notice {
    flex-basis: 100%;
    margin: 0;
    font-size: var(--text-sm);
  }
  .hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
  }
  .arrangement {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 1.25rem;
    min-height: var(--control);
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .grip:hover {
    color: var(--text);
  }
  .arrangement > li {
    position: relative;
  }
  .arrangement > .dragged {
    opacity: 0.5;
  }
  .arrangement > .dragged .grip {
    cursor: grabbing;
  }
  /* The drop shows in the gap the dragged Section would land in. */
  .arrangement > .drop-above::before,
  .arrangement > .drop-below::after,
  .drop-into::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  .arrangement > .drop-above::before {
    top: calc(-0.375rem - 1.5px);
  }
  .arrangement > .drop-below::after {
    bottom: calc(-0.375rem - 1.5px);
  }
  /* A Section dropped onto another joins its Alternates: the
     Section is outlined, unlike the line a drop into a gap shows. */
  .arrangement > .drop-onto {
    outline: 2px dashed var(--accent);
    outline-offset: 0.25rem;
    border-radius: var(--radius-lg);
  }
  .arrangement > .drop-onto::after {
    content: 'Add as Alternates';
    position: absolute;
    top: -0.625rem;
    right: 0.75rem;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.25rem;
  }
  /* An empty Arrangement shows where a Section put back from the Scrapbook lands. */
  .arrangement {
    position: relative;
  }
  .drop-into {
    min-height: 0.75rem;
  }
  .drop-into::before {
    top: calc(0.375rem - 1.5px);
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .add,
  .duplicate {
    flex: 1 1 12rem;
    width: auto;
  }
  .duplicate :global(.button) {
    width: 100%;
  }
</style>
