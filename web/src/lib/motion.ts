/**
 * Motion done in script, which the duration tokens can't reach. Like the
 * stylesheet's, it only explains a change, and stops when the user has asked
 * for reduced motion (docs/design.md).
 */

/** Whether the user has asked for reduced motion. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How to scroll something into view: smoothly, or straight there under reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}
