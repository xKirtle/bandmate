// The one Tour the app takes, from About, going round the app's own router.
import { navigate, router } from './router.svelte';
import { Tour } from './tour.svelte';

export const tour = new Tour({ go: (to, replace) => navigate(to, { replace }) });

/** Takes the Tour from the page showing, which it goes back to as it ends. */
export function takeTour() {
  tour.start(router.path + router.search);
}
