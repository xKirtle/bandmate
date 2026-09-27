// Only one thing plays at a time: starting a player pauses the one before.

let playing: HTMLMediaElement | null = null;

/** Use as a media element's onplay handler. */
export function playAlone(event: Event) {
  const player = event.currentTarget as HTMLMediaElement;
  if (playing && playing !== player) playing.pause();
  playing = player;
}
