// The Timeline's layouts on a phone, told apart by window shape, not device.
// The same queries are written out in the CSS (Timeline.svelte, app.css),
// which fullScreenTimeline.test.ts holds to these.

/**
 * A phone held sideways, or any landscape window under 30rem tall: the
 * Timeline fills the window, and its Tracks area takes all the height below
 * the transport row, whatever height is chosen.
 */
export const fullScreenQuery = '(orientation: landscape) and (height < 30rem)';

/** A phone held upright: the transport row alone, where the full-screen Timeline isn't. */
export const uprightPhoneQuery = '(max-width: 40rem) and ((orientation: portrait) or (height >= 30rem))';
