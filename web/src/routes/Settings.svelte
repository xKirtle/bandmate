<script lang="ts">
  // Settings: choices about this device rather than any Song. For now, how
  // the app looks: its Palette, and Light or Dark or the system's setting.
  // Each applies at once and is kept on this device.
  import { palettes, themeChoices } from '../lib/appearance';
  import { appearance } from '../lib/sharedAppearance.svelte';
</script>

<header class="bar">
  <h1>Settings</h1>
</header>

<main class="page">
  <section class="card" aria-labelledby="appearance-heading">
    <div>
      <h2 id="appearance-heading">Appearance</h2>
      <p class="hint">Kept on this device.</p>
    </div>
    <fieldset class="choice-group">
      <legend>Palette</legend>
      {#each palettes as palette (palette.id)}
        <label class="choice-row">
          <input
            type="radio"
            name="palette"
            checked={appearance.palette === palette.id}
            onchange={() => appearance.setPalette(palette.id)}
          />
          <!-- The Palette's page and accent, in the light or dark shown now. -->
          <span class="swatch" data-palette={palette.id} aria-hidden="true"><span class="accent"></span></span>
          <span>{palette.label}</span>
        </label>
      {/each}
    </fieldset>
    <fieldset class="choice-group">
      <legend>Light or dark</legend>
      {#each themeChoices as choice (choice.id)}
        <label class="choice-row">
          <input
            type="radio"
            name="theme"
            checked={appearance.themeChoice === choice.id}
            onchange={() => appearance.setThemeChoice(choice.id)}
          />
          <span>{choice.label}</span>
        </label>
      {/each}
    </fieldset>
  </section>
</main>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .hint {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* A Palette in small: its page, with its accent on it. */
  .swatch {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 1.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .accent {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
</style>
