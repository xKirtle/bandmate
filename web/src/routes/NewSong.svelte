<script lang="ts">
  import { api } from '../lib/api';
  import { navigate } from '../lib/router.svelte';

  let title = $state('');
  let error = $state<string | null>(null);
  let saving = $state(false);

  async function create(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = null;
    try {
      const song = await api.createSong(title);
      navigate(`/songs/${song.id}`, { replace: true });
    } catch (e) {
      error = (e as Error).message;
      saving = false;
    }
  }
</script>

<main class="page">
  <h1>New Song</h1>
  <form onsubmit={create}>
    <label for="title">Title</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="title"
      bind:value={title}
      required
      autofocus
      autocomplete="off"
      enterkeyhint="done"
      placeholder="Working title"
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? 'title-error' : undefined}
    />
    {#if error}
      <p id="title-error" class="error" role="alert">{error}</p>
    {/if}
    <button class="button primary" type="submit" disabled={saving}>
      {saving ? 'Creating…' : 'Create Song'}
    </button>
  </form>
</main>

<style>
  /* With no header row, the page keeps clear of a notch itself. */
  .page {
    padding-top: max(var(--gutter), env(safe-area-inset-top));
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    font-weight: 600;
  }
</style>
