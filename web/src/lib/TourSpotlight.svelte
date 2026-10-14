<script lang="ts">
  // The Tour, drawn over the Demo Song's page while it runs: the page dimmed
  // but for a cut-out round the step's control, the spotlight, with a card
  // beside it. The Tour only shows, so the page under it is blocked: every
  // click is caught, the spotlit control's too, the rest of the app is inert,
  // and keys go to the Tour before the page's Shortcuts. Mounted once, in App.
  import { tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { router } from './router.svelte';
  import { popoverBeside } from './popover';
  import { scrollBehavior } from './motion';
  import { demoPath, steps, tourFits } from './tour.svelte';
  import { tour } from './theTour';

  // The Tour needs a wide window: narrowed to a phone's, it ends.
  const wide = new MediaQuery(tourFits);
  const onDemo = $derived(router.path === demoPath);
  const showing = $derived(tour.running && onDemo);

  // Leaving the Demo Song, e.g. with the browser's Back, ends it where it is.
  $effect(() => {
    if (tour.running && !onDemo) tour.stop();
  });
  $effect(() => {
    if (tour.running && !wide.current) tour.end();
  });

  const step = $derived(tour.step);

  // The step's control, and where it is, followed every frame while the Tour
  // shows: the page scrolls, the Timeline resizes, and the Song loads under it.
  let control = $state<HTMLElement | null>(null);
  let rect = $state<DOMRect | null>(null);
  $effect(() => {
    if (!showing) return;
    const name = step.control;
    let frame = 0;
    const follow = () => {
      // Written, never read: reading control here would make this effect
      // depend on it, and its teardown's write would start it over, forever.
      const found = name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
      control = found;
      const now = found?.getBoundingClientRect() ?? null;
      // Only a move redraws the spotlight and the card.
      if (
        !sameRect(
          now,
          untrack(() => rect),
        )
      )
        rect = now;
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      control = null;
      rect = null;
    };
  });

  function sameRect(a: DOMRect | null, b: DOMRect | null) {
    if (!a || !b) return a === b;
    return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  }

  // Each step brings its control into view once it's there. The Timeline is
  // docked at the window's foot, so what's in it is always in view.
  let shownFor = -1;
  $effect(() => {
    if (!showing) shownFor = -1;
    else if (control && shownFor !== tour.at) {
      shownFor = tour.at;
      if (!control.closest('[data-tour="timeline"]')) {
        control.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      }
    }
  });

  // Everything in the app but the Tour is inert while it shows: no clicks,
  // no focus, no Tab into the page.
  let layer = $state<HTMLElement>();
  $effect(() => {
    if (!showing || !layer?.parentElement) return;
    const blocked = [...layer.parentElement.children].filter((el): el is HTMLElement => el !== layer);
    for (const el of blocked) el.inert = true;
    return () => {
      for (const el of blocked) el.inert = false;
    };
  });

  // Keys go to the Tour alone, caught before the page's own listeners (Space
  // to play, R to record, Undo…): Esc ends it, ← and → step, and Tab, Enter
  // and Space work the card's buttons.
  let card = $state<HTMLElement>();
  $effect(() => {
    if (!showing) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        tour.end();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        tour.next();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        tour.back();
      } else if (event.key === 'Tab') {
        // Round the card's buttons and links, as in a modal dialog.
        event.preventDefault();
        const controls = [...(card?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
        const at = controls.indexOf(document.activeElement as HTMLElement);
        const by = event.shiftKey ? -1 : 1;
        controls[(at + by + controls.length) % controls.length]?.focus();
      } else if (!card?.contains(event.target as Node)) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    };
    addEventListener('keydown', keydown, { capture: true });
    return () => removeEventListener('keydown', keydown, { capture: true });
  });

  // The card, in the top layer, beside the control, which it waits for, gap
  // px from it and from the window's edges.
  const gap = 24;
  const placed = $derived(!step.control || !!rect);
  $effect(() => {
    if (!card || !rect) return;
    const at = popoverBeside(
      rect,
      card.getBoundingClientRect(),
      { width: document.documentElement.clientWidth, height: innerHeight },
      gap,
    );
    card.style.left = `${at.left}px`;
    card.style.top = `${at.top}px`;
  });

  // Focus sits on Next at every step, once the card shows.
  let next = $state<HTMLButtonElement>();
  let focusedFor = -1;
  $effect(() => {
    if (!showing) focusedFor = -1;
    else if (placed && next && focusedFor !== tour.at) {
      focusedFor = tour.at;
      const button = next;
      tick().then(() => button.focus({ preventScroll: true }));
    }
  });
</script>

<div class="tour" bind:this={layer}>
  {#if showing}
    <!-- Catches every click on the page, the spotlit control's included, keeping focus on the card. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      popover="manual"
      class="spotlight"
      aria-hidden="true"
      {@attach (el) => el.showPopover()}
      onmousedown={(e) => e.preventDefault()}
      style:--x={rect && `${rect.left}px`}
      style:--y={rect && `${rect.top}px`}
      style:--w={rect && `${rect.width}px`}
      style:--h={rect && `${rect.height}px`}
    >
      {#if rect}
        <div class="dim above"></div>
        <div class="dim below"></div>
        <div class="dim left"></div>
        <div class="dim right"></div>
        <div class="ring"></div>
      {:else}
        <div class="dim whole"></div>
      {/if}
    </div>
    {#key tour.at}
      <div
        popover="manual"
        class="popover card-step"
        class:centred={!step.control}
        class:waiting={!placed}
        bind:this={card}
        {@attach (el) => el.showPopover()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
      >
        <div class="progress">
          <div class="dots" aria-hidden="true">
            {#each steps as _, i (i)}<span class:done={i < tour.at} class:now={i === tour.at}></span>{/each}
          </div>
          <p class="count muted">{tour.count}</p>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        {#if step.link}<p><a href={step.link.href} target="_blank" rel="noreferrer">{step.link.text}</a></p>{/if}
        <div class="actions">
          <button type="button" class="button quiet" onclick={() => tour.end()}>End tour</button>
          <span class="spacer"></span>
          {#if tour.at > 0}
            <button type="button" class="button" onclick={() => tour.back()}>Back</button>
          {/if}
          <button type="button" class="button primary" bind:this={next} onclick={() => tour.next()}
            >{tour.last ? 'Finish' : 'Next'}</button
          >
        </div>
      </div>
    {/key}
  {/if}
</div>

<style>
  /* Takes no place in the app's layout: what it draws is in the top layer. */
  .tour {
    display: contents;
  }

  /* The spotlight, in the top layer over the whole page, under the card:
     the dim in four parts round a cut-out --space-2 wider than the control
     on every side, edged in the accent. */
  .spotlight {
    --pad: var(--space-2);
    --top: calc(var(--y) - var(--pad));
    --bottom: calc(var(--y) + var(--h) + var(--pad));
    --left: calc(var(--x) - var(--pad));
    --right: calc(var(--x) + var(--w) + var(--pad));

    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    overflow: visible;
    border: 0;
    background: none;
  }
  .dim {
    position: fixed;
    background: var(--dim);
  }
  .whole {
    inset: 0;
  }
  .above {
    inset: 0 0 auto;
    height: max(0px, var(--top));
  }
  .below {
    inset: var(--bottom) 0 0;
  }
  .left {
    top: var(--top);
    left: 0;
    width: max(0px, var(--left));
    height: calc(var(--bottom) - var(--top));
  }
  .right {
    top: var(--top);
    right: 0;
    left: var(--right);
    height: calc(var(--bottom) - var(--top));
  }
  .ring {
    position: fixed;
    top: var(--top);
    left: var(--left);
    width: calc(var(--right) - var(--left));
    height: calc(var(--bottom) - var(--top));
    border: 2px solid var(--accent);
    border-radius: var(--radius-md);
  }

  /* The step's card. */
  .card-step {
    width: 26rem;
    max-width: calc(100vw - 2 * var(--space-4));
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    font-size: var(--text-md);
  }
  .card-step h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xl);
  }
  .card-step p {
    margin: 0 0 var(--space-2);
  }
  .waiting {
    visibility: hidden;
  }
  .centred {
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .progress .count {
    margin: 0;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .dots {
    display: flex;
    gap: var(--space-1);
  }
  .dots span {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--border);
  }
  .dots .done {
    background: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .dots .now {
    width: var(--space-6);
    background: var(--accent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .spacer {
    flex: 1;
  }
</style>
