<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Cueing } from './AlternateText.svelte';
  import { api, suggestedLabels, type Line, type Occurrence, type Song, type SongAt } from './api';
  import { hasChords } from './chords';
  import { currentPosition, hasCues, isBlank, nextLine, type TapLine } from './cues';
  import { follower, key } from './follow';
  import { gutterFields } from './gutter';
  import LyricSheetView from './LyricSheetView.svelte';
  import SectionEditor from './SectionEditor.svelte';
  import { describe } from './sections';

  let {
    song,
    change,
    editCues,
    onUnsaved,
    playhead = null,
    hasClips = false,
    seek,
    tapping = false,
  }: {
    song: Song;
    /** Sends a Lyric Sheet change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Sends a Cue edit, to undo with the Timeline's edits; resolves to whether it succeeded. */
    editCues: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    onUnsaved: (editor: object, unsaved: boolean) => void;
    /** Where the Timeline is playing, in seconds; null while it isn't. */
    playhead?: number | null;
    /** Whether the Timeline has any Clip, so there's something to cue to. */
    hasClips?: boolean;
    /** Seeks the Timeline, e.g. to a cued Line. */
    seek?: (to: number) => void;
    /** Whether Tap mode is on, so tap can be called, and clicking a Line in Read mode picks it to tap next. */
    tapping?: boolean;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  // The Sections in the Arrangement, once each, in the order they first
  // appear: the ones another Occurrence can be added of.
  const inArrangement = $derived(
    [...new Set(song.arrangement.map((o) => o.sectionId))].flatMap((id) => sections.get(id) ?? []),
  );
  // Write edits the raw text; Read shows Chords above the lyrics.
  let mode = $state<'write' | 'read'>('write');
  // Where playback is in the Lyric Sheet.
  const current = $derived(playhead === null ? null : currentPosition(song, playhead));
  // Cues are edited on wider screens only, and only once there's something
  // to cue to or a Cue already set.
  const wide = new MediaQuery('min-width: 40.0625rem');
  const canCue = $derived(wide.current && (hasClips || hasCues(song)));

  function setCue(occurrence: Occurrence, cue: number | null) {
    editCues((at) =>
      cue === null ? api.clearOccurrenceCue(at, occurrence.id) : api.setOccurrenceCue(at, occurrence.id, cue),
    );
  }

  function setLineCue(occurrence: Occurrence, line: Line, cue: number | null) {
    editCues((at) =>
      cue === null ? api.clearLineCue(at, occurrence.id, line.id) : api.setLineCue(at, occurrence.id, line.id, cue),
    );
  }

  // In Write mode, each Occurrence's Lines and whole Section are tracked, to
  // follow playback to, and each Line's Cue field, to go on to with Enter.
  // Read mode does the same in LyricSheetView.
  const { track, follow } = follower();
  const writeFields = gutterFields();
  // The Line Cue fields in order down the page.
  const writeFieldOrder = $derived(
    song.arrangement.flatMap((o) =>
      (sections.get(o.sectionId)?.alternates.find((a) => a.active)?.lines ?? [])
        .filter((l) => !isBlank(l))
        .map((l) => key(o.id, l.id)),
    ),
  );
  // Write mode shows every Line, Chord Lines included, so whatever is
  // current is on screen.
  const writeKey = $derived(mode === 'write' && current ? key(current.occurrence, current.line) : null);
  $effect(() => {
    follow(writeKey);
  });

  /** How an Occurrence's Cues show on its Section's text box in Write mode. */
  function cueingFor(occurrence: Occurrence, label: string): Cueing {
    return {
      cues: occurrence.lineCues,
      current: current?.occurrence === occurrence.id ? current.line : null,
      track: (el, line) => track(el, key(occurrence.id, line)),
      gutter: canCue
        ? {
            labelSuffix: label ? ` of ${label}` : '',
            save: (line, cue) => setLineCue(occurrence, line, cue),
            field: (line, field) => writeFields.set(key(occurrence.id, line), field),
            next: (line) => writeFields.editAfter(writeFieldOrder, key(occurrence.id, line)),
          }
        : undefined,
    };
  }

  // The Line picked by clicking it in Tap mode, to tap next.
  let picked = $state<TapLine | null>(null);
  // A Line is picked in Read mode only, where it's marked.
  $effect(() => {
    if (!tapping || mode === 'write') picked = null;
  });
  // The latest tap, while the Cue it set is being saved: the Song doesn't
  // have that Cue yet, so the next tap goes on from it rather than from
  // what's current.
  let pendingTap: TapLine | null = null;

  /** Cues the next Line in Tap mode at a time, in seconds. */
  export async function tap(time: number) {
    const current = pendingTap ?? currentPosition(song, time);
    const line = nextLine(song, { current, picked, showChords: chordsShown });
    if (!line) return;
    picked = null;
    pendingTap = line;
    await editCues((at) => api.setLineCue(at, line.occurrence, line.line, time));
    // Saved, the Song has the Cue; failed, the Line is still to tap.
    if (pendingTap === line) pendingTap = null;
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
    const order = song.arrangement.map((o) => o.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    change((at) => api.reorderArrangement(at, order));
  }
</script>

<section class="sheet" aria-labelledby="sheet-heading">
  <div class="head">
    <h2 id="sheet-heading">Lyric Sheet</h2>
    <fieldset class="modes">
      <legend class="visually-hidden">Mode</legend>
      <label class="mode"><input type="radio" name="sheet-mode" value="write" bind:group={mode} />Write</label>
      <label class="mode"><input type="radio" name="sheet-mode" value="read" bind:group={mode} />Read</label>
    </fieldset>
  </div>

  {#if song.arrangement.length === 0}
    <p class="muted">
      No Sections here yet. Add one to start writing{song.scrapbook.length > 0 ? ', or put one back from the Scrapbook' : ''}.
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
    <LyricSheetView
      {song}
      showChords={chordsShown}
      {current}
      setCue={canCue ? setCue : undefined}
      setLineCue={canCue ? setLineCue : undefined}
      {seek}
      {picked}
      pick={tapping ? (line) => (picked = line) : undefined}
    />
  {:else}
    <ol class="arrangement">
      {#each song.arrangement as occurrence, i (occurrence.id)}
        {@const section = sections.get(occurrence.sectionId)}
        {#if section}
          <li
            class:current={writeKey === key(occurrence.id)}
            aria-current={writeKey === key(occurrence.id) ? 'true' : undefined}
            {@attach (el) => track(el, key(occurrence.id))}
          >
            <SectionEditor
              uid="o{occurrence.id}"
              {section}
              shared={occurrence.shared}
              autofocus={added === occurrence.id}
              {change}
              {onUnsaved}
              cue={canCue ? { at: occurrence.cue, save: (cue) => setCue(occurrence, cue) } : undefined}
              cueing={cueingFor(occurrence, section.label)}
            >
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
                <button type="button" class="icon" onclick={() => add(i + 1)} aria-label="Add a Section below">
                  +
                </button>
                <button
                  type="button"
                  class="icon"
                  onclick={() => addOccurrence(section.id, i + 1)}
                  aria-label="Repeat this Section below"
                  title="Repeat this Section below"
                >
                  ⧉
                </button>
                {#if canCue && hasCues({ arrangement: [occurrence], sections: song.sections })}
                  <!-- Doesn't ask first: it can be undone. It clears dormant Cues too. -->
                  <button
                    type="button"
                    class="icon"
                    onclick={() => editCues((at) => api.clearOccurrenceCues(at, occurrence.id))}
                    aria-label="Clear this Occurrence's Cues"
                    title="Clear this Occurrence's Cues"
                  >
                    ⌀
                  </button>
                {/if}
                {#if occurrence.shared}
                  <button
                    type="button"
                    class="icon"
                    onclick={() => change((at) => api.detach(at, occurrence.id))}
                    aria-label="Detach into its own copy"
                    title="Detach: give this Occurrence its own copy, so it can differ"
                  >
                    ⑂
                  </button>
                {/if}
                <button
                  type="button"
                  class="icon"
                  onclick={() => change((at) => api.removeOccurrence(at, occurrence.id))}
                  aria-label={occurrence.shared ? 'Remove this Occurrence' : 'Move to the Scrapbook'}
                  title={occurrence.shared
                    ? 'Remove this Occurrence; the others stay'
                    : 'Move to the Scrapbook: take it out of the Lyric Sheet but keep it'}
                >
                  ×
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
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .modes {
    display: flex;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .mode {
    display: flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 0.875rem;
    background: var(--surface-1);
    font-weight: 600;
    cursor: pointer;
  }
  .mode + .mode {
    border-left: 1px solid var(--border);
  }
  .mode input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    min-height: 0;
  }
  .mode:has(input:checked) {
    background: var(--surface-2);
  }
  .mode:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
    min-height: 2.75rem;
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
  /* Playback is on the Section as a whole, before its Lines are cued. */
  .arrangement > .current {
    border-radius: 0.75rem;
    box-shadow: 0 0 0 2px var(--accent);
    scroll-margin-top: 5rem;
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
