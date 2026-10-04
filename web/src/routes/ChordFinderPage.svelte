<script lang="ts">
  // The Chord Finder's own page, standalone: no Song, so standard tuning and
  // no capo.
  import ChordFinder from '../lib/ChordFinder.svelte';
  import { standard } from '../lib/chordFinder';

  const context = { tuning: standard, capo: 0 };
</script>

<header class="bar">
  <h1>Chord Finder</h1>
</header>

<main class="page">
  <p class="muted setup">Standard tuning · No capo</p>
  <ChordFinder {context} />
</main>

<style>
  .setup {
    margin: 0 0 0.75rem;
  }
</style>
