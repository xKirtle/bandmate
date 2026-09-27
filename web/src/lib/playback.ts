// Only one thing plays at a time: the Timeline, a Master or a Beat preview.
// Starting one stops the one before.

let current: { owner: object; stop: () => void } | null = null;

/** Takes over playback for owner, stopping whatever played before. stop is how others stop it. */
export function playAlone(owner: object, stop: () => void) {
  if (current && current.owner !== owner) current.stop();
  current = { owner, stop };
}

/** Use as a media element's onplay handler. */
export function playMediaAlone(event: Event) {
  const player = event.currentTarget as HTMLMediaElement;
  playAlone(player, () => player.pause());
}
