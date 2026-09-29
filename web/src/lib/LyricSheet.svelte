<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Cueing } from './AlternateText.svelte';
  import { api, suggestedLabels, type Line, type Occurrence, type Section, type Song, type SongAt } from './api';
  import { hasChords } from './chords';
  import {
    canShiftCuesEarlier,
    currentPosition,
    everyCue,
    hasCues,
    isBlank,
    leadIn,
    nextLine,
    outOfOrderCues,
    outOfOrderReason,
    type NextLine,
    type Position,
  } from './cues';
  import { follower, key } from './follow';
  import { gutterFields } from './gutter';
  import LyricSheetView from './LyricSheetView.svelte';
  import type { MenuAction } from './menu';
  import SectionEditor from './SectionEditor.svelte';
  import { moveTo, type Drop } from './sectionDrag';
  import type { SectionDrag } from './sectionDragging.svelte';
  import { activeAlternate, describe, isEmpty } from './sections';
  import type { Mode } from './songMode';
  import { readShiftStep, shiftSteps, storeShiftStep, type ShiftStep } from './shiftStep';
  import { markSyncHintSeen, sawSyncHint } from './syncHint';
  import { inTextField } from './textField';
  import { deviceStorage } from './timelineHeight';

  let {
    song,
    mode,
    change,
    drag,
    editCues,
    onUnsaved,
    playhead = null,
    hasClips = false,
    playFrom,
    playheadAt,
    loopOn = false,
    stopLoop,
  }: {
    song: Song;
    /** The Song page's mode: Write edits the raw text; Read shows Chords above the lyrics. */
    mode: Mode;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** The drag of a Section, shared with the Scrapbook. */
    drag: SectionDrag;
    /** Sends a Cue edit, to undo with the Timeline's edits; resolves to whether it succeeded. */
    editCues: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    onUnsaved: (editor: object, unsaved: boolean) => void;
    /** Where the Timeline is playing, in seconds; null while it isn't. */
    playhead?: number | null;
    /** Whether the Timeline has any Clip, so there's something to cue to. */
    hasClips?: boolean;
    /** Plays the Timeline from a time, or jumps there if it's playing, e.g. to lead into a Cue from its ▶. */
    playFrom?: (at: number) => void;
    /** Where the Timeline's playhead is, playing or paused, in seconds: where Sync mode cues a Line. */
    playheadAt?: () => number;
    /** Whether the Timeline's Loop is on, which switches Sync mode off: the two are exclusive. */
    loopOn?: boolean;
    /** Switches the Timeline's Loop off, as Sync mode comes on. */
    stopLoop?: () => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  // What taking an Occurrence out of the Arrangement does to its Section:
  // the others keep it, else it goes to the Scrapbook, or is deleted if
  // nothing is written in it.
  function removal(occurrence: Occurrence, section: Section): { label: string; title: string } {
    if (occurrence.shared) return { label: 'Remove this Occurrence', title: 'Remove this Occurrence; the others stay' };
    if (isEmpty(section)) {
      return { label: 'Delete this Section', title: "Delete this Section: nothing is written in it, so it isn't kept" };
    }
    return { label: 'Move to the Scrapbook', title: 'Move to the Scrapbook: take it out of the Lyric Sheet but keep it' };
  }
  // An Occurrence's actions after ↑ and ↓, folded into ⋯ on phones.
  function occurrenceActions(occurrence: Occurrence, section: Section, i: number): MenuAction[] {
    const actions: MenuAction[] = [
      { icon: '+', label: 'Add a Section below', run: () => add(i + 1) },
      { icon: '⧉', label: 'Repeat this Section below', run: () => addOccurrence(section.id, i + 1) },
    ];
    if (canCue && hasCues({ arrangement: [occurrence], sections: song.sections })) {
      // Doesn't ask first: it can be undone. It clears dormant Cues too.
      actions.push({
        icon: '⌀',
        label: "Clear this Occurrence's Cues",
        run: () => editCues((at) => api.clearOccurrenceCues(at, occurrence.id)),
      });
    }
    if (occurrence.shared) {
      actions.push({
        icon: '⑂',
        label: 'Detach into its own copy',
        title: 'Detach: give this Occurrence its own copy, so it can differ',
        run: () => change((at) => api.detach(at, occurrence.id)),
      });
    }
    actions.push({
      icon: '×',
      ...removal(occurrence, section),
      run: () => change((at) => api.removeOccurrence(at, occurrence.id)),
    });
    return actions;
  }
  // The Sections in the Arrangement, once each, in the order they first
  // appear: the ones another Occurrence can be added of.
  const inArrangement = $derived(
    [...new Set(song.arrangement.map((o) => o.sectionId))].flatMap((id) => sections.get(id) ?? []),
  );
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
    editCues((at) => api.shiftCues(at, everyCue.start, everyCue.end, by));
  }

  function setLineCue(occurrence: Occurrence, line: Line, cue: number | null) {
    editCues((at) =>
      cue === null ? api.clearLineCue(at, occurrence.id, line.id) : api.setLineCue(at, occurrence.id, line.id, cue),
    );
  }

  // In Write mode, each Occurrence's Lines are tracked, to follow playback
  // to, and each Line's Cue field, to go on to with Enter. Read mode follows
  // playback in LyricSheetView, and has no Cue fields.
  const { track, follow } = follower();
  const writeFields = gutterFields();
  /** The Lines of an Occurrence's Section's active Alternate: those whose Cues are in effect. */
  function activeLines(occurrence: Occurrence | undefined): Line[] {
    return activeAlternate(sections.get(occurrence?.sectionId ?? -1))?.lines ?? [];
  }
  /** Ends a Line's name with its Section's Label, e.g. " of Chorus", as the gutter names Lines. */
  function ofSection(label: string | undefined): string {
    return label ? ` of ${label}` : '';
  }
  // The Line Cue fields in order down the page.
  const writeFieldOrder = $derived(
    song.arrangement.flatMap((o) =>
      activeLines(o)
        .filter((l) => !isBlank(l))
        .map((l) => key(o.id, l.id)),
    ),
  );

  // Cues out of order are marked in the gutter, each naming the Line it's
  // out of order with as the gutter names Lines, e.g. "Line 6 of Chorus".
  const outOfOrder = $derived(new Map(outOfOrderCues(song).map((c) => [key(c.occurrence, c.line), c])));

  function lineName({ occurrence, line }: Position): string {
    const o = song.arrangement.find((o) => o.id === occurrence);
    const n = activeLines(o).findIndex((l) => l.id === line) + 1;
    return `Line ${n}${ofSection(sections.get(o?.sectionId ?? -1)?.label)}`;
  }

  /** How an Occurrence's Cues show on its Section's text box in Write mode. */
  function cueingFor(occurrence: Occurrence, label: string): Cueing {
    return {
      cues: occurrence.lineCues,
      current: current?.occurrence === occurrence.id ? current.line : null,
      track: (el, line) => track(el, key(occurrence.id, line)),
      gutter: canCue
        ? {
            labelSuffix: ofSection(label),
            save: (line, cue) => setLineCue(occurrence, line, cue),
            field: (line, field) => writeFields.set(key(occurrence.id, line), field),
            next: (line) => writeFields.editAfter(writeFieldOrder, key(occurrence.id, line)),
            play: leadInto,
            outOfOrder: (line) => {
              const mark = outOfOrder.get(key(occurrence.id, line));
              return mark ? outOfOrderReason(mark, lineName) : null;
            },
          }
        : undefined,
      sync: syncing
        ? {
            next: upNext?.occurrence === occurrence.id ? upNext.line : null,
            now: cueNext,
            pick: (line) => (syncFrom = { cued: null, picked: { occurrence: occurrence.id, line } }),
          }
        : undefined,
    };
  }

  // Sync mode cues the next Line at the playhead with Enter. Like the Cue
  // gutter, it's in Write mode on wider screens only, and only once there's
  // a Clip to cue along to. It and the Loop are exclusive, so going round
  // the Loop mid-pass can't cue Lines out of order: switching Sync mode on
  // switches the Loop off, and the Loop coming on, however it does,
  // switches Sync mode off.
  let syncing = $state(false);
  const canSync = $derived(mode === 'write' && wide.current && hasClips);
  $effect(() => {
    if (!canSync || loopOn) untrack(() => (syncing = false));
  });

  // What the Line up next is worked out from: the Line last cued, or a Line
  // picked by clicking it. It doesn't follow playback, so playback can start
  // anywhere, and the Line up next only moves on as Lines are cued, whether
  // or not their Cues are saved yet.
  let syncFrom = $state.raw<{ cued: NextLine | null; picked: NextLine | null }>({ cued: null, picked: null });
  // Marked by a Now button in its gutter slot.
  const upNext = $derived(syncing ? nextLine(song, syncFrom) : null);

  // Where playback is in the Lyric Sheet. In Sync mode, the Line up next is
  // being retaken, so its old Cue is ignored until it's cued again.
  const current = $derived(playhead === null ? null : currentPosition(song, playhead, upNext));
  // Write mode shows every Line, Chord Lines included, so whatever is
  // current is on screen.
  const writeKey = $derived(mode === 'write' && current ? key(current.occurrence, current.line) : null);

  // The first time Sync mode comes on on this device, a hint says how to use it.
  let hinting = $state(false);

  function switchSyncing() {
    syncing = !syncing;
    hinting = syncing && !sawSyncHint(deviceStorage());
    if (!syncing) return;
    stopLoop?.();
    markSyncHintSeen(deviceStorage());
    syncFrom = { cued: null, picked: null };
  }

  /** Cues the Line up next at the playhead. */
  async function cueNext() {
    const line = upNext;
    if (!playheadAt || !line) return;
    const time = playheadAt();
    const from = { cued: line, picked: null };
    syncFrom = from;
    const saved = await editCues((at) => api.setLineCue(at, line.occurrence, line.line, time));
    // Failed, the Line is still to cue, unless another has been picked since.
    if (!saved && syncFrom === from) syncFrom = { cued: null, picked: line };
  }

  // Playback is followed down the Lyric Sheet in Write mode, but in Sync
  // mode it's the Line up next that's kept in view instead: following both
  // would pull the page two ways at once.
  const followKey = $derived(syncing ? upNext && key(upNext.occurrence, upNext.line) : writeKey);
  $effect(() => {
    follow(followKey);
  });

  // In Sync mode, Enter cues anywhere but a text field or a dialog, even on
  // a button: syncing along shouldn't depend on where focus was left.
  function cueKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!syncing || event.defaultPrevented || inTextField(event.target)) return;
    // Enter in a dialog or a ⋯ menu is for what's in it.
    if (event.target instanceof Element && event.target.closest('dialog, [role="menu"]')) return;
    event.preventDefault();
    cueNext();
  }

  // The Occurrence just added, whose Label gets focus.
  let added = $state<number | null>(null);
  const songHasChords = $derived(hasChords(song));
  // Follows the server, except while a change to it is being sent.
  let showChords = $state(untrack(() => song.showChords));
  $effect(() => {
    showChords = song.showChords;
  });

  // Whether Chord Lines are on screen: always in Write mode, which shows the raw text.
  const chordsShown = $derived(mode === 'write' || (showChords && songHasChords));

  async function toggleChords() {
    const next = showChords;
    if (!(await change((at) => api.updateSong(at, { showChords: next })))) showChords = song.showChords;
  }

  async function add(position: number) {
    if (await change((at) => api.addSection(at, { position }))) {
      added = song.arrangement[position]?.id ?? null;
    }
  }

  function addOccurrence(sectionId: number, position?: number) {
    change((at) => api.addOccurrence(at, sectionId, position));
  }

  function addOccurrenceAtEnd(e: Event & { currentTarget: HTMLSelectElement }) {
    const id = Number(e.currentTarget.value);
    e.currentTarget.value = '';
    if (id) addOccurrence(id);
  }

  function move(index: number, by: -1 | 1) {
    const order = moveTo(
      song.arrangement.map((o) => o.id),
      index,
      index + by,
    );
    change((at) => api.reorderArrangement(at, order));
  }

  // On desktop, a Section is also dragged by the grip on its header: within
  // the Arrangement, or out of it to the Scrapbook. A drop within it saves
  // the same order as pressing ↑ or ↓ that many times, so Cues go with their
  // Occurrences.
  const dragged = $derived(
    drag.current && 'occurrence' in drag.current.dragged ? drag.current.dragged.occurrence : null,
  );
  // The gap the dragged Section would land in, if it moves at all.
  const dropAt = $derived(drag.drop && 'gap' in drag.drop ? drag.drop.gap : null);

  function dropOccurrence(drop: Drop) {
    if ('reorder' in drop) {
      const { from, to } = drop.reorder;
      const order = moveTo(
        song.arrangement.map((o) => o.id),
        from,
        to,
      );
      change((at) => api.reorderArrangement(at, order));
    } else if ('toScrapbook' in drop) {
      toScrapbook(drop.toScrapbook);
    }
  }

  // Dropped on the Scrapbook, an Occurrence's Section goes to its end, a
  // Detached copy if it's shared, or isn't kept if nothing is written in it,
  // which a notice says.
  async function toScrapbook(index: number) {
    const occurrence = song.arrangement[index];
    const section = occurrence && sections.get(occurrence.sectionId);
    if (!section) return;
    const empty = isEmpty(section);
    const name = describe(section);
    if ((await change((at) => api.moveOccurrenceToScrapbook(at, occurrence.id))) && empty) {
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
    <h2 id="sheet-heading">Lyric Sheet</h2>
    <span class="spacer"></span>
    {#if mode === 'write' && canCue && hasCues(song)}
      <!-- Doesn't ask first: it can be undone. -->
      <button
        type="button"
        class="button"
        onclick={() => editCues((at) => api.clearCues(at))}
        title="Clear every Cue in the Song">Clear all Cues</button
      >
    {/if}
    {#if mode === 'write' && wide.current}
      <!-- Clicked, it keeps focus where it was, so Space then plays rather than switching it back off. -->
      <button
        type="button"
        class="button sync-toggle"
        aria-pressed={syncing}
        disabled={!canSync}
        onpointerdown={(e) => e.preventDefault()}
        onclick={switchSyncing}
        title={canSync
          ? 'Sync lyrics: press Enter or Now as each Line starts to cue it at the playhead'
          : 'Add a beat to the Timeline to sync lyrics to it'}>Sync lyrics</button
      >
    {/if}
    {#if mode === 'write' && canCue && hasCues(song)}
      <div class="shift" role="group" aria-labelledby="shift-label">
        <span id="shift-label">Shift Cues</span>
        <select
          class="shift-step"
          aria-label="Step"
          title="How far each click shifts every Cue"
          value={shiftStep}
          onchange={(e) => chooseShiftStep(Number(e.currentTarget.value) as ShiftStep)}
        >
          {#each shiftSteps as step (step)}
            <option value={step}>{step} s</option>
          {/each}
        </select>
        <button
          type="button"
          class="button shift-by"
          disabled={!canShiftEarlier}
          onclick={() => shiftEveryCue(-shiftStep)}
          aria-label="Shift every Cue {shiftStep} s earlier"
          title={canShiftEarlier
            ? `Shift every Cue ${shiftStep} s earlier`
            : `A Cue is closer to 0:00 than ${shiftStep} s`}>−</button
        >
        <button
          type="button"
          class="button shift-by"
          onclick={() => shiftEveryCue(shiftStep)}
          aria-label="Shift every Cue {shiftStep} s later"
          title="Shift every Cue {shiftStep} s later">+</button
        >
      </div>
    {/if}
    <p class="notice muted" role="status">{notice ?? ''}</p>
    {#if syncing && hinting}
      <p class="sync-hint muted">Play, then press Enter or Now as each Line starts. Click a Line to start from it.</p>
    {/if}
  </div>

  {#if song.arrangement.length === 0}
    <p class="muted">
      No Sections here yet.{#if mode === 'write'}
        Add one to start writing{song.scrapbook.length > 0 ? ', or put one back from the Scrapbook' : ''}.{/if}
    </p>
  {/if}

  {#if mode === 'read'}
    {#if songHasChords}
      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" bind:checked={showChords} onchange={toggleChords} />
          Show chords
        </label>
      </div>
    {/if}
    <LyricSheetView {song} showChords={chordsShown} {current} play={leadInto} />
  {:else}
    <ol class="arrangement" class:drop-into={dropAt === 0 && song.arrangement.length === 0}>
      {#each song.arrangement as occurrence, i (occurrence.id)}
        {@const section = sections.get(occurrence.sectionId)}
        {#if section}
          <li
            class:dragged={dragged === i}
            class:drop-above={dropAt === i}
            class:drop-below={dropAt === song.arrangement.length && i === song.arrangement.length - 1}
            {@attach (el) => drag.placeOccurrence(el, i)}
          >
            <SectionEditor
              uid="o{occurrence.id}"
              {section}
              shared={occurrence.shared}
              autofocus={added === occurrence.id}
              {change}
              {onUnsaved}
              cueing={cueingFor(occurrence, section.label)}
              more={occurrenceActions(occurrence, section, i)}
            >
              {#snippet grip()}
                {#if drag.on}
                  <!-- Pointer only: ↑ and ↓ move it from the keyboard, and × to the Scrapbook. -->
                  <span
                    class="grip"
                    aria-hidden="true"
                    title="Drag to move, or onto the Scrapbook; Esc cancels"
                    {...drag.grip({ occurrence: i }, dropOccurrence)}>⠿</span
                  >
                {/if}
              {/snippet}
              {#snippet actions()}
                <button type="button" class="icon" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  class="icon"
                  onclick={() => move(i, 1)}
                  disabled={i === song.arrangement.length - 1}
                  aria-label="Move down"
                >
                  ↓
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
        <label class="visually-hidden" for="repeat-section">Repeat a Section at the end</label>
        <select id="repeat-section" class="repeat" onchange={addOccurrenceAtEnd}>
          <option value="">Repeat a Section…</option>
          {#each inArrangement as section (section.id)}
            <option value={section.id}>{describe(section)}</option>
          {/each}
        </select>
      {/if}
    </div>
    <p class="hint muted">Put Chords in brackets where they fall: <code>Hel[Am]lo</code>.</p>
  {/if}

  <datalist id="label-suggestions">
    {#each suggestedLabels as l (l)}<option value={l}></option>{/each}
  </datalist>
</section>

<style>
  .sheet {
    margin-bottom: 2rem;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .spacer {
    flex: 1;
  }
  .shift {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.5rem;
  }
  .shift-step {
    width: auto;
    margin-left: 0.25rem;
  }
  .shift-by {
    min-width: var(--control);
    padding: 0;
  }
  .sync-toggle[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }
  .notice:empty {
    display: none;
  }
  .sync-hint,
  .notice {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.8125rem;
  }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    column-gap: 1.25rem;
    margin-bottom: 0.5rem;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    cursor: pointer;
  }
  .toggle input {
    width: 1.25rem;
    height: 1.25rem;
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.8125rem;
  }
  .arrangement {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0 0 0.75rem;
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
    border-radius: 2px;
    background: var(--accent);
  }
  .arrangement > .drop-above::before {
    top: calc(-0.375rem - 1.5px);
  }
  .arrangement > .drop-below::after {
    bottom: calc(-0.375rem - 1.5px);
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
    gap: 0.5rem;
  }
  .add,
  .repeat {
    flex: 1 1 12rem;
    width: auto;
  }
  .repeat {
    font-weight: 600;
  }
</style>
