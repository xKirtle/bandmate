<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Eraser from '@lucide/svelte/icons/eraser';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Cueing } from './AlternateText.svelte';
  import type { Line, Section, Song } from './api';
  import type { CueChange } from './cueChanges';
  import {
    canShiftCuesEarlier,
    currentPosition,
    everyCue,
    hasCues,
    isBlank,
    leadIn,
    outOfOrderCues,
    outOfOrderReason,
    type Position,
  } from './cues';
  import { follower, lineKey } from './follow';
  import { gutterFields } from './gutter';
  import { keyHints } from './keyHints';
  import { chordsInRead } from './chordChart';
  import ChordChart from './ChordChart.svelte';
  import ChordPopover from './ChordPopover.svelte';
  import LyricSheetView from './LyricSheetView.svelte';
  import ActionsMenu from './ActionsMenu.svelte';
  import type { MenuAction } from './menu';
  import Picker from './Picker.svelte';
  import ReadingMenu from './ReadingMenu.svelte';
  import type { LyricSheetEditing } from './lyricSheetEditing.svelte';
  import SectionEditor from './SectionEditor.svelte';
  import { moveTo, type Drop } from './sectionDrag';
  import type { SectionDragging } from './sectionDragging.svelte';
  import {
    activeAlternate,
    addedNotice,
    describe,
    isEmpty,
    lineName as nameLine,
    places,
    sectionsInArrangement,
  } from './sections';
  import type { Mode } from './songMode';
  import { readShiftStep, shiftSteps, storeShiftStep, type ShiftStep } from './shiftStep';
  import { shortcuts } from './shortcuts';
  import { cuesNextLine } from './syncKeys';
  import type { SyncMode } from './syncMode.svelte';
  import { inTextField } from './textField';
  import { deviceStorage } from './deviceStorage';
  import { songChordsShown } from './chordsShown';
  import { lyricSize } from './sharedLyricSize.svelte';
  import { songTranspose } from './sharedTranspose.svelte';

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
    if (canCue && hasCues({ arrangement: [section.id], sections: song.sections })) {
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
        choices: others.map((other) => ({ label: describe(other), run: () => addTo(section, other) })),
      });
    }
    actions.push({
      icon: X,
      ...removal(section),
      run: () => editing.change({ kind: 'removeFromArrangement', sectionId: section.id }),
    });
    return actions;
  }
  // The Sections in the Arrangement, in order: the ones a Duplicate can be
  // made of.
  const inArrangement = $derived(sectionsInArrangement(song, sections));
  // Where an Alternate can be moved out to, as a Section of its own.
  const placesOut = $derived(places(inArrangement));
  // Cues are edited in Write mode, on wider screens only, and only once
  // there's something to cue to or a Cue already set.
  const wide = new MediaQuery('min-width: 40.0625rem');
  const canCue = $derived(wide.current && (hasClips || hasCues(song)));
  // Playing from a Cue's ▶, or a cued Line in Read mode, leads into it.
  const leadInto = $derived(playFrom && ((cue: number) => playFrom(leadIn(cue))));

  // Shifting every Cue, dormant ones included, by a step: each click is one
  // shift, saved at once and undone like any Cue edit. The step is
  // remembered on this device.
  let shiftStep = $state<ShiftStep>(readShiftStep(deviceStorage()));
  const canShiftEarlier = $derived(canShiftCuesEarlier(song, shiftStep));

  function chooseShiftStep(step: ShiftStep) {
    shiftStep = step;
    storeShiftStep(deviceStorage(), step);
  }

  function shiftEveryCue(by: number) {
    changeCues({ kind: 'shiftCues', ...everyCue, by }, 'shifting every Cue');
  }

  /** Sets or, with null, clears the Cue of a Line, as the gutter names it. */
  function setLineCue(line: Position, cue: number | null) {
    changeCues({ kind: 'setLineCue', lineId: line.line, cue }, `the Cue of ${lineName(line)}`);
  }

  // In Write mode, each Line is tracked, to follow playback to, and each
  // Line's Cue field, to go on to with Enter. Read mode follows playback in
  // LyricSheetView, and has no Cue fields.
  const { track, follow } = follower();
  const writeFields = gutterFields();
  /** The Lines of a Section's active Alternate: those whose Cues are in effect. */
  function activeLines(section: Section | undefined): Line[] {
    return activeAlternate(section)?.lines ?? [];
  }
  /** Ends a Line's name with its Section's Label, e.g. " of Chorus", as the gutter names Lines. */
  function ofSection(label: string | undefined): string {
    return label ? ` of ${label}` : '';
  }
  // The Line Cue fields in order down the page.
  const writeFieldOrder = $derived(
    inArrangement.flatMap((s) =>
      activeLines(s)
        .filter((l) => !isBlank(l))
        .map((l) => lineKey(l.id)),
    ),
  );

  // Cues out of order are marked in the gutter, each naming the Line it's
  // out of order with as the gutter names Lines, e.g. "Line 6 of Chorus".
  const outOfOrder = $derived(new Map(outOfOrderCues(song).map((c) => [c.line, c])));

  function lineName(line: Position): string {
    return nameLine(song, line);
  }

  /** How a Section's Cues show on its text box in Write mode. */
  function cueingFor(section: Section): Cueing {
    return {
      current: current?.line ?? null,
      track: (el, line) => track(el, lineKey(line)),
      gutter: canCue
        ? {
            labelSuffix: ofSection(section.label),
            save: (line, cue) => setLineCue({ section: section.id, line: line.id }, cue),
            field: (line, field) => writeFields.set(lineKey(line), field),
            next: (line) => writeFields.editAfter(writeFieldOrder, lineKey(line)),
            play: leadInto,
            outOfOrder: (line) => {
              const mark = outOfOrder.get(line);
              return mark ? outOfOrderReason(mark, lineName) : null;
            },
          }
        : undefined,
      sync: syncMode.on
        ? {
            next: upNext?.line ?? null,
            now: () => syncMode.cue(),
            pick: (line) => syncMode.pick({ section: section.id, line }),
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
  const cueNextLabel = $derived(hints.label(shortcuts.cueNextLine.keys));
  const cueNextWays = $derived(cueNextLabel ? `${cueNextLabel} or Now` : 'Now');

  // In Sync mode, Enter cues anywhere but a text field or a dialog, even on
  // a button: syncing along shouldn't depend on where focus was left.
  function cueKey(event: KeyboardEvent) {
    const at = {
      syncing: syncMode.on,
      inTextField: inTextField(event.target),
      inDialogOrMenu: event.target instanceof Element && !!event.target.closest('dialog, [role="menu"]'),
    };
    if (!cuesNextLine(event, at)) return;
    event.preventDefault();
    syncMode.cue();
  }

  // The Section just added or duplicated, whose Label gets focus.
  let added = $state<number | null>(null);
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
      added = song.arrangement[position] ?? null;
    }
  }

  /** Duplicates a Section at position in the Arrangement, or at the end. */
  async function duplicate(sectionId: number, position?: number) {
    if (await editing.change({ kind: 'duplicateSection', sectionId, position })) {
      added = (position === undefined ? song.arrangement.at(-1) : song.arrangement[position]) ?? null;
    }
  }

  function move(index: number, by: -1 | 1) {
    const order = moveTo(song.arrangement, index, index + by);
    editing.change({ kind: 'reorderArrangement', order });
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

  function dropSection(drop: Drop) {
    if ('reorder' in drop) {
      const { from, to } = drop.reorder;
      const order = moveTo(song.arrangement, from, to);
      editing.change({ kind: 'reorderArrangement', order });
    } else if ('toScrapbook' in drop) {
      toScrapbook(drop.toScrapbook);
    } else if ('addTo' in drop && 'arrangementAt' in drop.addTo.dragged) {
      const from = sections.get(song.arrangement[drop.addTo.dragged.arrangementAt]);
      const to = sections.get(song.arrangement[drop.addTo.arrangementAt]);
      if (from && to) addTo(from, to);
    }
  }

  // A Section added to another leaves the Lyric Sheet, its Alternates joining
  // the other's, inactive, which a notice says: it isn't asked first, and
  // it's undone by moving them to the Scrapbook and back.
  async function addTo(section: Section, to: Section) {
    // Its Alternates are made anew in the Section they join, and an unnamed
    // one is named after its Label, so a Label or an Alternate name still
    // being typed in its editor is saved first: they save as they blur,
    // which a drag doesn't do. Lyric Sheet editing sends its Lines text first.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest(`[data-section="${section.id}"]`)) focused.blur();
    const said = addedNotice(section, to);
    if (await editing.change({ kind: 'addToSection', sectionId: section.id, targetId: to.id })) notice = said;
  }

  // Dropped on the Scrapbook, a Section goes to its end, or isn't kept if
  // nothing is written in it, which a notice says.
  async function toScrapbook(index: number) {
    const section = sections.get(song.arrangement[index]);
    if (!section) return;
    const empty = isEmpty(section);
    const name = describe(section);
    if ((await editing.change({ kind: 'removeFromArrangement', sectionId: section.id })) && empty) {
      notice = `Nothing was written in ${name}, so it wasn't kept.`;
    }
  }

  let notice = $state<string | null>(null);
  $effect(() => {
    if (!notice) return;
    const shown = setTimeout(() => (notice = null), 5000);
    return () => clearTimeout(shown);
  });

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
    {#if mode === 'write' && canCue && hasCues(song)}
      <!-- Doesn't ask first: it can be undone. -->
      <button
        type="button"
        class="button"
        onclick={() => changeCues({ kind: 'clearCues' }, 'clearing every Cue')}
        title="Clear every Cue in the Song">Clear all Cues</button
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
    {#if mode === 'write' && canCue && hasCues(song)}
      <div class="shift" role="group" aria-labelledby="shift-label">
        <span id="shift-label">Shift Cues</span>
        <Picker
          id="shift-step"
          class="shift-step"
          aria-label="Step"
          title="How far each click shifts every Cue"
          options={shiftSteps}
          value={shiftStep}
          text={(step) => `${step} s`}
          onpick={chooseShiftStep}
        />
        <button
          type="button"
          class="button shift-by"
          disabled={!canShiftEarlier}
          onclick={() => shiftEveryCue(-shiftStep)}
          aria-label="Shift every Cue {shiftStep} s earlier"
          title={canShiftEarlier
            ? `Shift every Cue ${shiftStep} s earlier`
            : `A Cue is closer to 0:00 than ${shiftStep} s`}><Minus /></button
        >
        <button
          type="button"
          class="button shift-by"
          onclick={() => shiftEveryCue(shiftStep)}
          aria-label="Shift every Cue {shiftStep} s later"
          title="Shift every Cue {shiftStep} s later"><Plus /></button
        >
      </div>
    {/if}
    <p class="notice muted" role="status">{notice ?? ''}</p>
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
      play={leadInto}
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
            {@attach (el) => drag.placeSection(el, i)}
          >
            <SectionEditor
              {section}
              autofocus={added === section.id}
              {editing}
              cueing={cueingFor(section)}
              more={sectionActions(section, i)}
              {drag}
              places={placesOut}
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
  .shift {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-2);
  }
  .shift :global(.shift-step) {
    margin-left: var(--space-1);
  }
  .shift-by {
    min-width: var(--control);
    padding: 0;
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
