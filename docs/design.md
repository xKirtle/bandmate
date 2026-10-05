# Design

How Bandmate looks, and why. The values themselves live in the tokens: the colours in `web/src/palettes.css`, the rest at the top of `web/src/app.css`; this page says what each is for and when to use it. Decided in the visual identity spec, #565, and recorded in [ADR 0014](adr/0014-every-style-value-comes-from-a-token.md).

## Personality

Bandmate is **a songwriter's notebook**: warm, personal, unhurried. Lyrics feel like writing, not data entry. In Read mode it becomes **a quiet stage companion**: calm, high-contrast, readable at a glance from a music stand, and out of the way.

It never looks like a corporate dashboard, a cluttered DAW, or anything neon.

## Principles

1. **Content speaks notebook, tools speak chrome.** _Content_ is what the user wrote: Lines, Chords, Labels, a Song's title and notes, the Scrapbook. It gets room: generous sizes and line height, and Read mode's larger lyric sizes. _Tools_ (the Timeline, transport, Track headers, toolbars, dialogs, the Beat Library) are denser and quieter, with tabular digits. One typeface, the system font, everywhere.
2. **The defaults are tuned for desk writing.** Read mode gets a performance treatment: larger Lines and Chords, higher contrast, minimal chrome.
3. **Paper doesn't float.** Layers are flat surfaces and borders. Shadows are kept for floating layers (popovers, menus, dialogs), scrims and "selected" outlines.
4. **Both themes are first-class.** They follow the system setting unless the user picks Light or Dark in Settings, and every colour has a light and a dark value in every Palette.
5. **Motion only explains a change**: something opening, moving or appearing. Nothing bounces, and reduced motion is respected.
6. **Every style value comes from a token**, enforced by Stylelint. A value the scale lacks is a new token, added here and in `app.css`, never a one-off.

## Foundations

Each foundation lands in its own ticket, which migrates every component onto its tokens and turns on its Stylelint ban in the same PR. A foundation marked _to come_ still has literal values in the components.

### Colour

Colours are named by role, never by hue, so a component reads the same in every Palette and theme. A **Palette** is a full set of them in light and dark, with neutrals tinted towards its accent:

- **Terracotta**, the default: terracotta on warm grey, or on charcoal.
- **Ink**: fountain-pen blue on cream, or blue-black.
- **Olive**: muted green on stone.

