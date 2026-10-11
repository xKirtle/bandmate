import { createSubscriber } from 'svelte/reactivity';

// How much of the bottom of the window the on-screen keyboard covers, from
// the visual viewport, which shrinks as the keyboard comes up while the
// layout viewport, which fixed things sit in, doesn't. Zero without one, or
// where the browser has no visual viewport.

const subscribe = createSubscriber((update) => {
  const viewport = window.visualViewport;
  if (!viewport) return;
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
});

/** How far up from the bottom of the layout viewport the visual one ends, in pixels. */
export function keyboardInset(): number {
  subscribe();
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
}
