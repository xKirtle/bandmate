<script lang="ts">
  import type { Occurrence, Song } from './api';
  import { layoutLine } from './chords';
  import CueField from './CueField.svelte';
  import { inTextField } from './textField';

  let {
    song,
    showChords,
    currentOccurrence = null,
    setCue,
  }: {
    song: Song;
    showChords: boolean;
    /** The Occurrence playback is in, highlighted and kept in view. */
    currentOccurrence?: number | null;
    /** Given, each Section's header row shows its Occurrence's Cue, to change it with. */
    setCue?: (occurrence: Occurrence, cue: number | null) => void;
  } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
  const shown = new Map<number, HTMLElement>();

  // Follow playback, unless that would pull the page away from something
  // being typed.
  $effect(() => {
    if (currentOccurrence === null) return;
    if (inTextField(document.activeElement)) return;
    shown.get(currentOccurrence)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  /** Keeps track of each Occurrence's element, to scroll to. */
  function track(el: HTMLElement, id: number) {
    shown.set(id, el);
    return () => shown.delete(id);
  }
</script>

<div class="view">
  {#each song.arrangement as occurrence (occurrence.id)}
    {@const section = sections.get(occurrence.sectionId)}
    {#if section}
      {@const all = section.alternates.find((a) => a.active)!.lines}
      {@const lines = all.filter((l) => showChords || !l.chordLine)}
      <section
        class="section"
        class:current={occurrence.id === currentOccurrence}
        aria-label={section.label || 'Section without a Label'}
        aria-current={occurrence.id === currentOccurrence ? 'true' : undefined}
        {@attach (el) => track(el, occurrence.id)}
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
        {#each lines as line (line.id)}
          {#if showChords && line.chords.length > 0}
            <div class="line" class:chord-line={line.chordLine}>
              {#each layoutLine(line) as word, w (w)}
                <span class="word">
                  {#each word as piece, p (p)}
                    <span class="piece">
                      <span class="chord">{piece.chord}</span>
                      <span class="lyric">{piece.text || ' '}</span>
                    </span>
                  {/each}
                </span>
              {/each}
            </div>
          {:else}
            <p class="line plain">{line.lyrics || ' '}</p>
          {/if}
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
