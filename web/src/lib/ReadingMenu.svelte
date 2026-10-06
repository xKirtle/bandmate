<script lang="ts">
  import AArrowDown from '@lucide/svelte/icons/a-arrow-down';
  import AArrowUp from '@lucide/svelte/icons/a-arrow-up';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Minus from '@lucide/svelte/icons/minus';
  import Pin from '@lucide/svelte/icons/pin';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { songChordsShown } from './chordsShown';
  import { largestLyricSize, smallestLyricSize, stepLyricSize, usualLyricSize } from './lyricSize';
  import { placeBeside } from './popover';
  import { blockedRows, readingBadge } from './readingMenu';
  import { chordChartState } from './sharedChordChartState.svelte';
  import { lyricSize } from './sharedLyricSize.svelte';
  import { songTranspose } from './sharedTranspose.svelte';
  import { stepTranspose, transposeLimit, transposeText } from './transposeAmount';

  // Read mode's choices about how the Song reads, behind one button in the
  // Lyric Sheet's header: the Lyric Size, whether the Chords show, Transpose,
  // and the Chord Chart's eye and pin. Each is kept on this device, as before.
  // It stays open while they change, and every Song has the same rows, a
  // Chord row disabled, saying why, where it can't apply.

  let {
    songId,
    hasChords,
  }: {
    songId: number;
    /** Whether the Song has any Chords. */
    hasChords: boolean;
  } = $props();

  const size = $derived(lyricSize.value);
  const chordsShown = $derived(songChordsShown.of(songId));
  const transpose = $derived(songTranspose.of(songId));
  const transposeShown = $derived(transposeText(transpose));
  const chart = $derived(chordChartState.current);
  const badge = $derived(readingBadge({ hasChords, chordsShown, transpose }));
  const blocked = $derived(blockedRows({ hasChords, chordsShown }));

  // On a phone the button is its icon alone.
  const wide = new MediaQuery('min-width: 40.0625rem');

  let open = $state(false);
  let root: HTMLElement;
  let button: HTMLButtonElement;
  let panel = $state<HTMLElement>();
  // Between the button and the panel, in px.
  const gap = 4;

  async function show() {
    open = true;
    await tick();
    if (!panel) return;
    panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }

  // Under the button, or over it where there's no room below, lined up with
  // its end, since it sits at the end of the header.
  function place() {
    if (panel) placeBeside(panel, button, gap, 'end');
  }

  function close() {
    open = false;
    button.focus();
  }

  // Escape closes it, giving focus back to the button.
  function onPanelKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // A tap outside closes it, leaving focus to wherever the tap puts it.
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  // Focus moving elsewhere on the page, e.g. by Tab past its last button,
  // closes it too; the window losing focus doesn't.
  function onFocusOut(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.contains(to)) open = false;
  }
</script>

<!-- Placed as it opens, and again as the window resizes. Scrolling leaves it
     where it is: a change of Lyric Size scrolls to keep the Line in view. -->
<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => open && place()} />

