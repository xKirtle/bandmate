// Keeping the screen awake, e.g. while Auto-scroll runs, where the browser
// allows: through its Screen Wake Lock, which a page served over plain http
// or an older browser doesn't have, and which a browser may refuse, e.g. on
// low battery. Where it can't, nothing else changes.

/** A screen wake lock as the browser hands it out. */
type Lock = { release(): Promise<void> };

/** What keeping the screen awake needs of the browser: the page's, or a fake. */
export type ScreenAwakeBrowser = {
  navigator: { wakeLock?: { request(type: 'screen'): Promise<Lock> } };
  document: EventTarget & { readonly visibilityState: DocumentVisibilityState };
};

const page = (): ScreenAwakeBrowser => ({ navigator, document });

/**
 * Keeps the screen awake where the browser allows, asking again each time
 * the page shows again, since the browser lets go of the lock while it's
 * hidden. Hands back what lets the screen sleep again.
 */
export function keepScreenAwake(browser: ScreenAwakeBrowser = page()): () => void {
  let held: Lock | null = null;
  let lettingGo = false;

  const ask = async () => {
    try {
      const lock = await browser.navigator.wakeLock?.request('screen');
      if (!lock) return;
      if (lettingGo) {
        await lock.release();
        return;
      }
      // The one asked for before, if the browser hasn't let go of it.
      held?.release().catch(() => {});
      held = lock;
    } catch {
      // Refused, or released already: the screen sleeps as it would.
    }
  };
  const shown = () => {
    if (browser.document.visibilityState === 'visible') void ask();
  };

  browser.document.addEventListener('visibilitychange', shown);
  void ask();
  return () => {
    lettingGo = true;
    browser.document.removeEventListener('visibilitychange', shown);
    held?.release().catch(() => {});
    held = null;
  };
}
