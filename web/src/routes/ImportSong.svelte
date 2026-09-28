<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, api } from '../lib/api';
  import { navigate } from '../lib/router.svelte';

  let text = $state('');
  let title = $state('');
  // The title is only asked for once the server says the text doesn't name
  // the Song, so the parsing stays on the server. The API tests pin that
  // message.
  let askTitle = $state(false);
  let titleInput = $state<HTMLInputElement>();
  let error = $state<string | null>(null);
  let saving = $state(false);

  async function importSong(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    error = null;
    try {
      const song = await api.importSong(text, title);
      navigate(`/songs/${song.id}`, { replace: true });
    } catch (e) {
      error = (e as Error).message;
      saving = false;
      if (e instanceof ApiError && e.status === 400 && e.message.startsWith('title is required')) {
        askTitle = true;
        await tick();
        titleInput?.focus();
      }
    }
  }
</script>

<header class="bar">
  <a class="back" href="/">← Songs</a>
</header>

<main class="page">
  <h1>Import a Song</h1>
  <form onsubmit={importSong}>
    <label for="lyrics">Lyrics</label>
    <p id="lyrics-hint" class="muted">
      Paste plain text or ChordPro. A line like <code>Chorus:</code> or <code>[Chorus]</code>, or a
      ChordPro start directive, starts a Section with that Label, and a ChordPro end directive ends
      it; without them the paste is one Section. Blank lines stay as blank Lines, and
      <code>[Am]</code> becomes a Chord. Repeated Sections with the same Label are shared, and a
      Label on its own repeats the last Section with that Label.
    </p>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      id="lyrics"
      bind:value={text}
      required
      autofocus
      rows="16"
      spellcheck="false"
      aria-describedby="lyrics-hint"
      placeholder={'{title: Midnight Drive}\n\n[Verse]\n[Am]City lights are [F]calling\n\n[Am]Me home [F]tonight\n\n[Chorus]\n…'}
    ></textarea>
    {#if askTitle}
      <label for="title">Title</label>
      <input
        id="title"
        bind:this={titleInput}
        bind:value={title}
        required
        autocomplete="off"
        enterkeyhint="done"
        placeholder="The text has no {'{title: …}'} line, so name the Song"
        aria-invalid={error && !title.trim() ? 'true' : undefined}
        aria-describedby={error ? 'import-error' : undefined}
      />
    {/if}
    {#if error}
      <p id="import-error" class="error" role="alert">{error}</p>
    {/if}
    <button class="button primary" type="submit" disabled={saving}>
      {saving ? 'Importing…' : 'Import Song'}
    </button>
  </form>
</main>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  textarea {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
</style>
