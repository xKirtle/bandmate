<script lang="ts">
  import { canSetVolume, playerVolume } from './sharedVolume.svelte';
  import { loudness } from './volume';

  // Mute and the volume slider for the one volume every player shares, so it
  // can sit inside a player or anywhere beside one.
  const volume = $derived(playerVolume.value);
  const slider = canSetVolume();
</script>

<div class="volume">
  <button
    type="button"
    class="speaker"
    onclick={playerVolume.toggleMute}
    aria-label={volume.muted ? 'Unmute' : 'Mute'}
    aria-pressed={volume.muted}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path class="cone" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      {#if loudness(volume) === 'muted'}
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
      {:else}
        <path d="M15 9a4 4 0 0 1 0 6" />
        {#if loudness(volume) === 'high'}
          <path d="M17.5 6.5a7.5 7.5 0 0 1 0 11" />
        {/if}
      {/if}
    </svg>
  </button>
  {#if slider}
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={volume.muted ? 0 : volume.level}
      oninput={(e) => playerVolume.setLevel(e.currentTarget.valueAsNumber)}
      aria-label="Volume"
      aria-valuetext={volume.muted ? 'Muted' : `${Math.round(volume.level * 100)}%`}
    />
  {/if}
</div>

<style>
  .volume {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .speaker {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .speaker:hover {
    color: var(--text);
  }
  .speaker:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .speaker svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .speaker .cone {
    fill: currentColor;
  }
  input[type='range'] {
    width: 5rem;
    min-height: 0;
    padding: 0;
    accent-color: var(--accent);
  }
</style>
