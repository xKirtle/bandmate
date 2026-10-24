<script lang="ts">
  // PROTOTYPE, throw away: three variants of Auto-scroll in Read mode,
  // switchable via `?variant=A|B|C` on the Song page, to answer how the
  // speed control should feel (its units and range) and whether a floating
  // control while it runs is right. Not for main.
  //
  //   A: Header Play + floating pill (pause, −, speed level 1–10, +).
  //   B: Header Play + a throttle rail at the right edge, in Lines a minute.
  //   C: Header "Scroll through in m:ss", a thin progress bar on top, tap the
  //      lyrics to pause; the pace is the rest of the sheet over the time left.
  //
  // Shared by all: scrolling yourself carries on from the new place; the
  // Timeline playing turns it off; the screen is kept awake while it runs;
  // it stops at the bottom, and play from the bottom starts at the top.
  // Keys: A starts or pauses ([Space] plays the Timeline), [ and ] slow down
  // and speed up.
  import ChevronsDown from '@lucide/svelte/icons/chevrons-down';
  import Minus from '@lucide/svelte/icons/minus';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Timer from '@lucide/svelte/icons/timer';
  import { onDestroy } from 'svelte';
  import PrototypeSwitcher from './PrototypeSwitcher.svelte';

  let { playing }: { playing: boolean } = $props();

  const variants = { A: 'Pill, levels', B: 'Throttle rail, Lines/min', C: 'Song length, tap to pause' };
  type Variant = keyof typeof variants;
  let variant = $state<Variant>(pick(new URLSearchParams(location.search).get('variant')));
  function pick(v: string | null): Variant {
    return v === 'B' || v === 'C' ? v : 'A';
  }

  // A: level 1–10, a px/s curve. B: Lines a minute. C: seconds for the whole sheet.
  let level = $state(4);
  let linesPerMinute = $state(14);
  let lengthSeconds = $state(210);

  let running = $state(false);
  let lastStop = $state('');
  let pxPerSecond = $state(0);

  function lineHeight(): number {
    const line = document.querySelector<HTMLElement>('.line-box');
    return line?.getBoundingClientRect().height || 40;
  }
  function maxScroll(): number {
    return document.documentElement.scrollHeight - innerHeight;
  }
  // C: a target length for the whole sheet, so the pace is what's left over the time left.
  let endsAt = 0;

  function speed(): number {
    if (variant === 'A') return [0, 6, 10, 15, 21, 28, 36, 46, 58, 72, 90][level];
    if (variant === 'B') return (linesPerMinute * lineHeight()) / 60;
    const left = Math.max(0.5, (endsAt - performance.now()) / 1000);
    return Math.max(0, maxScroll() - scrollY) / left;
  }

  let frame = 0;
  let pos = 0;
  let last = 0;
  let wake = $state<{ release(): Promise<void> } | null>(null);

  async function start() {
    if (playing) return;
    if (scrollY >= maxScroll() - 1) scrollTo({ top: 0, behavior: 'instant' });
    pos = scrollY;
    last = performance.now();
    if (variant === 'C') endsAt = last + lengthSeconds * 1000 * (1 - scrollY / Math.max(1, maxScroll()));
    running = true;
    lastStop = '';
    frame = requestAnimationFrame(tick);
    try {
      wake = await (navigator as any).wakeLock?.request('screen');
    } catch {
      wake = null;
    }
  }
  function stop(why: string) {
    running = false;
    lastStop = why;
    cancelAnimationFrame(frame);
    void wake?.release();
    wake = null;
  }
  function toggle() {
    if (running) stop('paused');
    else void start();
  }
  function tick(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Scrolled by hand (wheel, swipe, scrollbar): carry on from there.
    if (Math.abs(scrollY - Math.round(pos)) > 2) {
      if (variant === 'C') endsAt = now + lengthSeconds * 1000 * (1 - scrollY / Math.max(1, maxScroll()));
      pos = scrollY;
    }
    pxPerSecond = speed();
    pos = Math.min(maxScroll(), pos + pxPerSecond * dt);
    scrollTo({ top: pos, behavior: 'instant' });
    if (pos >= maxScroll() - 1) return stop('reached the bottom');
    frame = requestAnimationFrame(tick);
  }

  $effect(() => {
    if (playing && running) stop('the Timeline started playing');
  });
  onDestroy(() => running && stop('left'));

  function slower() {
    if (variant === 'A') level = Math.max(1, level - 1);
    else if (variant === 'B') linesPerMinute = Math.max(2, linesPerMinute - 1);
    else nudgeLength(15);
  }
  function faster() {
    if (variant === 'A') level = Math.min(10, level + 1);
    else if (variant === 'B') linesPerMinute = Math.min(60, linesPerMinute + 1);
    else nudgeLength(-15);
  }
  function nudgeLength(by: number) {
    lengthSeconds = Math.min(900, Math.max(30, lengthSeconds + by));
    if (running) endsAt = performance.now() + lengthSeconds * 1000 * (1 - scrollY / Math.max(1, maxScroll()));
  }
  function clock(s: number): string {
    const t = Math.round(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable], dialog')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'a') toggle();
    else if (e.key === '[') slower();
    else if (e.key === ']') faster();
    else return;
    e.preventDefault();
  }
  // C: a tap on the lyrics pauses or resumes. A drag (a swipe) doesn't.
  let down: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent) {
    down =
      variant === 'C' && (e.target as HTMLElement).closest('.line-box, .sheet') ? { x: e.clientX, y: e.clientY } : null;
  }
  function onUp(e: PointerEvent) {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) toggle();
    down = null;
  }

  // C: how far through the sheet, for the bar on top.
  let through = $state(0);
  function onScroll() {
    through = maxScroll() > 0 ? scrollY / maxScroll() : 0;
  }

  function change(v: string) {
    if (running) stop('switched variant');
    variant = v as Variant;
  }
