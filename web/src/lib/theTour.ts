// The one Tour the app takes, from the Songs page, going round the app's own router.
import { navigate, router } from './router.svelte';
import { Tour } from './tour.svelte';

// It's taken from the page before the Demo Song's in the history, as a
// reload ends it, so going back is Back: the history is left as it was.
export const tour = new Tour({ go: (to) => navigate(to), goBack: () => history.back() });

/** Takes the Tour from the page showing, which it goes back to as it ends. */
export function takeTour() {
  tour.start(router.path + router.search);
}
