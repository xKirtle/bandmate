<script lang="ts">
  // A Line as Read mode draws it: its Chords above its words, which wrap as
  // wholes, each carrying its Chords; or its lyrics alone, while it has no
  // Chords or they're hidden. At Read mode's sizes, or at body text's in a
  // tool, such as the Snapshots dialog.
  import type { Attachment } from 'svelte/attachments';
  import type { Line } from './api';
  import { layoutLine, type ChordNames, type ShownChord } from './chords';

  let {
    line,
    showChords = true,
    transpose = 0,
    songKey = '',
    chordNames = 'as-shown',
    chord,
    sizes = 'read',
  }: {
    line: Line;
    showChords?: boolean;
    /** How far to transpose the Chords shown, in semitones, spelled from the Song's key. */
    transpose?: number;
    songKey?: string;
    /** How the Chords are named: as Read mode shows them, or as typed between their brackets. */
    chordNames?: ChordNames;
    /** Given, attached to each Chord's name, e.g. to open its diagram. */
    chord?: (chord: ShownChord) => Attachment<HTMLElement>;
    /** Read mode's lyric sizes, or body text's. */
    sizes?: 'read' | 'body';
  } = $props();

  const none: Attachment<HTMLElement> = () => {};
</script>

{#if showChords && line.chords.length > 0}
  <div class="line" class:body={sizes === 'body'} class:chord-line={line.chordLine}>
    {#each layoutLine(line, transpose, songKey, chordNames) as word, w (w)}
      <span class="word">
        {#each word as piece, p (p)}
          <span class="piece" class:snug={piece.snug}>
            <span class="chord"
              >{#each piece.chords as shown, c (c)}{#if c > 0}{' '}{/if}<span {@attach chord ? chord(shown) : none}
                  >{shown.written ?? shown.name}</span
                >{/each}</span
            >
            <span class="lyric">{piece.text || ' '}</span>
          </span>
        {/each}
      </span>
    {/each}
  </div>
{:else}
  <p class="line plain" class:body={sizes === 'body'}>{line.lyrics || ' '}</p>
{/if}

<style>
  .line {
    margin: 0;
    font-size: var(--lyric-read-line);
    line-height: var(--lyric-read-leading);
  }
  .line.body {
    font-size: var(--text-lg);
    line-height: var(--leading-content);
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
  .body .chord {
    font-size: var(--text-md);
  }
  .chord:not(:empty) {
    padding-right: var(--space-2);
  }
  /* Chords between words sit over the whitespace as typed, widening it only
     as far as their names need. */
  .snug > .chord {
    padding-right: 0;
  }
  .chord-line .lyric {
    display: none;
  }
</style>
