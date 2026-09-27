<script lang="ts">
  import type { Line, Occurrence, Song } from './api';
  import { layoutLine } from './chords';
  import CueField from './CueField.svelte';
  import { isBlank, type Position } from './cues';
  import { follower } from './follow';

  let {
    song,
    showChords,
    current = null,
    setCue,
    setLineCue,
    seek,
  }: {
    song: Song;
    showChords: boolean;
    /** Where playback is: highlighted and kept in view. */
    current?: Position | null;
    /** Given, each Section's header row shows its Occurrence's Cue, to change it with. */
    setCue?: (occurrence: Occurrence, cue: number | null) => void;
    /** Given, a gutter beside each Line shows its Cue in that Occurrence, to change it with. */
    setLineCue?: (occurrence: Occurrence, line: Line, cue: number | null) => void;
    /** Given, clicking a cued Line seeks the Timeline to its Cue. */
    seek?: (to: number) => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const { track, follow } = follower();

  // The Lines shown for an Occurrence: its active Alternate's, less Chord
  // Lines while Chords are hidden.
  function linesOf(occurrence: Occurrence) {
    const all = sections.get(occurrence.sectionId)?.alternates.find((a) => a.active)?.lines ?? [];
    return { all, lines: all.filter((l) => showChords || !l.chordLine) };
  }

  // The gutter's fields in order down the page, so Enter can go on to the next.
  const gutter = $derived(
    song.arrangement.flatMap((o) =>
      linesOf(o)
        .lines.filter((l) => !isBlank(l))
        .map((l) => key(o.id, l.id)),
    ),
  );
  const fields: Record<string, { edit: () => void } | null> = {};

  function editAfter(k: string): boolean {
    const next = fields[gutter[gutter.indexOf(k) + 1]];
    next?.edit();
    return !!next;
  }

  /** The current Line if it's shown, or null for its whole Section, e.g. a Chord Line while Chords are hidden. */
  function shownLine(position: Position): number | null {
    if (position.line === null || showChords) return position.line;
    const o = song.arrangement.find((o) => o.id === position.occurrence);
    return o && linesOf(o).lines.some((l) => l.id === position.line) ? position.line : null;
  }

  function key(occurrence: number, line: number | null = null): string {
    return line === null ? `${occurrence}` : `${occurrence}:${line}`;
  }

  // Follow playback, unless that would pull the page away from something
  // being typed. Keyed, so it only scrolls once playback moves on, not on
  // every frame.
  const currentKey = $derived(current && key(current.occurrence, shownLine(current)));
  $effect(() => {
    if (currentKey !== null) follow(currentKey, currentKey.includes(':') ? 'center' : 'start');
  });

  /** Seeks to a cued Line's Cue, unless the click was to select its text. */
  function seekTo(cue: number) {
    if (!window.getSelection()?.isCollapsed) return;
    seek?.(cue);
  }
</script>

<div class="view">
  {#each song.arrangement as occurrence (occurrence.id)}
    {@const section = sections.get(occurrence.sectionId)}
    {#if section}
      {@const { all, lines } = linesOf(occurrence)}
      {@const isCurrent = currentKey === key(occurrence.id)}
      <section
        class="section"
        class:current={isCurrent}
        aria-label={section.label || 'Section without a Label'}
        aria-current={isCurrent ? 'true' : undefined}
        {@attach (el) => track(el, key(occurrence.id))}
      >
        {#if section.label || setCue}
          <div class="header">
            {#if section.label}<h3>{section.label}</h3>{/if}
            {#if setCue}
              <CueField
                cue={occurrence.cue}
                label={section.label || 'this Section'}
                save={(cue) => setCue(occurrence, cue)}
              />
            {/if}
          </div>
        {/if}
        {#if all.length === 0}
          <p class="muted">No Lines yet.</p>
        {:else if lines.length === 0}
          <p class="muted">Only Chords, which are hidden.</p>
        {/if}
        {#each lines as line, n (line.id)}
          {@const cue = occurrence.lineCues[line.id] ?? null}
          {@const k = key(occurrence.id, line.id)}
          {@const lineCurrent = currentKey === k}
          <div
            class="line-box"
            class:current={lineCurrent}
            class:with-gutter={setLineCue}
            aria-current={lineCurrent ? 'true' : undefined}
            {@attach (el) => track(el, k)}
          >
            <!-- Seeking is also on the Timeline's ruler, so a click here is a shortcut. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="text"
              class:seeks={cue !== null && seek}
              title={cue !== null && seek ? 'Play from here' : undefined}
              onclick={cue !== null && seek ? () => seekTo(cue) : undefined}
            >
              {#if showChords && line.chords.length > 0}
                <div class="line" class:chord-line={line.chordLine}>
                  {#each layoutLine(line) as word, w (w)}
                    <span class="word">
                      {#each word as piece, p (p)}
                        <span class="piece">
                          <span class="chord">{piece.chord}</span>
                          <span class="lyric">{piece.text || ' '}</span>
                        </span>
                      {/each}
                    </span>
                  {/each}
                </div>
              {:else}
                <p class="line plain">{line.lyrics || ' '}</p>
              {/if}
            </div>
            {#if setLineCue && !isBlank(line)}
              <CueField
                bind:this={fields[k]}
                gutter
                {cue}
                label="Line {n + 1}{section.label ? ` of ${section.label}` : ''}"
                save={(cue) => setLineCue(occurrence, line, cue)}
                next={() => editAfter(k)}
              />
            {/if}
          </div>
        {/each}
      </section>
    {/if}
  {/each}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-bottom: 0.75rem;
  }
  /* Highlighted by a tint that bleeds a little past the text, so the text
     itself stays where it is. */
  .section {
    margin: -0.5rem -0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    scroll-margin-top: 5rem;
    transition: background-color 0.2s;
  }
  .section.current {
    background: var(--surface-1);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    margin: 0 0 0.25rem;
  }
  h3 {
    margin: 0 auto 0 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .section p {
    margin: 0;
  }
  /* A Line with its Cue beside it. The highlight bleeds past the text like
     the Section's, taking in its Chords. */
  .line-box {
    margin: 0 -0.75rem;
    padding: 0 0.75rem;
    border-radius: 0.375rem;
    scroll-margin: 5rem 0;
    transition: background-color 0.2s;
  }
  .line-box.with-gutter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 0.5rem;
  }
  .line-box.current {
    background: var(--surface-1);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .seeks {
    cursor: pointer;
  }
  .line {
    font-size: 1.0625rem;
    line-height: 1.4;
  }
  .plain {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Words wrap as wholes, each carrying its Chords above it. */
  .line:not(.plain) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-top: 0.25rem;
  }
  /* A word wider than the screen wraps inside rather than overflowing. */
  .word {
    display: inline-flex;
    flex-wrap: wrap;
    max-width: 100%;
    white-space: break-spaces;
    overflow-wrap: anywhere;
  }
  .piece {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
  }
  .chord {
    min-height: 1.4em;
    color: var(--accent);
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .chord:not(:empty) {
    padding-right: 0.375em;
  }
  .chord-line .lyric {
    display: none;
  }
</style>
