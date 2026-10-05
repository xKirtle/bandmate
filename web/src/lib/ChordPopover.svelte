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
  // Song's tuning, stepping forwards and backwards through its other Voicings. Prefer
  // makes the one showing the Chord's preferred Voicing in the tuning, and
  // Clear goes back to the top-ranked one: the device's preference the Chord
  // Finder keeps, so the Chart and the Chord Finder follow at once. That's
  // allowed in Read mode, as it's a device setting, not an edit to the Song.
  // A Chord or tuning that can't be read says so instead.
  // Opened by hovering a Chord in a Line with a pointer, tapping it on a touch
  // screen, or clicking a diagram in the Chart. It opens over the Line, on
  // the Lines already played, or under it when there's no room above, so the
  // Line being read and those after it stay in view. From the Chart, it opens
  // under the diagram.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { tick } from 'svelte';
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import { chartTuning, chartVoicings } from './chordChart';
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
  const found = $derived(
    opened && chartVoicings(opened.name, tuning, tuning ? preferredVoicings.of(tuning) : undefined),
  );
  const voicings = $derived(found?.kind === 'voicings' ? found.voicings : []);
  // Which of them shows: 0, the preferred or top-ranked one, when it opens.
  let at = $state(0);
  const showing = $derived(Math.min(at, voicings.length - 1));
  const voicing = $derived(voicings[showing]);
  const isPreferred = $derived(found?.kind === 'voicings' && found.preferred && showing === 0);

  // Round from the last Voicing to the first and back, so the buttons are
  // never disabled under the focus they hold.
  function step(by: number) {
    at = (showing + by + voicings.length) % voicings.length;
  }

  // Preferring the Voicing showing moves it first, so it stays showing;
  // clearing the preference shows the top-ranked one.
  function prefer() {
    if (found?.kind !== 'voicings' || !tuning || !voicing) return;
    preferredVoicings.set(tuning, found.chord, isPreferred ? null : voicing.frets);
    at = 0;
  }

  // Arrow keys step through the Voicings too, as the buttons do.
  function stepKey(e: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by || voicings.length === 0) return;
    e.preventDefault();
    step(by);
  }

  async function open(name: string, anchor: HTMLElement, line: HTMLElement | null, by: Opened['by']) {
    clearTimeout(leaveTimer);
    if (opened?.name !== name) at = 0;
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

{#if opened && found}
  <div
    class="chord-popover"
    role="dialog"
    tabindex="-1"
    aria-label="{opened.name} diagram"
    popover="manual"
    bind:this={box}
    onpointerenter={(e) => e.pointerType !== 'touch' && clearTimeout(leaveTimer)}
    onpointerleave={(e) => e.pointerType !== 'touch' && opener.leave()}
    onkeydown={stepKey}
  >
    <span class="name">{opened.name}</span>
    {#if voicing}
      <div class="diagram">
        <ChordDiagram {voicing} name={opened.name} />
      </div>
      <div class="stepper">
        <button
          type="button"
          class="button step"
          aria-label="Previous Voicing"
          title="Previous Voicing"
          onclick={() => step(-1)}><ChevronLeft /></button
        >
        <span class={['place', { preferred: isPreferred }]} aria-live="polite">
          {isPreferred ? 'Preferred' : `${showing + 1} of ${voicings.length}`}
        </span>
        <button type="button" class="button step" aria-label="Next Voicing" title="Next Voicing" onclick={() => step(1)}
          ><ChevronRight /></button
        >
      </div>
      <!-- One button, so focus stays on it as Prefer turns to Clear. -->
      <button
        type="button"
        class="button prefer"
        title={isPreferred
          ? 'Stop preferring this Voicing, putting the top-ranked one first again'
          : `Show this Voicing of ${opened.name} first in this tuning, here and in the Chord Finder`}
        onclick={prefer}>{isPreferred ? 'Clear' : 'Prefer'}</button
      >
    {:else}
      <p class="muted note">
        {#if found.kind === 'unreadable-tuning'}
          The Song's tuning, “{song.tuning.trim()}”, can't be read, so there's no diagram.
        {:else if found.kind === 'unreadable-chord'}
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
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--shadow-float);
  }
  .name {
    color: var(--accent);
    font-size: var(--text-lg);
    font-weight: 700;
  }
  .diagram {
    width: 7.5rem;
  }
  /* Previous, where it is among the Voicings, and Next. */
  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .step {
    width: var(--control);
    padding: 0;
    font-size: var(--text-xl);
  }
  /* As wide as its longest text, so the buttons don't move as it steps. */
  .place {
    min-width: 5.5rem;
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  .place.preferred {
    color: var(--text);
    font-weight: 600;
  }
  .prefer {
    align-self: stretch;
    font-size: var(--text-md);
  }
  .note {
    max-width: 14rem;
    margin: 0;
    font-size: var(--text-md);
    text-align: center;
  }
</style>
