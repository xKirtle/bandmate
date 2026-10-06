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

Shared by every Palette, the scrim and the only shadows there are:

| Token                | For                                                                        |
| -------------------- | -------------------------------------------------------------------------- |
| `--scrim`            | Dims what's behind a dialog, or outside a Cover's crop                     |
| `--on-scrim`         | Drawn on the scrim, whatever the theme, e.g. the Cover crop's frame        |
| `--shadow-float`     | Lifts a floating layer (a popover, menu or floating bar) off the page      |
| `--selected-outline` | Rings what's selected, such as a Clip, or what a drop would land on        |
| `--selected-edge`    | Marks the current or chosen row along its left edge, e.g. the Chosen Track |
| `--invalid-outline`  | Rings a field holding an invalid value, inside its danger border           |

A literal colour is written only in `palettes.css`, and a `box-shadow` is always one of these tokens: Stylelint fails anything else. A tint of a token, such as `color-mix(in srgb, var(--accent) 12%, transparent)`, is allowed.

**Contrast floor**, in both themes of every Palette: 4.5:1 for all text, 3:1 for controls and anything else that carries meaning, and 7:1 for Lines in Read mode. Chords in Read mode are held to 4.5:1, since Terracotta's accent misses 7:1 and that was accepted. `palettes.test.ts` checks every meaningful pair, so a Palette that breaks the floor fails CI.

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

Content's line height is `--leading-content` (1.6), for Lines in Write mode and a Song's notes; tools keep the page's 1.5. The lyric sizes are content's own, separate from the scale so Read mode can be tuned on its own:

| Token                  | For                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `--lyric-write`        | Lines and Chords as typed in Write mode: a text field's size, with `--leading-content` |
| `--lyric-read-line`    | Lines in Read mode                                   |
| `--lyric-read-chord`   | Chords above their Lines in Read mode             |
| `--lyric-read-label`   | A Section's Label in Read mode, bold and muted, at the Chords' size                       |
| `--lyric-read-leading` | The line height of Lines, Chords and Labels in Read mode                          |

**Read mode** is read at arm's length, from a phone or a music stand, so its lyric sizes are larger than Write mode's: Lines at 1.25rem and Chords at 1.0625rem on a phone, a step larger again from 40rem wide (a tablet, a phone held sideways, or a desktop), at 1.5rem and 1.25rem. Lines are in `--text`, held to 7:1, Chords in the accent, held to 4.5:1, and Labels in `--text-muted`, held to 4.5:1, set as written and bold: they're content too, but step back from the Lines they head. Sections sit `--space-8` apart. Its chrome stays quiet: the Lyric Sheet's heading is for screen readers only, and the Chords toggle, when on, is outlined and lettered in the accent rather than filled, so it doesn't compete with the Chords drawn in the accent beside it.

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

A gap, padding or margin is never a literal length otherwise, and a step is never scaled, only negated: Stylelint fails both. The two exceptions are a hairline, 1px or less, such as one that squares something with a border, and `1lh`, a line of text's own height. In the Timeline the steps are in its own unit (below).

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

**Reduced motion**: when the user asks for it, `app.css` sets both durations to 0s, so every transition and animation ends as it starts. Motion in script asks `motion.ts` instead: following playback down the Lyric Sheet glides there, or jumps under reduced motion. What tracks real time isn't decoration and keeps moving either way: the playhead, a Clip or the Loop being dragged, the Timeline scrolling as it follows playback, a waveform filling as it plays, and an input's level meter.

### Icons

