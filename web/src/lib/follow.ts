import { inTextField } from './textField';

/**
 * Keeps track of the Lyric Sheet's elements by key, e.g. an Occurrence or
 * one of its Lines, to scroll the current one into view as playback moves on.
 */
export function follower() {
  const shown = new Map<string, HTMLElement>();
  return {
    /** Tracks an element under a key while it's on the page. */
    track(el: HTMLElement, key: string) {
      shown.set(key, el);
      return () => {
        if (shown.get(key) === el) shown.delete(key);
      };
    },
    /**
     * Scrolls to the element under a key, unless that would pull the page
     * away from something being typed.
     */
    follow(key: string | null, block: ScrollLogicalPosition) {
      if (key === null || inTextField(document.activeElement)) return;
      shown.get(key)?.scrollIntoView({ block, behavior: 'smooth' });
    },
  };
}
