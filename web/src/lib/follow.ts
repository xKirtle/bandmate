import { scrollBehavior } from './motion';
import { inTextField } from './textField';

/** Names a Section among the tracked elements. */
export function sectionKey(section: number): string {
  return `section:${section}`;
}

/** Names a Line among the tracked elements and Cue fields. */
export function lineKey(line: number): string {
  return `line:${line}`;
}

/**
 * Keeps track of the Lyric Sheet's elements by key, a Section or a Line, to
 * scroll the current one into view as playback moves on.
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
     * something being typed. It glides there, or jumps under reduced
     * motion: either way it keeps up with playback.
     */
    follow(key: string | null) {
      if (key === null || inTextField(document.activeElement)) return;
      shown
        .get(key)
        ?.scrollIntoView({ block: key.startsWith('line:') ? 'center' : 'start', behavior: scrollBehavior() });
    },
  };
}
