import { inTextField } from './textField';

/** Names an Occurrence, or one of its Lines, among the tracked elements and Cue fields. */
export function key(occurrence: number, line: number | null = null): string {
  return line === null ? `${occurrence}` : `${occurrence}:${line}`;
}

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
     * Scrolls to the element under a key, a Line to the middle and a whole
     * Section to the top, unless that would pull the page away from
     * something being typed.
     */
    follow(key: string | null) {
      if (key === null || inTextField(document.activeElement)) return;
      shown.get(key)?.scrollIntoView({ block: key.includes(':') ? 'center' : 'start', behavior: 'smooth' });
    },
  };
}
