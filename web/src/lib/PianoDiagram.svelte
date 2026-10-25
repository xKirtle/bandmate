<script lang="ts">
  // A keyboard from C3 to C5, the same two octaves on every drawing so they
  // compare at a glance: each key pressed filled with the accent and marked
  // with a dot, so it's told by its mark and not by colour alone (no accent
  // reaches 3:1 against both key colours in every Palette), and each C
  // named, middle C among them. A white key is 1 wide to 4.5 tall whatever
  // the room, so the height follows the width, which grows with the room up
  // to the widest key; where the room is narrower than the keyboard at its
  // narrowest key (a phone under about 340px), it shrinks to fit. Unlike a
  // Chord diagram, it's never mirrored for a left-handed player: a piano's
  // low notes are on the left either way. The Chord Finder draws a piano
  // Voicing with it, and Name it plays it: given ontoggle, tapping a key
  // presses it or lets it go, and the keyboard is one tab stop, ← and →
  // moving a semitone, Home and End to the ends.
  import { tick } from 'svelte';
  import { highestKey, isBlackKey, lowestKey, pianoKeyName, type PianoKeys } from './piano';

  let {
    pressed,
    label,
    ontoggle,
  }: {
    /** The keys pressed, as MIDI note numbers. */
    pressed: PianoKeys;
    /** What a drawing is read out as, e.g. "B7 on the piano: B3 D#4 F#4 A4"; a played keyboard reads out each key instead. */
    label: string;
    /** Makes it playable: a key tapped is pressed, or let go if it was pressed. */
    ontoggle?: (key: number) => void;
  } = $props();

  const keys = Array.from({ length: highestKey - lowestKey + 1 }, (_, i) => lowestKey + i);
  const whites = keys.filter((k) => !isBlackKey(k));
  const blacks = keys.filter(isBlackKey);
  /** A black key's centre, on the line between the white keys either side, as a share of the keyboard's width. */
  const blackAt = (key: number) => ((whites.indexOf(key - 1) + 1) / whites.length) * 100;

  const down = $derived(new Set(pressed));

  // Played, the one key in the tab order: where focus last was, middle C at first.
  let focused = $state(60);
  let keyboard: HTMLDivElement;

  async function move(e: KeyboardEvent, key: number) {
    const moves: Record<string, number> = {
      ArrowLeft: key - 1,
      ArrowRight: key + 1,
      Home: lowestKey,
      End: highestKey,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focused = Math.max(lowestKey, Math.min(highestKey, to));
    await tick();
    keyboard.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }
</script>

{#snippet face(key: number)}
  {#if down.has(key)}<span class="dot"></span>{/if}
  <!-- Every white key keeps a line for a C's name, so pressed keys' dots line up. -->
  {#if !isBlackKey(key)}<span class="c">{key % 12 === 0 ? pianoKeyName(key) : ''}</span>{/if}
{/snippet}

{#snippet keyOf(key: number)}
  {@const style = isBlackKey(key) ? `left: ${blackAt(key)}%` : undefined}
  {#if ontoggle}
    <button
      type="button"
      class={isBlackKey(key) ? 'black' : 'white'}
      class:pressed={down.has(key)}
      {style}
      tabindex={focused === key ? 0 : -1}
      aria-label={pianoKeyName(key)}
      aria-pressed={down.has(key)}
      onclick={() => ontoggle(key)}
      onkeydown={(e) => move(e, key)}
      onfocus={() => (focused = key)}
    >
      {@render face(key)}
    </button>
  {:else}
    <span class={isBlackKey(key) ? 'black' : 'white'} class:pressed={down.has(key)} {style}>
      {@render face(key)}
    </span>
  {/if}
{/snippet}

<div bind:this={keyboard} class="piano" role={ontoggle ? 'group' : 'img'} aria-label={ontoggle ? 'Piano' : label}>
  {#each whites as key (key)}{@render keyOf(key)}{/each}
  {#each blacks as key (key)}{@render keyOf(key)}{/each}
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
    padding: 0 0 var(--space-1);
    border: 1px solid var(--piano-black);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    font: inherit;
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
    min-height: 1lh;
  }
  .pressed .c {
    color: var(--accent-text);
  }
  button {
    cursor: pointer;
  }
  /* Inside the key, so the black keys over a white one don't hide it. */
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* On a pressed key, filled with the accent, in the text drawn on it. */
  button.pressed:focus-visible {
    outline-color: var(--accent-text);
  }
  /* Under a pointer, a key not pressed shows a faint dot where tapping it puts one, as a fret does. */
  @media (hover: hover) {
    button:not(.pressed):hover::before {
      content: '';
      flex-shrink: 0;
      width: 50%;
      aspect-ratio: 1;
      border-radius: var(--radius-full);
      background: var(--accent);
      opacity: 0.35;
    }
  }
</style>