The `data-palette` attribute on the root element picks one (`ink` or `olive`; Terracotta when it's absent), and Light or Dark follows the system. The user will pick a Palette, and System, Light or Dark, in Settings, kept per device (_to come_, #578). All Clips on the Timeline use the one accent, and the Chosen Track is marked by an accent edge on its header.

| Token                             | For                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| `--bg`                            | The page                                                                 |
| `--surface-1`, `--surface-2`      | Cards and panels, then controls and raised areas on them                 |
| `--border`                        | Edges. Decorative only: never the only thing that marks a control        |
| `--text`, `--text-muted`          | Text, and secondary text (hints, timestamps, empty states)               |
| `--accent`, `--accent-text`       | The primary action, the current or chosen thing, Chords; text on accent  |
| `--danger`, `--warning`           | Destructive actions and errors; warnings                                 |
| `--drafting-*`, `--finished-*`    | The drafting and finished Status badges (`-bg` and `-fg`)                |

Shared by every Palette, the scrim and the only shadows there are:

| Token                | For                                                                         |
| -------------------- | --------------------------------------------------------------------------- |
| `--scrim`            | Dims what's behind a dialog, or outside a Cover's crop                      |
| `--on-scrim`         | Drawn on the scrim, whatever the theme, e.g. the Cover crop's frame         |
| `--shadow-float`     | Lifts a floating layer (a popover, menu or floating bar) off the page       |
| `--selected-outline` | Rings what's selected, such as a Clip, or what a drop would land on         |
| `--selected-edge`    | Marks the current or chosen row along its left edge, e.g. the Chosen Track  |
| `--invalid-outline`  | Rings a field holding an invalid value, inside its danger border            |

A literal colour is written only in `palettes.css`, and a `box-shadow` is always one of these tokens: Stylelint fails anything else. A tint of a token, such as `color-mix(in srgb, var(--accent) 12%, transparent)`, is allowed.

**Contrast floor**, in both themes of every Palette: 4.5:1 for all text, 3:1 for controls and anything else that carries meaning, and 7:1 for Lines in Read mode. Chords in Read mode are held to 4.5:1, since Terracotta's accent misses 7:1 and that was accepted. `palettes.test.ts` checks every meaningful pair, so a Palette that breaks the floor fails CI.

### Type

The system font everywhere, with no typeface bundled. Content and tools differ by size and line height alone: tools take the small end of the scale, content the larger sizes and the lyric sizes.

| Token          | Size                        | For                                                                                    |
| -------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `--text-xs`    | 0.75rem                     | The smallest labels: badges, navigation labels, Clip labels, hints in pills            |
| `--text-sm`    | 0.8125rem                   | Secondary text in tools: hints, notices, table cells, a Section's heading in Read mode |
| `--text-md`    | 0.875rem                    | Tool text: buttons and fields in toolbars and dialogs, lists, menus                    |
| `--text-lg`    | 1rem                        | Body text, and the headings of cards and panels                                        |
| `--text-xl`    | 1.25rem                     | Dialog titles, glyph icons, larger headings                                            |
| `--text-2xl`   | 1.5rem                      | Page titles, and a Song's title                                                        |
| `--text-field` | `max(var(--text-lg), 16px)` | Text fields: under 16px, iOS zooms in on focus                                         |

Content's line height is `--leading-content` (1.6), for Lines in Write mode and a Song's notes; tools keep the page's 1.5. The lyric sizes are content's own, separate from the scale so Read mode can be tuned on its own:

| Token                  | For                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `--lyric-write`        | Lines and Chords as typed in Write mode: a text field's size, with `--leading-content` |
| `--lyric-read-line`    | Lines in Read mode                                                                     |
| `--lyric-read-chord`   | Chords above their Lines in Read mode                                                  |
| `--lyric-read-leading` | The line height of Lines in Read mode                                                  |

Every time, BPM and Gain uses tabular digits, so numbers don't jitter as they change: through the `.tabular` class, or `font-variant-numeric: tabular-nums` in a component's own rule for it. Number fields have them anyway.

A `font-size` is always one of these tokens, or `inherit`; the `font` shorthand only ever inherits. Stylelint fails anything else, with two exceptions: the Timeline's own scale (below), and a Cover placeholder's initial, which grows with its Cover.

### Spacing

Quarter-rem steps: `--space-1` 0.25, `--space-2` 0.5, `--space-3` 0.75, `--space-4` 1, `--space-6` 1.5 and `--space-8` 2rem. `--gutter` and `--control` sit on top as layout tokens. _To come_ (#570).

### Radius

`--radius-sm` 0.375rem (chips, small buttons), `--radius-md` 0.5rem (controls, fields), `--radius-lg` 0.75rem (Section cards, panels, dialogs), `--radius-full` (pills, round buttons). _To come_ (#571).

### Motion

`--duration-fast` 120ms and `--duration-base` 200ms, with one easing curve. Under `prefers-reduced-motion`, nothing animates. _To come_ (#572).

### Icons

Lucide, everywhere: no Unicode glyphs or hand-drawn SVGs as icons, so icons look the same on every platform. Icon-only buttons keep an accessible name. _To come_ (#573).

### The Timeline's own scale

The Timeline zooms by its own unit, `--timeline-rem`, so its sizes are written as multiples of it (`calc(0.75 * var(--timeline-rem))`). They follow the same scales, in that unit: a font size there is `var(--timeline-rem)` or one of the type scale's steps times it (0.75 to 1.5).

### Components

Named variants for buttons, the icon button, badges, fields, cards, dialogs and menus, and when to use each, are _to come_ (#575).

## Layout tokens

| Token                                  | For                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `--control`                            | The height of a control: touch-sized on narrow windows, compact on wide  |
| `--gutter`                             | The page's side margin                                                   |
| `--rail-width`, `--tabbar-height`      | The navigation: a nav rail on wide windows, a tab bar on narrow ones     |
| `--tabbar-space`, `--nav-bottom-space` | What the tab bar, or the navigation, takes from the bottom of the window |
| `--side-width`, `--side-max-width`     | A desktop side column, such as the Song page's Scrapbook                 |
| `--cover-list`, `--cover-header`       | A Song's Cover in lists and in the Song page header                      |