[Lucide](https://lucide.dev), everywhere: no Unicode glyphs or hand-drawn SVGs as icons, so icons look the same on every platform and never turn into emoji. The only SVGs drawn by hand are drawings, not icons: Chord diagrams, waveforms, a Clip's Fades, and Bandmate's mark.

- **Import each icon on its own**, from `@lucide/svelte/icons/<name>`, never from the package's index, so only the icons used are bundled. `icons.test.ts` fails an import of the whole set, and an inline `<svg>` outside the drawings. An icon passed around, like a menu entry's, is typed `Icon` from `icons.ts`.
- **An icon is as big as the text it's in** (`.lucide-icon` in `app.css` sizes it at `1em`), so its size comes from a font-size token: an icon button's `--text-xl`, or `--text-lg` on desktop, a menu entry's text, a badge's `--text-xs`. To make one bigger than the text beside it, set a font size from the scale on the icon. Don't set a width or height.
- **Outlined**, as Lucide draws them, with one exception: on the accent, or where it's tiny, a play, pause, skip or record icon is solid (`fill: currentColor`), like a Cue's ▶. A filled state, like the Chord Chart's pin while pinned, fills it too.
- **An icon-only button names itself** with `aria-label` (and a `title` where a pointer helps). The icon is hidden from screen readers on its own: Lucide marks it `aria-hidden` unless it's given a name.
- **A glyph that's text stays text**: an ellipsis ending a label ("Rename…"), quotes, dashes, the `·` between details, a minus sign in "−3 dB", the key names in Shortcuts (⌘, ⇧, ←), the × over a muted string in a Chord diagram, and a sentence that names the ⋯ menu.

One icon, one meaning, across the app. Every icon in use is here: a new one is added to this table, and an action that means the same as one here takes its icon.

| Icon                                           | For                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ellipsis`                                     | A ⋯ menu of more actions                                                                                                                                                                    |
| `x`                                            | Close a dialog or dismiss a message; clear one value (a Cue, the Loop); take something out that Undo or the Scrapbook brings back (a Clip, a Track, a Take, a Section from the Lyric Sheet) |
| `trash-2`                                      | Delete for good, after asking (a Backup, a Scrapbook Section, an Alternate, a Cover)                                                                                                        |
| `eraser`                                       | Clear several at once (a Section's Cues, a Clip's inactive Takes)                                                                                                                           |
| `pencil`                                       | Rename or edit                                                                                                                                                                              |
| `copy`, `copy-plus`, `scissors`                | Copy; Duplicate; Cut                                                                                                                                                                        |
| `plus`, `minus`                                | Add; step a number up or down                                                                                                                                                               |
| `arrow-up`, `arrow-down`                       | Move up or down; a column's sort                                                                                                                                                            |
| `chevron-down`, `-up`, `-right`, `-left`       | Opens a list, a fold or the Timeline; steps through Voicings; back in a menu                                                                                                                |
| `grip-vertical`                                | Drag to move                                                                                                                                                                                |
| `arrow-left-right`                             | Alternates                                                                                                                                                                                  |
| `arrow-right-from-line`                        | Put back, or move, into the Lyric Sheet                                                                                                                                                     |
| `check`                                        | The chosen option; has a Master                                                                                                                                                             |
| `play`, `pause`, `skip-back`, `skip-forward`   | Playback                                                                                                                                                                                    |
| `circle`, `square`, `circle-dot`               | Record; stop recording; Retake                                                                                                                                                              |
| `undo-2`, `redo-2`                             | Undo; Redo                                                                                                                                                                                  |
| `upload`, `download`                           | Import audio; Mix down, or download a Sound or Take                                                                                                                                         |
| `mic`                                          | Recording settings                                                                                                                                                                          |
| `layers`, `move-horizontal`                    | A Clip's Takes; Nudge a Take                                                                                                                                                                |
| `diff`                                         | A Clip's Gain (a ±)                                                                                                                                                                         |
| `square-split-horizontal`, `merge`             | Split at playhead; Merge                                                                                                                                                                    |
| `crop`, `refresh-cw`                           | A Cover: adjust its crop; change its picture                                                                                                                                                |
| `eye`, `eye-off`, `pin`                        | Show, hide and pin the Chord Chart                                                                                                                                                          |
| `keyboard`                                     | Keyboard shortcuts                                                                                                                                                                          |
| `volume-2`, `volume-1`, `volume-x`             | A player's volume: loud, quiet, muted                                                                                                                                                       |
| `triangle-alert`                               | A warning, e.g. a Cue out of order                                                                                                                                                          |
| `corner-down-left`                             | The Enter key, beside Sync mode's Now                                                                                                                                                       |
| `folder`, `folder-plus`, `folder-input`        | A Folder, where a Song's Cover would be; New folder; Move to folder                                                                                                                         |
| `tag`                                          | A Song's Tags                                                                                                                                                                               |
| `music`, `disc-3`, `guitar`                    | The navigation: Songs, Beats, the Chord Finder                                                                                                                                              |
| `settings`                                     | The navigation, pinned apart: Settings                                                                                                                                                      |

### Brand marks

Bandmate's mark is a guitar pick with a flat, ♭, cut out of it: the B of Bandmate, written as a pen stroke, thin in the stem and heavier in the bowl. It's one even-odd path on a 32-unit square, `markPath` in `brandMark.ts`, so the flat's bowl fills in again inside its cut-out.

- **In the app**, `BrandMark` draws it in the accent, so it follows the Palette and theme: atop the nav rail at `--mark-rail`, and in About at `--mark-large`.
- **The favicon** is the same path in `--accent-text` on a rounded tile of `--accent`, both Terracotta's light values, the default Palette's, since the file is static: `public/favicon.svg`, and `public/favicon.ico` holding it at 16 and 32px for browsers that don't take an SVG. At 32px the flat reads; at 16px it's a hint.
- **The home-screen icon** is `public/apple-touch-icon.png`, 180px: the mark smaller on a square of Terracotta, since iOS takes only a PNG and rounds the corners itself.
- **The README** opens with `public/favicon.svg` itself at 96px, not a copy, so it follows the favicon whenever the mark changes. Its tile carries its own background, so it reads on GitHub's light and dark themes alike.
- **The social preview card**, what GitHub shows when the repo's link is shared, is `docs/brand/social-preview.png`, 1280×640: the mark in `--accent-text`, 280px tall, on full-bleed `--accent`, Terracotta's light values, with "Bandmate" beside it at 96px bold and the tagline under it at 36px, softened to 0.9 opacity (4.8:1, above the contrast floor's 4.5:1 for text). The tagline takes a line per sentence, since on one line at 36px it won't fit beside the mark. The mark and the title sit inside a centred 1100×520, so a crop keeps them. Its source is `docs/brand/social-preview.svg` beside it. Its text is set in Adwaita Sans, falling back to Inter or Noto Sans, and rendered once into the PNG; the app still bundles no typeface. Render it where Adwaita Sans is installed, or a fallback shifts the layout. GitHub doesn't read it from the repo: it's uploaded by hand in the repo's Settings → General → Social preview.

`brandMark.test.ts` checks `index.html` declares the three icon files, and that `favicon.svg` draws `markPath` in those two colours. The two raster files are rendered from the SVG: when the mark changes, render the tile at 16, 32 and 180px in a browser and write them again. `brandMark.test.ts` also checks the social preview card's source draws `markPath` in the same two colours, and that its PNG is 1280×640 and under 1 MB. When the mark changes, copy `markPath` into the card's source, render it again from the repo's root, and upload the new PNG:

```sh
chromium --headless --hide-scrollbars --window-size=1280,640 \
  --screenshot=docs/brand/social-preview.png docs/brand/social-preview.svg
```

### The Timeline's own scale

The Timeline zooms by its own unit, `--timeline-rem`, so its sizes are written as multiples of it (`calc(0.75 * var(--timeline-rem))`). They follow the same scales, in that unit: a font size there is `var(--timeline-rem)` or one of the type scale's steps times it (0.75 to 1.5), a gap, padding or margin one of the spacing steps times it (0.25 to 2) or negated, and a radius one of the radius steps times it (0.375 to 0.75), or `--radius-full`.

### Components

The recurring components are written once, and a screen reaches for them rather than drawing its own. Where only the look repeats, on a native element, it's a class in `app.css`; where markup repeats too, it's a component in `web/src/lib`. A component's own styles add only what's particular to it, such as its width or its place in a row. `components.test.ts` fails a modal dialog that isn't a `Dialog`, and a fold whose chevron isn't a `FoldChevron`.

**Buttons** are `.button`, with a variant beside it:

| Variant   | Class                    | For                                                                                                |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Primary   | `.button.primary`        | The one action a dialog or form is for: Save, Back up, Restore. At most one in a group             |
| Secondary | `.button`                | Every other action: Cancel, Back, Clear all Cues. Also a link, or a `<label>` round a file input, which takes `.disabled` while it can't be used |
| Quiet     | `.button.quiet`          | A light action beside a list, in accent text with no box: Choose all, Clear                        |
| Danger    | `.button.danger`         | Deletes or overwrites, after asking: Delete, Replace and restore. Primary's place when it's the one |
| Toggle    | `.button.toggle`         | On or off, with `aria-pressed`: filled with the accent while on, e.g. Sync lyrics, Left-handed     |
| Outlined  | `.toggle.outlined`       | A toggle beside something already in the accent: outlined and lettered in it while on, not filled  |

An outlined toggle is for one that would otherwise compete, like Read mode's Chords toggle beside the Chords, or the Chord Chart's eye and pin. A disabled button fades; a disabled quiet one turns muted instead.

**The icon button**, `.icon`, is a square of `--control` showing one Lucide icon at `--text-xl` (`--text-lg` on desktop), muted and boxless until it's hovered. It's for an action an icon says on its own, such as a dialog's close, a Section's ⋯ or Undo, and always has an `aria-label`. The Timeline's own buttons are in its scale instead.

**Chips and badges** are both pills. A **chip**, `.chip`, is a toggle among others, with `aria-pressed`, such as the Song list's Has a Master. A **filter button**, `FilterButton`, is a chip in a list page's filter bar, `.filter-bar`, on the Songs page, the Beat Library and the Beat Picker, that opens what its filter is picked with, such as a checklist, in a popover under it, and names what's picked (`Status: Idea, Drafting`), filled like a toggle that's on once anything is. A **badge**, `.badge`, labels something and does nothing itself, at `--text-xs`: a Song's Status (`StatusBadge`), a Song's Tag, or a release note's kind on About. Its colours are its own, from the Status tokens or a tint. A Tag, `.badge.tag`, has one muted style and no colours, outlined so it isn't taken for an Idea's Status: `TagChips` shows a Song's Tags, and `TagsField` changes them, each Tag with an `x` to take it off and a `Combobox` to add one.

**Fields** are the native `input`, `textarea` and `select`, styled in `app.css` at `--text-field`. A field's name goes above it with `.field` on its `<label>` (or `<fieldset>`), muted at `--text-sm`; the Song page's Details take theirs a step smaller. A `Combobox` or `Picker` is a field with a list. Checkboxes and radio buttons are `.choice-row` labels in a `.choice-group` fieldset, each a touch target tall, with what's under one (its note, a `PickList`) in `.choice-under`, lined up with its label; `--checkbox` sizes them.

**Cards** are flat: `.card` is a `--surface-1` panel with a border and `--radius-lg`, on the page, never floating. It holds a Section, the Chord Finder, About's sections, and the Beat Library's add and batch forms. Two relatives aren't cards: the Scrapbook is a dashed outline with no fill, since Sections are dropped into it, and its Sections are cards inside it; and on desktop the Song page's side parts, its Masters and the Scrapbook, are each a card that folds.

**Tabs** are a `.tabs` row over what they switch between, each tab muted until it's chosen, then underlined in the accent and in `--text`. They're buttons in a tablist (`role="tab"`, `aria-selected`) where switching stays on the page, like the Chord Finder's and About's, and links (`aria-current="page"`) where each tab has its own address, like Settings' Appearance, Backups and About. A component adds only where the row sits, such as its border or a phone's tighter tabs. `components.test.ts` fails a component that styles `[role='tab']` itself.

**Folds** are a `<details>` whose `<summary>` starts with `FoldChevron`, which turns from pointing right to down as it opens. `app.css` takes away the browser's own marker and rings a focused summary. About's release notes and dependency lists fold, and on desktop so do the Song page's side parts.

**Dialogs** are `Dialog`: a modal `<dialog>`, opened as it mounts, over `--scrim`, with its title and a close button at its head and what it holds stacked beneath, `--space-3` apart. It's for a task that stops the page: New Backup, Restore, Mix down, editing a Beat. Its close button can be disabled or hidden while closing would lose work, and a click on the backdrop closes it only when its `dismissible` says nothing would be lost. It's 28rem wide unless the caller sets `--dialog-width`, and `--dialog-max-height`, `--dialog-height` and `--dialog-gap` likewise. A **sheet** is a dialog that takes the whole screen on a phone, for one with a lot to hold, like editing a Beat or cropping a Cover.

**Menus and popovers** float: `.popover` is a layer in the top layer, placed by script beside what opened it (`popover.ts`), with a border, `--radius-md` and `--shadow-float`. A **menu** is `ActionsMenu`, a ⋯ of actions, each entry `--radius-sm` with its icon in a column. The others are the list a `Combobox` or `Picker` opens (`.option-list`), a Chord's diagram (`ChordPopover`) and Recording settings (`InputSettings`). A filter button's checklist is a popover too. A popover is for a quick choice or a glance that doesn't stop the page; what needs the page to wait is a dialog.

## Layout tokens

| Token                                  | For                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `--control`                            | The height of a control: touch-sized on narrow windows, compact on wide  |
| `--gutter`                             | The page's side margin                                                   |
| `--rail-width`, `--tabbar-height`      | The navigation: a nav rail on wide windows, a tab bar on narrow ones     |
| `--tabbar-space`, `--nav-bottom-space` | What the tab bar, or the navigation, takes from the bottom of the window |
| `--side-width`, `--side-max-width`     | A desktop side column, such as the Song page's Scrapbook                 |
| `--cover-list`, `--cover-header`       | A Song's Cover in lists and in the Song page header                      |
| `--checkbox`                           | A checkbox or radio button, a touch bigger than the browser draws it     |
| `--mark-rail`, `--mark-large`          | Bandmate's mark: atop the nav rail, and in About                         |
