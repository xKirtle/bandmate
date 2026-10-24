<script lang="ts">
  // Auto-scroll's button, in the Lyric Sheet's header in Read mode beside
  // Reading, and its pill, floating at the foot of the window while it runs,
  // with its speed and a pause button, as the header has scrolled away by
  // then. Its key, A unless rebound, starts and pauses it too, and [ and ]
  // slow it down and speed it up. It's made with Read mode, so
  // leaving Read mode or the Song stops it.
  import ChevronsDown from '@lucide/svelte/icons/chevrons-down';
  import Minus from '@lucide/svelte/icons/minus';
  import Pause from '@lucide/svelte/icons/pause';
  import Plus from '@lucide/svelte/icons/plus';
  import { MediaQuery } from 'svelte/reactivity';
  import { AutoScroll, autoScrollPace, type AutoScrollPage } from './autoScroll.svelte';
  import { fastestSpeed, slowestSpeed, stepAutoScrollSpeed } from './autoScrollSpeed';
  import { keyHints } from './keyHints';
  import { keepScreenAwake } from './screenAwake';
  import { songAutoScrollSpeed } from './sharedAutoScrollSpeed.svelte';
  import { lyricSize } from './sharedLyricSize.svelte';
  import { rebound } from './shortcutKeys';
  import { autoScrollSpeedStep, togglesAutoScroll } from './songKeys';

  let {
    songId,
    sheet,
    playing,
  }: {
    songId: number;
    /** The Lyric Sheet, whose end Auto-scroll stops at. */
    sheet: HTMLElement | undefined;
    /** Whether the Timeline is playing, whose cued Lines lead instead. */
    playing: boolean;
  } = $props();

  // The speed level, which the Reading menu sets too: a change takes effect
  // from the next frame.
  const level = $derived(songAutoScrollSpeed.of(songId));
  const slower = () => songAutoScrollSpeed.set(songId, stepAutoScrollSpeed(level, -1));
  const faster = () => songAutoScrollSpeed.set(songId, stepAutoScrollSpeed(level, 1));

  // The foot of the window, above the docked Timeline and the tab bar: the
  // pill floats over it, and the Lyric Sheet's end is in view once it's
  // scrolled above it.
  let foot = $state<HTMLElement>();
  // How many fingers are on the page, which may be about to scroll it.
  let fingers = 0;
  const countFingers = (e: TouchEvent) => (fingers = e.touches.length);

  const page: AutoScrollPage = {
    scrolled: () => scrollY,
    sheetEnd() {
      const root = document.documentElement;
      const last = root.scrollHeight - root.clientHeight;
      if (!sheet || !foot) return last;
      const past = sheet.getBoundingClientRect().bottom - foot.getBoundingClientRect().top;
      return Math.max(0, Math.min(last, scrollY + past));
    },
    // Straight there every frame, under reduced motion too: it's movement
    // the reader asked for, and it tracks time, like the playhead.
    scrollTo: (top) => scrollTo({ top, behavior: 'instant' }),
    heldByHand: () => fingers > 0,
  };

  const autoScroll = new AutoScroll({
    page,
    pace: () => autoScrollPace(level, lyricSize.value),
    timelinePlaying: () => playing,
    keepAwake: () => keepScreenAwake(),
  });
  $effect(() => () => autoScroll.stop());

  // On a phone the button is its icon alone, as Reading's is.
  const wide = new MediaQuery('min-width: 40.0625rem');
  const hints = keyHints();
  const keys = $derived(rebound().autoScroll.keys);
  const speedKeys = $derived(rebound().autoScrollSpeed);

  function onKey(event: KeyboardEvent) {
    if (togglesAutoScroll(event)) {
      event.preventDefault();
      autoScroll.toggle();
      return;
    }
    const by = autoScrollSpeedStep(event);
    if (by === null) return;
    event.preventDefault();
    songAutoScrollSpeed.set(songId, stepAutoScrollSpeed(level, by));
  }
</script>

<svelte:window onkeydown={onKey} ontouchstart={countFingers} ontouchend={countFingers} ontouchcancel={countFingers} />

<!-- Clicked, it keeps focus where it was, so Space then plays rather than pressing it again. -->
<button
  type="button"
  class="button toggle trigger"
  aria-pressed={autoScroll.running}
  aria-keyshortcuts={hints.aria(keys)}
  disabled={playing}
  onpointerdown={(e) => e.preventDefault()}
  onclick={autoScroll.toggle}
  title={playing
    ? 'The Timeline is playing, so its cued Lines lead'
    : hints.withKeys('Scroll the Lyric Sheet on its own', keys)}
>
  <ChevronsDown />
  <span class:visually-hidden={!wide.current}>Auto-scroll</span>
</button>

<div class="foot" bind:this={foot}>
  {#if autoScroll.running}
    <div class="pill" role="group" aria-label="Auto-scroll">
      <button
        type="button"
        class="icon"
        disabled={level <= slowestSpeed}
        aria-label="Slow Auto-scroll down"
        aria-keyshortcuts={hints.aria(speedKeys.back)}
        title={hints.withKeys('Slow Auto-scroll down', speedKeys.back)}
        onclick={slower}><Minus /></button
      >
      <span class="level tabular" title="Auto-scroll speed"><span class="visually-hidden">Speed</span> {level}</span>
      <button
        type="button"
        class="icon"
        disabled={level >= fastestSpeed}
        aria-label="Speed Auto-scroll up"
        aria-keyshortcuts={hints.aria(speedKeys.forward)}
        title={hints.withKeys('Speed Auto-scroll up', speedKeys.forward)}
        onclick={faster}><Plus /></button
      >
      <button
        type="button"
        class="icon"
        aria-label="Pause Auto-scroll"
        title={hints.withKeys('Pause Auto-scroll', keys)}
        onclick={autoScroll.stop}><Pause /></button
      >
    </div>
  {/if}
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* No height and nothing to press: only where the foot of the window is,
     clear of the docked Timeline and the tab bar, as the toasts are. Over
     the toasts, so the pill is never under one. */
  .foot {
    position: fixed;
    right: 0;
    bottom: calc(var(--nav-bottom-space) + var(--timeline-height, 0px));
    left: 0;
    z-index: 3;
    height: 0;
    pointer-events: none;
  }
  /* A floating bar in the bottom corner, above the toasts there, if any,
     --space-2 clear of them as they're clear of each other. */
  .pill {
    position: absolute;
    right: max(var(--gutter), env(safe-area-inset-right));
    bottom: calc(var(--space-4) + var(--toasts-height, 0px) + min(var(--toasts-height, 0px), var(--space-2)));
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--bg);
    box-shadow: var(--shadow-float);
    pointer-events: auto;
  }
  /* The controls to press while it runs, so they read as controls at a
     glance rather than muted. */
  .pill .icon {
    border-radius: var(--radius-full);
    color: var(--text);
  }
  /* Wide enough for "10", so the steps don't move as the level changes. */
  .level {
    min-width: 1.5rem;
    text-align: center;
  }
  :global(:root[data-theme='dark']) .pill {
    background: var(--surface-1);
  }
</style>
