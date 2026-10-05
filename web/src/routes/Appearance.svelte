<script lang="ts">
  // Settings' Appearance tab: how the app looks on this device rather than
  // any Song, its Palette, and Light or Dark or the system's setting. Each
  // applies at once and is kept on this device.
  import { palettes, themeChoices } from '../lib/appearance';
  import SettingsPage from '../lib/SettingsPage.svelte';
  import { appearance } from '../lib/sharedAppearance.svelte';
</script>

<SettingsPage tab="appearance">
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
</SettingsPage>

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
  /* A Palette in small, as tall as the radio button beside it: its page,
     with its accent on it. */
  .swatch {
    flex: none;
    display: grid;
    place-items: center;
    width: calc(2 * var(--checkbox));
    height: var(--checkbox);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .accent {
    width: calc(var(--checkbox) / 2);
    height: calc(var(--checkbox) / 2);
    border-radius: var(--radius-full);
    background: var(--accent);
  }
</style>
