<script lang="ts" module>
  /** Opens a Chord's popover, from a Chord in a Line or a diagram in the Chord Chart. */
  export interface ChordOpener {
    /** A pointer came over a Chord: opens it until the pointer leaves it and the popover, unless a press has one open. */
    hover(name: string, anchor: HTMLElement, line?: HTMLElement | null): void;
    /** The pointer left the Chord it hovered. */
    leave(): void;
    /** A tap or click on a Chord: opens it until a tap or click elsewhere, or closes it if it's open. */
    press(name: string, anchor: HTMLElement, line?: HTMLElement | null): void;
  }
</script>

<script lang="ts">
  // A Chord's diagram, in a popover over the Lyric Sheet in Read mode: the
  // Voicing the Chord Chart draws for it, for the Chord as shown and the
  // Song's tuning. A Chord or tuning that can't be read says so instead.
  // Opened by hovering a Chord in a Line with a pointer, tapping it on a touch
  // screen, or clicking a diagram in the Chart. It opens over the Line, on
  // the Lines already played, or under it when there's no room above, so the
  // Line being read and those after it stay in view. From the Chart, it opens
  // under the diagram.
  import { tick } from 'svelte';
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import { chartTuning, chartVoicing } from './chordChart';
  import { popoverLeft, popoverTop } from './popover';
  import { preferredVoicings } from './sharedPreferredVoicings.svelte';

  let { song }: { song: Song } = $props();

  type Opened = {
    name: string;
    anchor: HTMLElement;
    /** The Line the Chord is in, kept clear; none for the Chart's diagrams. */
    line: HTMLElement | null;
    /** Hovered, it closes as the pointer leaves; pressed, on a press elsewhere. */
    by: 'hover' | 'press';
  };
  let opened = $state<Opened | null>(null);
  let box = $state<HTMLElement>();
  // Between the Line or diagram and the popover, in px.
  const gap = 6;
  // How long the pointer has to move from a Chord into its popover.
  const leaveDelay = 150;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(leaveTimer));

  const tuning = $derived(chartTuning(song.tuning));
  const drawn = $derived(
    opened && chartVoicing(opened.name, tuning, tuning ? preferredVoicings.of(tuning) : undefined),
  );

  async function open(name: string, anchor: HTMLElement, line: HTMLElement | null, by: Opened['by']) {
    clearTimeout(leaveTimer);
    opened = { name, anchor, line, by };
    await tick();
    if (box && !box.matches(':popover-open')) box.showPopover();
    place();
  }

  function close() {
    clearTimeout(leaveTimer);
    opened = null;
  }

  function leaveSoon() {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(close, leaveDelay);
  }

  export const opener: ChordOpener = {
    hover(name, anchor, line = null) {
      // One opened by a press stays open until a press elsewhere closes it.
      if (opened?.by === 'press') return;
      open(name, anchor, line, 'hover');
    },
    leave() {
      if (opened?.by === 'hover') leaveSoon();
    },
    press(name, anchor, line = null) {
      if (opened?.by === 'press' && opened.anchor === anchor) close();
      else open(name, anchor, line, 'press');
    },
  };

  /** Over the Line (under the Chart's diagram), centred on the Chord, inside the window. */
  function place() {
    if (!opened || !box) return;
    if (!opened.anchor.isConnected) return close();
    const chord = opened.anchor.getBoundingClientRect();
    const clear = (opened.line ?? opened.anchor).getBoundingClientRect();
    const { width, height } = box.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const centred = chord.left + chord.width / 2 - width / 2;
    box.style.top = `${popoverTop(clear, height, viewportHeight, gap, opened.line ? 'over' : 'under')}px`;
    box.style.left = `${popoverLeft({ left: centred, right: centred + width }, width, document.documentElement.clientWidth, gap, 'start')}px`;
  }

  // A press anywhere but the popover or the Chord it's open for closes it;
  // on the Chord, its own press does.
  function pressElsewhere(e: PointerEvent) {
    if (!opened || !(e.target instanceof Node)) return;
    if (box?.contains(e.target) || opened.anchor.contains(e.target)) return;
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (opened && e.key === 'Escape') close();
  }
</script>

<!-- Placed again as the page scrolls or resizes, so it stays with its Chord. -->
<svelte:window onresize={place} onkeydown={onKey} />
<svelte:document onscrollcapture={place} onpointerdowncapture={pressElsewhere} />

{#if opened && drawn}
  <div
    class="chord-popover"
    role="dialog"
    tabindex="-1"
    aria-label="{opened.name} diagram"
    popover="manual"
    bind:this={box}
    onpointerenter={(e) => e.pointerType !== 'touch' && clearTimeout(leaveTimer)}
    onpointerleave={(e) => e.pointerType !== 'touch' && opener.leave()}
  >
    <span class="name">{opened.name}</span>
    {#if drawn.kind === 'voicing'}
      <div class="diagram">
        <ChordDiagram voicing={drawn.voicing} name={opened.name} />
      </div>
    {:else}
      <p class="muted note">
        {#if drawn.kind === 'unreadable-tuning'}
          The Song's tuning, “{song.tuning.trim()}”, can't be read, so there's no diagram.
        {:else if drawn.kind === 'unreadable-chord'}
          Bandmate can't read this Chord, so there's no diagram.
        {:else}
          Bandmate can't find a Voicing of this Chord in the Song's tuning.
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .chord-popover {
    position: fixed;
    inset: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    margin: 0;
    padding: 0.5rem 0.75rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--text) 18%, transparent);
  }
  .name {
    color: var(--accent);
    font-size: 1rem;
    font-weight: 700;
  }
  .diagram {
    width: 7.5rem;
  }
  .note {
    max-width: 14rem;
    margin: 0;
    font-size: 0.875rem;
    text-align: center;
  }
</style>