</script>

<svelte:window onkeydown={onKey} onpointerdown={onDown} onpointerup={onUp} onscroll={onScroll} />

{#if variant === 'C'}
  <div class="length">
    <button
      type="button"
      class="button"
      aria-pressed={running}
      onclick={toggle}
      disabled={playing}
      title="Auto-scroll (A)"
    >
      {#if running}<Pause />{:else}<Timer />{/if}
      <span>Scroll through in</span>
    </button>
    <button type="button" class="button icon" aria-label="Shorter" onclick={() => nudgeLength(-15)}><Minus /></button>
    <span class="tabular">{clock(lengthSeconds)}</span>
    <button type="button" class="button icon" aria-label="Longer" onclick={() => nudgeLength(15)}><Plus /></button>
  </div>
{:else}
  <button
    type="button"
    class="button"
    aria-pressed={running}
    onclick={toggle}
    disabled={playing}
    title={playing ? 'The Timeline is playing: its cued Lines lead' : 'Auto-scroll (A)'}
  >
    {#if running}<Pause />{:else}<ChevronsDown />{/if}
    <span>Auto-scroll</span>
  </button>
{/if}

{#if variant === 'A' && running}
  <div class="pill" role="group" aria-label="Auto-scroll">
    <button type="button" class="round" aria-label="Pause" onclick={() => stop('paused')}><Pause /></button>
    <button type="button" class="round" aria-label="Slower" onclick={slower} disabled={level === 1}><Minus /></button>
    <span class="tabular level" title="Speed">{level}</span>
    <button type="button" class="round" aria-label="Faster" onclick={faster} disabled={level === 10}><Plus /></button>
  </div>
{/if}

{#if variant === 'B' && running}
  <div class="rail" role="group" aria-label="Auto-scroll">
    <button type="button" class="round" aria-label="Faster" onclick={faster}><Plus /></button>
    <input
      type="range"
      min="2"
      max="60"
      step="1"
      bind:value={linesPerMinute}
      aria-label="Lines a minute"
      style="writing-mode: vertical-lr; direction: rtl"
    />
    <button type="button" class="round" aria-label="Slower" onclick={slower}><Minus /></button>
    <span class="tabular rate">{linesPerMinute}<small>Lines/min</small></span>
    <button type="button" class="round" aria-label="Pause" onclick={() => stop('paused')}><Pause /></button>
  </div>
{/if}

{#if variant === 'C'}
  <div class="bar" class:on={running} style="transform: scaleX({through})"></div>
{/if}

<!-- PROTOTYPE state readout and switcher, dev only. -->
{#if import.meta.env.DEV}
  <div class="state tabular">
    {variant}: {running ? 'running' : 'stopped'}{lastStop && !running ? ` (${lastStop})` : ''} · {pxPerSecond.toFixed(
      1,
    )} px/s · ≈{((pxPerSecond * 60) / lineHeight()).toFixed(1)} Lines/min · wake lock {wake ? 'on' : 'off'} · Timeline {playing
      ? 'playing'
      : 'stopped'}
  </div>
  <PrototypeSwitcher {variants} current={variant} onchange={change} />
{/if}

<style>
  .length {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .icon {
    padding-inline: var(--space-2);
  }

  .pill,
  .rail {
    position: fixed;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    background: var(--bg);
    box-shadow: var(--shadow-float);
  }

  .pill {
    right: max(var(--space-4), env(safe-area-inset-right));
    bottom: calc(var(--space-8) * 2);
    border-radius: var(--radius-full);
  }

  .rail {
    top: 50%;
    right: max(var(--space-2), env(safe-area-inset-right));
    flex-direction: column;
    border-radius: var(--radius-lg);
    transform: translateY(-50%);
  }

  .rail input {
    block-size: 40vh;
  }

  .rate {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: var(--text-lg);
  }

  .rate small {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .round {
    display: grid;
    place-items: center;
    inline-size: var(--control);
    block-size: var(--control);
    border: 0;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-xl);
  }

  .round:disabled {
    opacity: 0.4;
  }

  .level {
    min-inline-size: 2ch;
    font-size: var(--text-xl);
    text-align: center;
  }

  .bar {
    position: fixed;
    z-index: 20;
    top: 0;
    left: 0;
    inline-size: 100%;
    block-size: var(--space-1);
    background: var(--text-muted);
    transform-origin: left;
  }

  .bar.on {
    background: var(--accent);
  }

  .state {
    position: fixed;
    z-index: 30;
    top: var(--space-2);
    left: 50%;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--text);
    color: var(--bg);
    font-size: var(--text-xs);
    transform: translateX(-50%);
    pointer-events: none;
  }
</style>
