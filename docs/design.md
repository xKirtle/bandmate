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
7. **A modifier that gives a gesture another meaning never falls back to the gesture without it.** Where the other meaning doesn't apply, the gesture does nothing: a modifier that redefines a drag here and is ignored there asks for one thing and does another. Where a gesture would apply to only some of what it's used on, that's a sign the thing it acts on is modelled at the wrong level (ADR 0028).

## Foundations

Each foundation lands in its own ticket, which migrates every component onto its tokens and turns on its Stylelint ban in the same PR. A foundation marked _to come_ still has literal values in the components.

### Colour

Colours are named by role, never by hue, so a component reads the same in every Palette and theme. A **Palette** is a full set of them in light and dark, with neutrals tinted towards its accent:

- **Terracotta**, the default: terracotta on warm grey, or on charcoal.
- **Ink**: fountain-pen blue on cream, or blue-black.
- **Olive**: muted green on stone.

The user picks a Palette, and System, Light or Dark, in Settings, kept per device (`appearance.ts`) and falling back to Terracotta and System without storage. The `data-palette` attribute on the root element shows one (`ink` or `olive`; Terracotta when it's absent), and `data-theme` shows `light` or `dark`, set from the system under System; a script in `index.html` sets both before the first paint, so the page never flashes the default. `data-palette` on an element inside the page shows another Palette there, as Settings' swatches do. Light or dark is picked by attribute alone, never `light-dark()`, which breaks every colour on Safari before 17.5. All Clips on the Timeline use the one accent, and the Chosen Track is marked by an accent edge on its header.

| Token                          | For                                                                     |
| ------------------------------ | ----------------------------------------------------------------------- |
| `--bg`                         | The page                                                                |
| `--surface-1`, `--surface-2`   | Cards and panels, then controls and raised areas on them                |
| `--border`                     | Edges. Decorative only: never the only thing that marks a control       |
| `--text`, `--text-muted`       | Text, and secondary text (hints, timestamps, empty states, Labels in Read mode) |
| `--accent`, `--accent-text`    | The primary action, the current or chosen thing, Chords; text on accent |
| `--danger`, `--warning`        | Destructive actions and errors; warnings                                |
| `--drafting-*`, `--finished-*` | The drafting and finished Status badges (`-bg` and `-fg`)               |
| `--shelved-*`                  | The shelved Status badge (`-bg` and `-fg`)                              |
| `--piano-white`, `--piano-black` | A piano's white and black keys in a keyboard drawing, the black also edging every key                           |

Shared by every Palette, the scrim and the only shadows there are:

| Token                | For                                                                        |
| -------------------- | -------------------------------------------------------------------------- |
| `--scrim`            | Dims what's behind a dialog, or outside a Cover's crop                     |
| `--dim`              | Dims the page round a spotlight, the Tour's: darker than `--scrim`, which barely shows on the dark theme |
| `--on-scrim`         | Drawn on the scrim, whatever the theme, e.g. the Cover crop's frame        |
| `--shadow-float`     | Lifts a floating layer (a popover, menu or floating bar) off the page      |
| `--selected-outline` | Rings what's selected, such as a Clip, or what a drop would land on        |
| `--selected-edge`    | Marks the current or chosen row along its left edge, e.g. the Chosen Track |
| `--invalid-outline`  | Rings a field holding an invalid value, inside its danger border           |

A literal colour is written only in `palettes.css`, and a `box-shadow` is always one of these tokens: Stylelint fails anything else. A tint of a token, such as `color-mix(in srgb, var(--accent) 12%, transparent)`, is allowed.

In the light theme a popover is on `--bg`, lifted by `--shadow-float`. In the dark theme, where a shadow barely shows, it's raised onto `--surface-1`, a step lighter than the page, and `--shadow-float` is black there: tinted like the text, it would glow.

**Contrast floor**, in both themes of every Palette: 4.5:1 for all text, 3:1 for controls and anything else that carries meaning, and 7:1 for Lines in Read mode. Chords in Read mode are held to 4.5:1, since Terracotta's accent misses 7:1 and that was accepted. A piano's keys are drawn as a piano's are in every Palette: in the light theme the white keys a step brighter than the page, towards white, and the black keys the Palette's text; in the dark theme the white keys a light grey, so they don't glare, and the black keys darker than the page. They're held to 3:1 against each other, and not against the accent: no accent reaches 3:1 against both key colours in every Palette (Ink's and Olive's light accents miss 3:1 even against pure black). So a pressed key is filled with the accent and also marked with a dot in `--accent-text`, held to 4.5:1 against the accent, and is told by its mark, not by colour alone. `palettes.test.ts` checks every meaningful pair, so a Palette that breaks the floor fails CI.

### Type

The system font everywhere, with no typeface bundled. Content and tools differ by size and line height alone: tools take the small end of the scale, content the larger sizes and the lyric sizes.

| Token          | Size                        | For                                                                                    |
| -------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `--text-xs`    | 0.75rem                     | The smallest labels: badges, navigation labels, Clip labels, hints in pills            |
| `--text-sm`    | 0.8125rem                   | Secondary text in tools: hints, notices, table cells |
| `--text-md`    | 0.875rem                    | Tool text: buttons and fields in toolbars and dialogs, lists, menus                    |
| `--text-lg`    | 1rem                        | Body text, and the headings of cards and panels                                        |
| `--text-xl`    | 1.25rem                     | Dialog titles, icon buttons, larger headings                                           |
| `--text-2xl`   | 1.5rem                      | Page titles, and a Song's title                                                        |
| `--text-field` | `max(var(--text-lg), 16px)` | Text fields: under 16px, iOS zooms in on focus                                         |

Content's line height is `--leading-content` (1.6), for Lines in Write mode and a Song's notes; tools keep the page's 1.5. The lyric sizes, and the Chord Chart's name size, are content's own, separate from the scale so Read mode can be tuned on its own:

| Token                  | For                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `--lyric-write`        | Lines and Chords as typed in Write mode: a text field's size, with `--leading-content` |
| `--lyric-read-line`    | Lines in Read mode                                   |
| `--lyric-read-chord`   | Chords above their Lines in Read mode             |
| `--lyric-read-label`   | A Section's Label in Read mode, bold and muted, at the Chords' size                       |
| `--lyric-read-leading` | The line height of Lines, Chords and Labels in Read mode                          |
| `--lyric-read-section-gap` | The gap between Sections in Read mode: `--space-8`, scaled by the Lyric Size              |
| `--lyric-size`         | The Lyric Size as a fraction, set on the page by Read mode: the Read mode sizes scale by it |
| `--chart-read-name`    | A Chord's name over its diagram in the Chord Chart: `--text-lg`, scaled by the Chart Size |
| `--chart-size`         | The Chart Size as a fraction, set on the page by the Chord Chart: its diagrams and `--chart-read-name` scale by it |
| `--chart-chord`        | A Chord's card in the Chord Chart on the guitar: 6.5rem, scaled by the Chart Size. A piano card is as tall as one |

**Read mode** is read at arm's length, from a phone or a music stand, so its lyric sizes are larger than Write mode's: Lines at 1.25rem and Chords at 1.0625rem on a phone, a step larger again from 40rem wide (a tablet or a desktop), at 1.5rem and 1.25rem. The Lyric Size scales Lines, Chords and Labels together from these, from 50% to 175%, for reading from wherever the device sits; the Chord Chart keeps its own size, the Chart Size: 6.5rem a Chord at 100%, large enough that a Voicing's starting fret (`2fr`) reads at a glance, scaled from 70% (about 4.5rem, below which the starting fret stops reading) to 175% (about 11.4rem), the whole diagram together, starting fret included, and each Chord's name over it with it. Lines are in `--text`, held to 7:1, Chords in the accent, held to 4.5:1, and Labels in `--text-muted`, held to 4.5:1, set as written and bold: they're content too, but step back from the Lines they head. Sections sit `--space-8` apart at 100%, and the Lyric Size scales that gap too, so a smaller size fits more of the Song on screen. Its chrome stays quiet: the Lyric Sheet's heading is for screen readers only, and its choices sit behind one Reading button at its head, which shows only how far the Chords are transposed, as a badge. Beside it, Auto-scroll's toggle starts and pauses the Lyric Sheet scrolling on its own; while it runs, a floating pill sits in the bottom corner, clear of the docked Timeline and the tab bar, and `--space-2` above the toasts there, if any: on `--bg` (`--surface-1` in the dark theme) at `--radius-full`, lifted by `--shadow-float`. It holds Auto-scroll's speed, −, the level in tabular digits and +, then its pause: icon buttons, round and in `--text` rather than muted, as they're the controls there while it runs. The Reading menu's rows run the Lyric Size, Transpose, whether the Chords show, then the Chord Chart's eye and pin, with the Chart Size under them, and last Auto-scroll's speed.

Every time, BPM and Gain uses tabular digits, so numbers don't jitter as they change: through the `.tabular` class, or `font-variant-numeric: tabular-nums` in a component's own rule for it. Number fields have them anyway.

A `font-size` is always one of these tokens, or `inherit`; the `font` shorthand only ever inherits. Stylelint fails anything else, with two exceptions: the Timeline's own scale (below), and a Cover placeholder's initial, which grows with its Cover.

### Spacing

Quarter-rem steps for every gap, padding and margin. Tools take the small steps; content and the space between parts of a page take the larger ones.

| Token       | Size    | For                                                                      |
| ----------- | ------- | ------------------------------------------------------------------------ |
| `--space-1` | 0.25rem | Inside the smallest things: a badge, a table cell, a label and its field |
| `--space-2` | 0.5rem  | Between controls in a row, a field's inner padding, a list's items       |
| `--space-3` | 0.75rem | A control's or menu entry's sides, between groups in a toolbar           |
| `--space-4` | 1rem    | A card's or dialog's padding, between a page's blocks                    |
| `--space-6` | 1.5rem  | Between Sections and larger parts of a page                              |
| `--space-8` | 2rem    | The widest: around an empty state, the page's foot                       |

`--gutter` and `--control` sit on top as layout tokens, and the safe-area insets join in through `max()` and `calc()`. A space that bleeds out, like a highlight past its text, is a step negated: `calc(-1 * var(--space-3))`. A space that squares something with a size, like text centred in a control or an indent past a checkbox, is a `calc()` over that size and the steps, with the size named in a custom property where it's set (`--checkbox`, `--icon-width`).

A gap, padding or margin is never a literal length otherwise, and a step is never scaled, only negated: Stylelint fails both. The two exceptions are a hairline, 1px or less, such as one that squares something with a border, and `1lh`, a line of text's own height. One step is scaled, as content: Read mode's gap between Sections grows and shrinks with the Lyric Size, so a smaller size fits more of the Song on screen. It's scaled once, where `--lyric-read-section-gap` is set with the lyric sizes, and a gap only ever takes that token, so Stylelint still holds every gap to the rule. In the Timeline the steps are in its own unit (below).

### Radius

Four corners, by the kind of thing they round.

| Token           | Size     | For                                                                                    |
| --------------- | -------- | -------------------------------------------------------------------------------------- |
| `--radius-sm`   | 0.375rem | Chips and small buttons: menu entries, Cues, a key in Shortcuts, a table's sort header |
| `--radius-md`   | 0.5rem   | Controls and fields, menus and popovers, notices, a Section's Alternates               |
| `--radius-lg`   | 0.75rem  | Section cards, panels and dialogs: the Scrapbook, the Chord Finder, About's cards      |
| `--radius-full` | 999px    | Pills, badges, round buttons and dots: on a square, a circle                           |

A radius is always one of these tokens, or `0`: Stylelint fails anything else. Two exceptions: a Cover's corners are a share of its size (`calc(var(--size) * 0.18)`), so they grow with it like an app icon's; and a trigger that takes the shape of what it wraps, like the Cover that opens its actions menu, gets it through `--trigger-radius`. In the Timeline the steps are in its own unit (below). A drawing's own corners, such as a barre in a Chord diagram, are part of the drawing and stay in its SVG.

### Motion

Two durations and one curve. Something moves only to explain a change: opening, moving or appearing, never to decorate, and nothing bounces.

| Token             | Value                        | For                                                                           |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `--duration-fast` | 120ms                        | Small things: a chevron turning as a list opens, a scroll bar's thumb growing |
| `--duration-base` | 200ms                        | What moves or appears: the highlight on the current Line or Section           |
| `--ease`          | `cubic-bezier(0.2, 0, 0, 1)` | Every transition and animation: quick to start, settling without overshoot    |

A transition or animation names both, such as `transition: transform var(--duration-fast) var(--ease)`, once for each property it lists, so none falls back on the browser's own curve. A delay, if any, is one of the durations too. Stylelint fails a literal or scaled time, any other duration, and any timing function but `--ease`, including none at all.

**Reduced motion**: when the user asks for it, `app.css` sets both durations to 0s, so every transition and animation ends as it starts. Motion in script asks `motion.ts` instead: following playback down the Lyric Sheet glides there, or jumps under reduced motion. What tracks real time isn't decoration and keeps moving either way: the playhead, a Clip or the Loop being dragged, the Timeline scrolling as it follows playback, a waveform filling as it plays, an input's level meter, and calibration's metronome.

### Icons

[Lucide](https://lucide.dev), everywhere: no Unicode glyphs or hand-drawn SVGs as icons, so icons look the same on every platform and never turn into emoji. The only SVGs drawn by hand are drawings, not icons: Chord diagrams, waveforms, a Clip's Fades, Bandmate's mark, and calibration's metronome.

- **Import each icon on its own**, from `@lucide/svelte/icons/<name>`, never from the package's index, so only the icons used are bundled. `icons.test.ts` fails an import of the whole set, and an inline `<svg>` outside the drawings. It also checks the table below: every imported icon has a row, every row's icon is imported, and no icon is in two rows. An icon passed around, like a menu entry's, is typed `Icon` from `icons.ts`.
- **An icon is as big as the text it's in** (`.lucide-icon` in `app.css` sizes it at `1em`), so its size comes from a font-size token: an icon button's `--text-xl`, or `--text-lg` on desktop, a menu entry's text, a badge's `--text-xs`. To make one bigger than the text beside it, set a font size from the scale on the icon. Don't set a width or height.
- **Outlined**, as Lucide draws them, with one exception: on the accent, or where it's tiny, a play, pause, skip or record icon is solid (`fill: currentColor`), like a Cue's ▶. A filled state, like the Chord Chart's pin while pinned, fills it too.
- **An icon-only button names itself** with `aria-label` (and a `title` where a pointer helps). The icon is hidden from screen readers on its own: Lucide marks it `aria-hidden` unless it's given a name.
- **A glyph that's text stays text**: an ellipsis ending a label ("Rename…"), quotes, dashes, the `·` between details, a minus sign in "−3 dB", the key names in Shortcuts (⌘, ⇧, ←), the × over a muted string in a Chord diagram, and a sentence that names the ⋯ menu.

One icon, one meaning, across the app. Every icon in use is here: a new one is added to this table, and an action that means the same as one here takes its icon.

| Icon                                                          | For                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ellipsis`                                                    | A ⋯ menu of more actions                                                                                                                                                                    |
| `x`                                                           | Close a dialog or dismiss a message; clear one value (a Cue, the Loop, a Shortcut's key); take something out that Undo or the Scrapbook brings back (a Clip, a Track, a Take, a Section from the Lyric Sheet) |
| `trash-2`                                                     | Delete, after asking (a Backup, a Scrapbook Section, an Alternate, a Cover)                                                                                                                 |
| `eraser`                                                      | Clear several at once (a Section's Cues, a Clip's inactive Takes)                                                                                                                           |
| `pencil`                                                      | Rename or edit                                                                                                                                                                              |
| `copy`, `copy-plus`, `scissors`                               | Copy; Duplicate; Cut                                                                                                                                                                        |
| `plus`, `minus`                                               | Add; step a number up or down                                                                                                                                                               |
| `a-arrow-up`, `a-arrow-down`                                  | Make the lyrics larger or smaller (the Lyric Size)                                                                                                                                          |
| `sliders-horizontal`                                          | Reading options, in Read mode                                                                                                                                                               |
| `chevrons-down`                                              | Auto-scroll, in Read mode                                                                                                                                                                   |
| `arrow-up`, `arrow-down`                                      | Move up or down; a column's sort                                                                                                                                                            |
| `chevron-down`, `chevron-up`, `chevron-right`, `chevron-left` | Opens a list, a menu, a fold or the Timeline; steps through Voicings and Snapshots; back in a menu or to a list                                                                             |
| `grip-vertical`                                               | Drag to move                                                                                                                                                                                |
| `arrow-left-right`                                            | Alternates                                                                                                                                                                                  |
| `arrow-right-from-line`                                       | Put back, or move, into the Lyric Sheet                                                                                                                                                     |
| `check`                                                       | The chosen option; has a Master                                                                                                                                                             |
| `play`, `pause`, `skip-back`, `skip-forward`                  | Playback; `pause` also pauses Auto-scroll                                                                                                                                                   |
| `circle`, `square`, `circle-dot`                              | Record; stop recording; Retake                                                                                                                                                              |
| `undo-2`, `redo-2`                                            | Undo; Redo                                                                                                                                                                                  |
| `rotate-ccw`                                                  | Set a value back to where it started (a Clip's Tempo to 100%, its Pitch to 0 semitones)                                                                                                     |
| `upload`, `download`                                          | Import audio; Mix down, or download a Sound, a Take or a Backup                                                                                                                             |
| `archive-restore`                                             | Restore from a Backup                                                                                                                                                                       |
| `history`                                                     | A Song's Snapshots, opened in Write mode                                                                                                                                                    |
| `lock`                                                        | Keep a Scheduled Backup, so it's never deleted automatically; Keep a Snapshot, so it's never thinned                                                                                        |
| `mic`                                                         | The Input recorded from                                                                                                                                                                     |
| `layers`, `move-horizontal`                                   | A Clip's Takes; Nudge a Clip's audio                                                                                                                                                        |
| `diff`                                                        | A Clip's Gain (a ±)                                                                                                                                                                         |
| `gauge`, `piano`                                              | A Clip's Tempo; its Pitch                                                                                                                                                                   |
| `square-split-horizontal`, `merge`                            | Split at playhead; Merge                                                                                                                                                                    |
| `crop`, `refresh-cw`                                          | A Cover: adjust its crop; change its picture                                                                                                                                                |
| `eye`, `eye-off`, `pin`                                       | Show, hide and pin the Chord Chart                                                                                                                                                          |
| `keyboard`                                                    | Keyboard shortcuts                                                                                                                                                                          |
| `volume-2`, `volume-1`, `volume-x`                            | A player's volume: loud, quiet, muted; `volume-2` also hears a Chord strummed                                                                                                               |
| `chart-no-axes-column-increasing`                             | Arpeggiate a Chord: its strings one at a time, low to high                                                                                                                                  |
| `triangle-alert`                                              | A warning, e.g. a Cue out of order                                                                                                                                                          |
| `corner-down-left`                                            | The Enter key, beside Sync mode's Now while Enter cues                                                                                                                                                     |
| `folder`, `folder-plus`, `folder-input`                       | A Folder, where a Song's Cover would be; New folder; Move to folder                                                                                                                         |
| `tag`                                                         | A Song's Tags                                                                                                                                                                               |
| `music`, `disc-3`, `music-4`                                  | The navigation: Songs, Beats, the Chord Finder                                                                                                                                              |
| `settings`                                                    | The navigation, pinned apart: Settings                                                                                                                                                      |

### Brand marks

Bandmate's mark is a guitar pick with a flat, ♭, cut out of it: the B of Bandmate, written as a pen stroke, thin in the stem and heavier in the bowl. It's one even-odd path on a 32-unit square, `markPath` in `brandMark.ts`, so the flat's bowl fills in again inside its cut-out.

- **In the app**, `BrandMark` draws it in the accent, so it follows the Palette and theme: atop the nav rail at `--mark-rail`, and in About at `--mark-large`.
- **The favicon** is the same path in `--accent-text` on a rounded tile of `--accent`, both Terracotta's light values, the default Palette's, since the file is static: `public/favicon.svg`, and `public/favicon.ico` holding it at 16 and 32px for browsers that don't take an SVG. At 32px the flat reads; at 16px it's a hint.
- **The home-screen icon** is `public/apple-touch-icon.png`, 180px: the mark smaller on a square of Terracotta, since iOS takes only a PNG and rounds the corners itself.
- **The README** opens with `public/favicon.svg` itself at 96px, not a copy, so it follows the favicon whenever the mark changes. Its tile carries its own background, so it reads on GitHub's light and dark themes alike.
- **The docs site**, in `docs/web/`, uses `public/favicon.svg` through a symlink, for its logo and favicon alike. Its theme takes Terracotta's light and dark colours and the system font; VitePress picks dark with a class rather than `data-theme`, so its `custom.css` copies the colours from `palettes.css` rather than importing them.
- **The social preview card**, what GitHub shows when the repo's link is shared, is `docs/brand/social-preview.png`, 1280×640: the mark in `--accent-text`, 280px tall, on full-bleed `--accent`, Terracotta's light values, with "Bandmate" beside it at 96px bold and the tagline under it at 36px, softened to 0.9 opacity (4.8:1, above the contrast floor's 4.5:1 for text). The tagline takes a line per sentence, since on one line at 36px it won't fit beside the mark. The mark and the title sit inside a centred 1100×520, so a crop keeps them. Its source is `docs/brand/social-preview.svg` beside it. Its text is set in Adwaita Sans, falling back to Inter or Noto Sans, and rendered once into the PNG; the app still bundles no typeface. Render it where Adwaita Sans is installed, or a fallback shifts the layout. GitHub doesn't read it from the repo: it's uploaded by hand in the repo's Settings → General → Social preview.

`brandMark.test.ts` checks `index.html` declares the three icon files, and that `favicon.svg` draws `markPath` in those two colours. The two raster files are rendered from the SVG: when the mark changes, render the tile at 16, 32 and 180px in a browser and write them again. `brandMark.test.ts` also checks the social preview card's source draws `markPath` in the same two colours, and that its PNG is 1280×640 and under 1 MB. When the mark changes, copy `markPath` into the card's source, render it again from the repo's root, and upload the new PNG:

```sh
chromium --headless --hide-scrollbars --window-size=1280,640 \
  --screenshot=docs/brand/social-preview.png docs/brand/social-preview.svg
```

### The Timeline's own scale

The Timeline zooms by its own unit, `--timeline-rem`, so its sizes are written as multiples of it (`calc(0.75 * var(--timeline-rem))`). They follow the same scales, in that unit: a font size there is `var(--timeline-rem)` or one of the type scale's steps times it (0.75 to 1.5), a gap, padding or margin one of the spacing steps times it (0.25 to 2) or negated, and a radius one of the radius steps times it (0.375 to 0.75), or `--radius-full`.

Docked at the foot of the Song page, the Timeline is drawn at 1.25×, and its Tracks area is resized by dragging its top edge, the height kept on the device. A phone gets 1×, with no room to spare, and its own layout by how it's held:

- **Upright**, up to 40rem wide, the Timeline only plays: the transport row alone, for playing along while reading.
- **Sideways**, any landscape window under 30rem tall (a short desktop window too), it's **the full-screen Timeline**, in Read mode and Write mode alike: it fills the window, over the Song page and the navigation, which wait behind it as they were. It can't be collapsed or resized: its Tracks take all the height below the transport row, which stays on one line, a message in it cut short with "…". The height kept on the device is left for elsewhere, and the safe-area insets are kept clear on every side.

### Components

The recurring components are written once, and a screen reaches for them rather than drawing its own. Where only the look repeats, on a native element, it's a class in `app.css`; where markup repeats too, it's a component in `web/src/lib`. A component's own styles add only what's particular to it, such as its width or its place in a row. `components.test.ts` fails a modal dialog that isn't a `Dialog`, and a fold whose chevron isn't a `FoldChevron`.

**Buttons** are `.button`, with a variant beside it:

| Variant   | Class                    | For                                                                                                |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Primary   | `.button.primary`        | The one action a dialog or form is for: Save, Back up, Restore. At most one in a group             |
| Secondary | `.button`                | Every other action: Cancel, Back, Clear all Cues. Also a link, or a `<label>` round a file input, which takes `.disabled` while it can't be used |
| Quiet     | `.button.quiet`          | A light action beside a list or a fact, in accent text with no box: Choose all, Clear, About's Update to a newer yt-dlp |
| Danger    | `.button.danger`         | Deletes or overwrites, after asking: Delete, Replace and restore. Primary's place when it's the one |
| Toggle    | `.button.toggle`         | On or off, with `aria-pressed`: filled with the accent while on, e.g. Sync lyrics, Rhymes          |

A disabled button fades; a disabled quiet one turns muted instead. Under a pointer that can hover, a button or chip shifts a little from its own colour, fading over `--duration-fast`: a box rises to `--surface-2`, the accent (primary, a toggle that's on, a picked chip) and a quiet button's text lean towards `--text`, and danger takes a faint tint of `--danger`. A field drawn by script that opens something, `.field-box` (a `Picker`'s, the Languages field's), rises the same way, and so does the Song page's Write/Read switch, whose side not chosen rises only halfway to the chosen side's `--surface-2`, so it never looks chosen. A disabled one doesn't react, and a touch screen never sees it, so a tap leaves nothing behind.

**The icon button**, `.icon`, is a square of `--control` showing one Lucide icon at `--text-xl` (`--text-lg` on desktop), muted and boxless until a pointer that can hover is over it, so a tap on a touch screen leaves no box behind. It's for an action an icon says on its own, such as a dialog's close or a Section's ⋯, and always has an `aria-label`. One that's on or off, such as a Snapshot's Keep, has `aria-pressed` and shows its icon in the accent while on. The Timeline's own buttons are in its scale instead.

**The previewed Beat's preview button** is the one icon button drawn on the accent. In lists with no waveform to tell the previewed Beat by, the Beat Library's table, its staged rows and the Beat Picker (`BeatPreviewButton`), the previewed Beat's preview button is a circle of `--accent` (`--radius-full`) with its icon solid in `--accent-text`, a small version of the round play button on the Library's cards, and its row has `aria-current`. It stays while the Beat is paused, until another Beat is previewed or the preview is put away. It marks the previewed Beat, and isn't a pressed style for icon buttons: one that's on still shows its icon in the accent. The Picker's preview buttons show their icons in the accent while idle.

**Chips and badges** are both pills. A **chip**, `.chip`, is a toggle among others, with `aria-pressed`, such as the Song list's Has a Master; or, with `aria-expanded`, a status that opens its row, such as an Input's Latency Offset in the Input list (`InputList`). A **filter button**, `FilterButton`, is a chip in a list page's filter bar, `.filter-bar`, on the Songs page, the Beat Library and the Beat Picker, that opens what its filter is picked with, such as a checklist, in a popover under it, and names what's picked (`Status: Idea, Drafting`), filled like a toggle that's on once anything is. A **badge**, `.badge`, labels something and does nothing itself, at `--text-xs`: a Song's Status (`StatusBadge`), a Song's Tag, a release note's kind on About, a Scheduled Backup's Scheduled in Settings' Backups, a Shortcut's New in Settings' Shortcuts tab, filled with the accent, or Transpose on the Reading button. Its colours are its own, from the Status tokens or a tint. A Tag, `.badge.tag`, has one muted style and no colours, outlined so it isn't taken for an Idea's Status: `TagChips` shows a Song's Tags, wrapping, `TagLine` shows them on one line in the Songs table, as many as fit and then a "+N" badge whose tooltip names the rest, and `TagsField` changes them, each Tag with an `x` to take it off and a `Combobox` to add one.

**Fields** are the native `input`, `textarea` and `select`, styled in `app.css` at `--text-field`. A field's name goes above it with `.field` on its `<label>` (or `<fieldset>`), muted at `--text-sm`; the Song page's Details take theirs a step smaller. A `Combobox` or `Picker` is a field with a list; a field drawn by script, like a `Picker`'s, takes `.field-box` to look like the native ones. Checkboxes and radio buttons are `.choice-row` labels in a `.choice-group` fieldset, each a touch target tall, with what's under one (its note, a `PickList`) in `.choice-under`, lined up with its label; `--checkbox` sizes them.

**Cards** are flat: `.card` is a `--surface-1` panel with a border and `--radius-lg`, on the page, never floating. It holds a Section, the Chord Finder, This device's and About's sections, the Shortcuts tab's groups, Settings' Scheduled Backups and Backups (its header holding Upload and New Backup, its rows divided inside it), and the Beat Library's add and batch forms. Two relatives aren't cards: the Scrapbook is a dashed outline with no fill, since Sections are dropped into it, and its Sections are cards inside it; and on desktop the Song page's side parts are cards: its Rhymes, in Rhyme mode, a card that folds, and in Write mode the Scrapbook and the Masters, one card with a tab each, the tabs where a card's toggle would be; in Read mode the Masters are a card that folds. Narrower than that, Rhymes don't show.

**Tabs** are a `.tabs` row over what they switch between, each tab muted until it's chosen, then underlined in the accent and in `--text`; under a pointer that can hover, a tab not chosen brightens to `--text` over an underline in `--border`. They're buttons in a tablist (`role="tab"`, `aria-selected`) where switching stays on the page, like the Chord Finder's, About's, the Rhymes card's Languages and the Song page's Scrapbook and Masters, and links (`aria-current="page"`) where each tab has its own address, like Settings' This device, Shortcuts, Backups and About. A component adds only where the row sits, such as its border or a phone's tighter tabs. `components.test.ts` fails a component that styles `[role='tab']` itself.

**Folds** are a `<details>` whose `<summary>` starts with `FoldChevron`, which turns from pointing right to down as it opens. `app.css` takes away the browser's own marker and rings a focused summary. About's release notes and dependency lists fold, as does each Shortcut in Settings' Shortcuts tab, and on desktop so do the Song page's side parts. Open, a keyboard Shortcut's fold lists its keys to change (`KeysEditor`): each a button in a 12% tint of the accent, edged in a 40% one, at `--radius-sm`, with an `x` to take it off, then a dashed Add key, and a two-way Shortcut's Back and Forward keys on a row each, their labels one width. A key waiting to be pressed deepens to a 24% tint and reads "Press a key…", and a refusal is a line of `--danger` text under the keys. A mouse Shortcut's fold reads "Hold Ctrl Alt Shift and drag" instead, each modifier a `.button.toggle`; the plain drag that selects with a box shows its gesture as a key, with a muted "Can't be changed".

**Dialogs** are `Dialog`: a modal `<dialog>`, opened as it mounts, over `--scrim`, with its title and a close button at its head and what it holds stacked beneath, `--space-3` apart. It's for a task that stops the page: New Backup, Restore, Mix down, editing a Beat. Its close button can be disabled or hidden while closing would lose work, and a click on the backdrop closes it only when its `dismissible` says nothing would be lost. It's 28rem wide unless the caller sets `--dialog-width`, and `--dialog-max-height`, `--dialog-height` and `--dialog-gap` likewise. With `fill`, what it holds takes all the height its head leaves, for parts that scroll on their own, like the Snapshots dialog's list and Snapshot. A **sheet** is a dialog that takes the whole screen on a phone, for one with a lot to hold, like editing a Beat or cropping a Cover. The Snapshots dialog sets the chosen Snapshot beside the Song as it is now, Then | Now (`ThenAndNow`): two columns, each row's Lines lined up, a Line that differs marked on each side with a 12% tint of the accent and a 2px accent edge, as what a restore would change. Under 44rem of the preview's own width, a container query rather than the window's, too narrow for two readable columns of Lines, the columns become two tabs.

**Menus and popovers** float: `.popover` is a layer in the top layer, placed by script beside what opened it (`popover.ts`) and kept there as the page scrolls or the window resizes (`following`), with a border, `--radius-md` and `--shadow-float`. A **menu** is `ActionsMenu`, a ⋯ of actions, each entry `--radius-sm` with its icon in a column. The Timeline's transport row shows its occasional actions, Import audio, Mix down and the mic button, as icon buttons, and folds them into a ⋯ only where the row is too narrow for them, the mic last (`transportMenu.ts`). On a phone, a Backup's Restore and Download fold into its ⋯ too, Download still a link that downloads it. The others are the list a `Combobox` or `Picker` opens (`.option-list`), a Chord's diagram (`ChordPopover`), the Timeline's mic button's Inputs to record from (`InputPicker`), a Song's Languages to tick and order (`LanguagesField`), the Reading menu (`ReadingMenu`), Read mode's choices about how a Song reads, behind one button at the end of the Lyric Sheet's header, and in Write mode, in the same place, the Cues menu (`CuesMenu`), shifting and clearing every Cue, kept apart from the Rhymes and Sync lyrics toggles beside it so the modes read as modes. A filter button's checklist is a popover too. A popover is for a quick choice or a glance that doesn't stop the page; what needs the page to wait is a dialog.

**Toasts** are where a refused save says so: `Toasts`, one stack fixed in the bottom corner of the window, inset by `--gutter`, and lifted `--space-4` clear of the docked Timeline and the tab bar (`--nav-bottom-space`); where a sideways phone's Timeline fills the window, it sits over the Timeline instead. Each toast is a row on `--bg`, edged in `--danger` at `--radius-md` and lifted by `--shadow-float`, holding the surface it came from in `--text-muted`, the message in `--danger`, and an `x` to dismiss it, all at `--text-sm`; it's a `role="alert"`, and it appears over `--duration-base`, which is the only thing it animates. The stack is the Song page's, for the four surfaces a save can be refused on — the Details, the Timeline, the Cues and the Lyric Sheet — one toast each, so four at most, inside a bounded height that scrolls rather than growing down the page ([ADR 0029](adr/0029-a-refused-save-shows-in-one-toast-stack.md)). A toast is never on a timer: it stays until that surface's own next save lands or it's dismissed, because it may be the only record that an edit was taken back. A problem the Timeline works out for itself, such as an audio file it can't take, is the Timeline's toast too, and also goes once the action that raised it is started again. Two things that look like toasts aren't: the Lyric Sheet's **notice**, a muted `role="status"` line in its header that clears itself after five seconds, says what a Section move just did, which is on the screen already; and the Song page's **"changed elsewhere" banner**, a block in the flow with a paragraph and a Reload, which is a standing state rather than something that has passed. An error that belongs against the field or card that raised it stays there, a `.error` line in the flow, as a Latency Offset typed wrong does: the stack is for a refusal with nowhere near the edit to live.

**The Tour's spotlight** (`TourSpotlight`) dims the page with `--dim` but for a cut-out `--space-2` round one control, ringed in a 2px accent edge at `--radius-md`. Its card is a popover at `--radius-lg`, beside the control, or over or under a full-width one like the Timeline: the step's count with its dots, the current one a wider accent pill, then its title at `--text-xl`, its text, and End tour (quiet), Back and Next (primary).

## Layout tokens

| Token                                  | For                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `--control`                            | The height of a control: touch-sized on narrow windows, compact on wide  |
| `--gutter`                             | The page's side margin                                                   |
| `--rail-width`, `--tabbar-height`      | The navigation: a nav rail on wide windows, a tab bar on narrow ones     |
| `--tabbar-space`, `--nav-bottom-space` | What the tab bar, or the navigation, takes from the bottom of the window |
| `--side-width`, `--side-max-width`     | A desktop side column, such as the Song page's Scrapbook                 |
| `--settings-max-width`                 | The widest a Settings tab's content grows, the same for every tab        |
| `--cover-list`, `--cover-header`       | A Song's Cover in lists and in the Song page header                      |
| `--checkbox`                           | A checkbox or radio button, a touch bigger than the browser draws it     |
| `--mark-rail`, `--mark-large`          | Bandmate's mark: atop the nav rail, and in About                         |
| `--cue-slot`, `--cue-button`           | A Cue's slot in the gutter, wide enough for "⚠ 12:34.5"; its ▶ or ✕      |
| `--metronome`                          | The height of calibration's metronome                                    |
| `--piano-key-narrowest`, `--piano-key-widest`, `--piano-white-keys` | A white key in a keyboard drawing, 1 wide to 4.5 tall: it grows with the room up to the widest, and the Chord Finder fits as many piano cards a row as a keyboard at the narrowest allows; and how many white keys a drawing has, 15 from C3 to C5. The Chord Chart's keyboards are the exception: they draw only the octaves its Chords press, each key as wide as makes the keyboard as tall as a guitar diagram at the Chart Size, narrower than the narrowest at a small one |
