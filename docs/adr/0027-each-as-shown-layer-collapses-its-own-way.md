# Each As shown layer collapses its own way

**As shown** is one term in the glossary: the Song, its Timeline or its Cues as the page shows them, as saved, with each edit still on its way on top, and any value being adjusted. The browser holds it in five places, and it stays five:

- **The Cue changes**, in Saves: an ordered list of the changes not saved yet, replayed in order over the Song as saved. One leaves the list as its save lands, or is taken back whole if it fails.
- **Timeline editing**: a map keyed by field, e.g. "track 3 volume", where the newest value for a field wins. A shown value stops showing once its save resolves, saved or failed, unless something newer for that field is showing; the whole map is dropped once a refresh has replaced the Song; and each fader keeps its own note of the volume it started from and what showed under it, so a fader let go where it started falls back to the Timeline as saved.
- **A field typed in place**: one string — what's typed, or what's saved formatted — which goes back to what's saved as its save resolves, unless something was typed since, and which stays as typed when the save is refused because the Song changed elsewhere.
- **A Clip dragged**: the Clips held as they were dropped until one particular save resolves. It's scoped to that save, not to a field, and a Gain or a Fade is handed over to Timeline editing on release instead.
- **The Song page's Status and Languages**: what was sent, or else what's saved, in two lines each.

**One hoisted As shown layer is the rejected alternative.** The five are not the same reduce: they differ in what they key on (nothing, a field, a save, the field itself), in when a value stops showing (its save landing, something newer, a refresh, being typed over), and in what they fall back to (what's saved, what showed under, what's saved as formatted). A single layer would have to take the collapse policy as a parameter, and all five would keep their own bookkeeping regardless — the faders' before-and-under, the drag's save, the typed field's parse rule. The abstraction's only content would be "which of five policies", which buys nothing and hides the differences that matter.

What the code buys instead is **names that say which layer they hold**. Plain means As shown: Saves' `song` and Timeline editing's `timeline` are what the page draws, and the components handed the Song as shown take a plainly named prop. The pair as saved carries a `saved` prefix: Saves' `savedSong` and `savedTimeline`, read as a pair wherever a save or a Merge is worked out against what the server holds, and the Song page's locals of the same names. Saves carries a block comment naming all five layers and what each collapses, and each of the other four points back to it.

This has been proposed as one mechanism once, by the 2026-10-18 architecture review, and will be proposed again; the analysis is here so the next review finds it rather than redoing it.
