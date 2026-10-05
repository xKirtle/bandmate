<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, api } from '../lib/api';
  import { navigate, router } from '../lib/router.svelte';

  // Opened from inside a Folder, the Song goes into it.
  const folderParam = new URLSearchParams(router.search).get('folder');
  const folderId = folderParam && /^\d+$/.test(folderParam) ? Number(folderParam) : null;

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
      const song = await api.importSong(text, title, folderId);
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

<main class="page">
  <h1>Import a Song</h1>
  <form onsubmit={importSong}>
    <label for="lyrics">Lyrics</label>
    <p id="lyrics-hint" class="muted">
      Paste plain text or ChordPro. A line like <code>Chorus:</code> or <code>[Chorus]</code>, or a ChordPro start
      directive, starts a Section with that Label, and a ChordPro end directive ends it; without them the paste is one
      Section. Blank lines stay as blank Lines, and
      <code>[Am]</code> becomes a Chord. Each Section is its own, even when its Lines match an earlier one, and a Label on
      its own is a Duplicate of the last Section with that Label: a copy of its Lines.
    </p>
    <p id="directives-hint" class="muted">
      ChordPro directives fill in the Song: <code>{'{title:}'}</code> or <code>{'{t:}'}</code>
      names it, <code>{'{key:}'}</code>, <code>{'{bpm:}'}</code> or <code>{'{tempo:}'}</code>,
      <code>{'{capo:}'}</code> and <code>{'{tuning:}'}</code> set its Details, once each, and each
      <code>{'{notes:}'}</code> adds a line to its notes. Other directives stay as Lines.
    </p>
    <p id="timestamps-hint" class="muted">
      A timestamp like <code>[1:02]</code> or <code>[1:02.34]</code> at the start of a line cues it, and a timestamp on
      a heading cues the Section's first Line. A timestamp alone on a line is a blank line. One
      <code>{'{offset:}'}</code>
      anywhere, like
      <code>{'{offset: 1.5}'}</code> or <code>{'{offset: -0:02}'}</code>, shifts every Cue that many seconds later, or
      earlier if negative.
    </p>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      id="lyrics"
      bind:value={text}
      required
      autofocus
      rows="16"
      spellcheck="false"
      aria-describedby="lyrics-hint directives-hint timestamps-hint"
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
  /* With no header row, the page keeps clear of a notch itself. */
  .page {
    padding-top: max(var(--gutter), env(safe-area-inset-top));
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
