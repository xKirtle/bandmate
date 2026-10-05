<script lang="ts">
  import Volume1 from '@lucide/svelte/icons/volume-1';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
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
    {#if loudness(volume) === 'muted'}<VolumeX />{:else if loudness(volume) === 'low'}<Volume1 />{:else}<Volume2 />{/if}
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
    font-size: var(--text-xl);
    cursor: pointer;
  }
  .speaker:hover {
    color: var(--text);
  }
  .speaker:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  input[type='range'] {
    width: 5rem;
    min-height: 0;
    padding: 0;
    accent-color: var(--accent);
  }
</style>
