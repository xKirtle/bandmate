<script lang="ts">
  import { api } from './api';
  import { languages } from './languages';
  import { rhymingDictionaries as dictionaries } from './sharedRhymingDictionaries.svelte';
  import { formatSmallSize } from './upload';

  // The rhyming dictionaries, in Settings' Writing card: every Language
  // Bandmate rhymes in, each with its download size, whether it's downloaded
  // to this device and when it was last updated, to download or remove. Any
  // number can be downloaded at once. Nothing is downloaded until one is.

  const id = $props.id();

  // Each Language's download size, by its code, once Bandmate says.
  let sizes = $state<Record<string, number>>({});
  api.getLanguages().then(
    (list) => (sizes = Object.fromEntries(list.map((l) => [l.code, l.size]))),
    () => {}, // Offline, say: the list shows without sizes.
  );

  /** Why the last Download or Remove of a Language failed. */
  let problem = $state<{ code: string; message: string } | null>(null);

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  async function act(code: string, action: (code: string) => Promise<void>) {
    problem = null;
    try {
      await action(code);
    } catch (e) {
      // The browser's store fails with a DOMException, as where it keeps nothing.
      const message =
        e instanceof DOMException
          ? "This browser can't keep it, as happens in some private windows."
          : e instanceof Error
            ? e.message
            : String(e);
      problem = { code, message };
    }
  }

  /** What's said of a Language under its name: whether it's downloaded, when it was updated, and its size. */
  function details(code: string): string {
    const updatedAt = dictionaries.updatedAt(code);
    const size = sizes[code] !== undefined ? formatSmallSize(sizes[code]) : null;
    const state = updatedAt ? `Downloaded, updated ${dateFormat.format(new Date(updatedAt))}` : 'Not downloaded';
    return [state, size].filter(Boolean).join(' · ');
  }
</script>

<ul aria-label="Rhyming dictionaries">
  {#each languages as language, i (language.code)}
    {@const setUp = dictionaries.isSetUp(language.code)}
    {@const settingUp = dictionaries.settingUp(language.code)}
    <li>
      <div class="line">
        <div class="about">
          <span class="name" id="{id}-{i}-name">{language.name}</span>
          <span class="details tabular" id="{id}-{i}-details">{details(language.code)}</span>
        </div>
        {#if setUp}
          <button
            type="button"
            class="button"
            aria-describedby="{id}-{i}-name"
            onclick={() => act(language.code, (code) => dictionaries.remove(code))}>Remove</button
          >
        {:else}
          <button
            type="button"
            class="button"
            disabled={settingUp}
            aria-describedby="{id}-{i}-name {id}-{i}-details"
            onclick={() => act(language.code, (code) => dictionaries.setUp(code))}
            >{settingUp ? 'Downloading…' : 'Download'}</button
          >
        {/if}
      </div>
      {#if problem?.code === language.code}
        <p class="error" role="alert">Couldn’t {setUp ? 'remove' : 'download'} {language.name}. {problem.message}</p>
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    border-bottom: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }
  .about {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-size: var(--text-md);
  }
  .details {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .button {
    flex: none;
  }
  .error {
    margin: 0 0 var(--space-2);
  }
</style>