<div class="reading" bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="button trigger"
    bind:this={button}
    aria-haspopup="dialog"
    aria-expanded={open}
    title="Reading options"
    onclick={() => (open ? close() : show())}
  >
    <SlidersHorizontal />
    <span class:visually-hidden={!wide.current}>Reading</span>
    {#if badge}
      <span class="badge tabular" aria-label="transposed {badge} semitones">{badge}</span>
    {/if}
  </button>
  {#if open}
    <div
      class="popover panel"
      role="dialog"
      aria-label="Reading options"
      tabindex="-1"
      popover="manual"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      <span id="reading-size" class="name">Lyric Size</span>
      <div class="controls" role="group" aria-labelledby="reading-size">
        <button
          type="button"
          class="button step"
          disabled={size <= smallestLyricSize}
          onclick={() => lyricSize.set(stepLyricSize(size, -1))}
          aria-label="Make the lyrics smaller"
          title="Make the lyrics smaller"><AArrowDown /></button
        >
        <button
          type="button"
          class="button amount"
          disabled={size === usualLyricSize}
          onclick={() => lyricSize.set(usualLyricSize)}
          aria-label={size === usualLyricSize
            ? 'The lyrics show at their usual size'
            : `Lyrics at ${size}%; show them at their usual size`}
          title={size === usualLyricSize
            ? 'The lyrics show at their usual size'
            : 'Show the lyrics at their usual size'}>{size}%</button
        >
        <button
          type="button"
          class="button step"
          disabled={size >= largestLyricSize}
          onclick={() => lyricSize.set(stepLyricSize(size, 1))}
          aria-label="Make the lyrics larger"
          title="Make the lyrics larger"><AArrowUp /></button
        >
      </div>

      <span id="reading-chords" class="name" class:blocked={blocked.chords} title={blocked.chords}>Chords</span>
      <div class="controls" role="group" aria-labelledby="reading-chords">
        <!-- An eye, crossed out while the Chords are hidden. -->
        <button
          type="button"
          class="button toggle outlined step"
          aria-pressed={hasChords && chordsShown}
          disabled={blocked.chords !== null}
          onclick={() => songChordsShown.set(songId, !chordsShown)}
          aria-label="Show the Chords"
          title={blocked.chords ?? (chordsShown ? 'Hide the Chords' : 'Show the Chords')}
          >{#if hasChords && chordsShown}<Eye />{:else}<EyeOff />{/if}</button
        >
      </div>

      <span id="reading-transpose" class="name" class:blocked={blocked.transpose} title={blocked.transpose}
        >Transpose</span
      >
      <div class="controls" role="group" aria-labelledby="reading-transpose">
        <button
          type="button"
          class="button step"
          disabled={blocked.transpose !== null || transpose <= -transposeLimit}
          onclick={() => songTranspose.set(songId, stepTranspose(transpose, -1))}
          aria-label="Transpose the Chords down a semitone"
          title={blocked.transpose ?? 'Transpose the Chords down a semitone'}><Minus /></button
        >
        <button
          type="button"
          class="button amount"
          class:blocked={blocked.transpose}
          disabled={blocked.transpose !== null || transpose === 0}
          onclick={() => songTranspose.set(songId, 0)}
          aria-label={transpose === 0
            ? 'The Chords show as written'
            : `Transposed ${transposeShown} semitones; show the Chords as written`}
          title={blocked.transpose ?? (transpose === 0 ? 'The Chords show as written' : 'Show the Chords as written')}
          >{transposeShown}</button
        >
        <button
          type="button"
          class="button step"
          disabled={blocked.transpose !== null || transpose >= transposeLimit}
          onclick={() => songTranspose.set(songId, stepTranspose(transpose, 1))}
          aria-label="Transpose the Chords up a semitone"
          title={blocked.transpose ?? 'Transpose the Chords up a semitone'}><Plus /></button
        >
      </div>

      <span id="reading-chart" class="name" class:blocked={blocked.chart} title={blocked.chart}>Chord Chart</span>
      <div class="controls" role="group" aria-labelledby="reading-chart">
        <!-- Hidden, the Chart keeps whether it's pinned for when it's shown. -->
        <button
          type="button"
          class="button toggle outlined step"
          aria-pressed={chart.shown}
          disabled={blocked.chart !== null}
          onclick={() => chordChartState.setShown(!chart.shown)}
          aria-label="Show the Chord Chart"
          title={blocked.chart ?? (chart.shown ? 'Hide the Chord Chart' : 'Show the Chord Chart')}
          >{#if chart.shown}<Eye />{:else}<EyeOff />{/if}</button
        >
        <!-- A pushpin, filled while pinned. -->
        <button
          type="button"
          class="button toggle outlined step pin"
          aria-pressed={chart.pinned}
          disabled={blocked.chart !== null}
          onclick={() => chordChartState.setPinned(!chart.pinned)}
          aria-label="Pin the Chord Chart to the top"
          title={blocked.chart ?? (chart.pinned ? 'Unpin the Chord Chart' : 'Pin the Chord Chart to the top')}
          ><Pin /></button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* How far the Chords on screen are transposed, in the accent like them. */
  .trigger .badge {
    background: var(--accent);
    color: var(--accent-text);
  }
  /* Each row's name, then its controls, lined up in two columns. */
  .panel {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    max-width: calc(100vw - 2rem);
    padding: var(--space-3) var(--space-4);
  }
  .panel:focus {
    outline: none;
  }
  .name {
    font-size: var(--text-md);
    font-weight: 600;
  }
  .name.blocked {
    color: var(--text-muted);
  }
  .controls {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-1);
  }
  .step {
    min-width: var(--control);
    padding: 0;
  }
  /* Wide enough for "−11" or "175%", so the steps don't move as the amount changes. */
  .amount {
    min-width: 3.25rem;
    padding: 0 var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  /* At its usual amount, it's muted rather than faded; in a disabled row it
     fades with the steps. */
  .amount:disabled:not(.blocked) {
    opacity: 1;
    color: var(--text-muted);
  }
  .pin[aria-pressed='true'] :global(.lucide-pin) {
    fill: currentColor;
  }
</style>
