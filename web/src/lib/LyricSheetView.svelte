<script lang="ts">
  import type { Attachment } from 'svelte/attachments';
  import type { Section, Song } from './api';
  import type { ChordOpener } from './ChordPopover.svelte';
  import { layoutLine } from './chords';
  import type { Position } from './cues';
  import { follower, lineKey, sectionKey } from './follow';
  import { activeAlternate, labelOf } from './sections';

  let {
    song,
    showChords,
    transpose = 0,
    current = null,
    play,
    opener,
  }: {
    song: Song;
    showChords: boolean;
    /** How far to transpose the Chords shown, in semitones. */
    transpose?: number;
    /** Where playback is: highlighted and kept in view. */
    current?: Position | null;
    /** Given, clicking a cued Line plays from its Cue. */
    play?: (cue: number) => void;
    /** Given, hovering a Chord, or tapping it on a touch screen, opens its diagram. */
    opener?: ChordOpener;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const { track, follow } = follower();

  // The Lines shown for a Section: its active Alternate's, less Chord Lines
  // while Chords are hidden.
  function linesOf(section: Section | undefined) {
    const all = activeAlternate(section)?.lines ?? [];
    return { all, lines: all.filter((l) => showChords || !l.chordLine) };
  }

  /** The key of the current Line if it's shown, or else of its whole Section, e.g. a Chord Line while Chords are hidden. */
  function shownKey(position: Position): string {
    const shown = showChords || linesOf(sections.get(position.section)).lines.some((l) => l.id === position.line);
    return shown ? lineKey(position.line) : sectionKey(position.section);
  }

  // Follow playback, unless that would pull the page away from something
  // being typed. Keyed, so it only scrolls once playback moves on, not on
  // every frame.
  const currentKey = $derived(current && shownKey(current));
  $effect(() => {
    follow(currentKey);
  });

  /** What clicking a Line does: play from its Cue. Null for nothing. */
  function clickLine(cue: number | null): (() => void) | null {
    return cue !== null && play ? () => play(cue) : null;
  }

  /**
   * Opens a Chord's diagram as a pointer hovers it, or as it's tapped on a
   * touch screen, where the tap doesn't also play the Line. Clicked with a
   * mouse, it plays from the Line's Cue as the rest of the Line does.
   */
  function opens(name: string): Attachment<HTMLElement> {
    return (el) => {
      if (!opener || !name) return;
      const popover = opener;
      const line = () => el.closest<HTMLElement>('.line-box');
      let touch = false;
      const enter = (e: PointerEvent) => e.pointerType !== 'touch' && popover.hover(name, el, line());
      const leave = (e: PointerEvent) => e.pointerType !== 'touch' && popover.leave();
      const down = (e: PointerEvent) => (touch = e.pointerType === 'touch');
      const click = (e: MouseEvent) => {
        if (!touch) return;
        e.stopPropagation();
        popover.press(name, el, line());
      };
      el.addEventListener('pointerenter', enter);
      el.addEventListener('pointerleave', leave);
      el.addEventListener('pointerdown', down);
      el.addEventListener('click', click);
      return () => {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('click', click);
      };
    };
  }

  /** Does what clicking a Line does, unless the click was to select its text. */
  function click(action: () => void) {
    if (!window.getSelection()?.isCollapsed) return;
    action();
  }
</script>

<div class="view">
  {#each song.arrangement as sectionId (sectionId)}
    {@const section = sections.get(sectionId)}
    {#if section}
      {@const { all, lines } = linesOf(section)}
      {@const isCurrent = currentKey === sectionKey(section.id)}
      <section
        class="section"
        class:current={isCurrent}
        aria-label={labelOf(section)}
        aria-current={isCurrent ? 'true' : undefined}
        {@attach (el) => track(el, sectionKey(section.id))}
      >
        {#if section.label}
          <h3>{section.label}</h3>
        {/if}
        {#if all.length === 0}
          <p class="muted">No Lines yet.</p>
        {:else if lines.length === 0}
          <p class="muted">Only Chords, which are hidden.</p>
        {/if}
        {#each lines as line (line.id)}
          {@const cue = line.cue}
          {@const k = lineKey(line.id)}
          {@const lineCurrent = currentKey === k}
          {@const onClick = clickLine(cue)}
          <div
            class="line-box"
            class:current={lineCurrent}
            aria-current={lineCurrent ? 'true' : undefined}
            {@attach (el) => track(el, k)}
          >
            <!-- Like a Cue's ▶ in Write mode, so a click here is a shortcut. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="text"
              class:clickable={onClick}
              title={onClick ? 'Play from here' : undefined}
              onclick={onClick ? () => click(onClick) : undefined}
            >
              {#if showChords && line.chords.length > 0}
                <div class="line" class:chord-line={line.chordLine}>
                  {#each layoutLine(line, transpose, song.key) as word, w (w)}
                    <span class="word">
                      {#each word as piece, p (p)}
                        <span class="piece">
                          <span class="chord"
                            >{#each piece.chords as name, c (c)}{#if c > 0}{' '}{/if}<span {@attach opens(name)}
                                >{name}</span
                              >{/each}</span
                          >
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
          </div>
        {/each}
      </section>
    {/if}
  {/each}
</div>

<style>
  /* Sections well apart, so each reads as one block at a glance. */
  .view {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-bottom: var(--space-3);
  }
  /* Highlighted by a tint that bleeds a little past the text, so the text
     itself stays where it is. */
  .section {
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-3));
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    scroll-margin-top: 5rem;
    transition: background-color var(--duration-base) var(--ease);
  }
  .section.current {
    background: var(--surface-1);
    box-shadow: var(--selected-edge);
  }
  /* A Label is content, set as written: a heading over its Lines, at the
     Chords' size, muted so it steps back from them. */
  h3 {
    margin: 0 0 var(--space-1);
    font-size: var(--lyric-read-label);
    font-weight: 700;
    color: var(--text-muted);
    line-height: var(--lyric-read-leading);
  }
  .section p {
    margin: 0;
  }
  /* A Line, whose highlight bleeds past the text like the Section's, taking
     in its Chords. */
  .line-box {
    margin: 0 calc(-1 * var(--space-3));
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    scroll-margin: 5rem 0;
    transition: background-color var(--duration-base) var(--ease);
  }
  .line-box.current {
    background: var(--surface-1);
    box-shadow: var(--selected-edge);
  }
  .clickable {
    cursor: pointer;
  }
  .line {
    font-size: var(--lyric-read-line);
    line-height: var(--lyric-read-leading);
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
    margin-top: var(--space-1);
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
  /* A piece with no Chord holds a Chord's height, so the lyrics stay level. */
  .chord {
    min-height: 1lh;
    color: var(--accent);
    font-size: var(--lyric-read-chord);
    font-weight: 700;
  }
  .chord:not(:empty) {
    padding-right: var(--space-2);
  }
  .chord-line .lyric {
    display: none;
  }
</style>
