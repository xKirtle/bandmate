<script lang="ts">
  // A piano Voicing drawn on a keyboard from C3 to C5, the same two octaves
  // on every diagram so they compare at a glance: each key pressed filled
  // with the accent and marked with a dot, so it's told by its mark and not
  // by colour alone (no accent reaches 3:1 against both key colours in every
  // Palette), and each C named, middle C among them. A white key is 1 wide to 4.5
  // tall whatever the room, so the height follows the width, which grows
  // with the room up to the widest key; where the room is narrower than the
  // keyboard at its narrowest key (a phone under about 340px), it shrinks to
  // fit. Unlike a Chord diagram, it's never mirrored for a left-handed
  // player: a piano's low notes are on the left either way. The Chord Finder
  // draws with it.
  import type { PianoVoicing } from './chordFinder';
  import { highestKey, isBlackKey, lowestKey } from './piano';

  let { voicing, name }: { voicing: PianoVoicing; name: string } = $props();

  const keys = Array.from({ length: highestKey - lowestKey + 1 }, (_, i) => lowestKey + i);
  const whites = keys.filter((k) => !isBlackKey(k));
  const blacks = keys.filter(isBlackKey);
  /** A black key's centre, on the line between the white keys either side, as a share of the keyboard's width. */
  const blackAt = (key: number) => ((whites.indexOf(key - 1) + 1) / whites.length) * 100;
  /** A C's name, with its octave: C4 is middle C. */
  const cName = (key: number) => 'C' + (Math.floor(key / 12) - 1);

  const pressed = $derived(new Set(voicing.keys));
  /** Read out low to high, e.g. "B7 on the piano: B3 D#4 F#4 A4". */
  const label = $derived(`${name} on the piano: ${voicing.notes.join(' ')}`);
</script>

<div class="piano" role="img" aria-label={label}>
  {#each whites as key (key)}
    <span class="white" class:pressed={pressed.has(key)}>
      {#if pressed.has(key)}<span class="dot"></span>{/if}
      {#if key % 12 === 0}<span class="c">{cName(key)}</span>{/if}
    </span>
  {/each}
  {#each blacks as key (key)}
    <span class="black" class:pressed={pressed.has(key)} style:left="{blackAt(key)}%">
      {#if pressed.has(key)}<span class="dot"></span>{/if}
    </span>
  {/each}
</div>

<style>
  /* Its white keys, each 1 wide to 4.5 tall. */
  .piano {
    position: relative;
    display: flex;
    width: min(100%, calc(var(--piano-white-keys) * var(--piano-key-widest)));
    aspect-ratio: calc(var(--piano-white-keys) / 4.5);
    margin-inline: auto;
  }
  .white,
  .black {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    padding-bottom: var(--space-1);
    border: 1px solid var(--piano-black);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  }
  .white {
    flex: 1;
    min-width: 0;
    margin-left: -1px;
    background: var(--piano-white);
  }
  .white:first-child {
    margin-left: 0;
  }
  /* A black key sits over the line between two white keys, 0.6 as wide as one and 0.6 as tall. */
  .black {
    position: absolute;
    top: 0;
    width: calc(100% / var(--piano-white-keys) * 0.6);
    height: 60%;
    background: var(--piano-black);
    transform: translateX(-50%);
  }
  .pressed {
    background: var(--accent);
  }
  /* A pressed key's mark: a dot half as wide as the key, in the text drawn on the accent. */
  .dot {
    flex-shrink: 0;
    width: 50%;
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    background: var(--accent-text);
  }
  .c {
    color: var(--piano-black);
    font-size: var(--text-xs);
    line-height: 1;
  }
  .pressed .c {
    color: var(--accent-text);
  }
</style>
