<script lang="ts">
  import { interceptLinks, router } from './lib/router.svelte';
  import SongList from './routes/SongList.svelte';
  import ImportSong from './routes/ImportSong.svelte';
  import SongPage from './routes/SongPage.svelte';
  import BeatLibrary from './routes/BeatLibrary.svelte';
  import ChordFinderPage from './routes/ChordFinderPage.svelte';
  import About from './routes/About.svelte';
  import NotFound from './routes/NotFound.svelte';
  import MainNav from './lib/MainNav.svelte';

  const songMatch = $derived(router.path.match(/^\/songs\/(\d+)$/));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="app" onclick={interceptLinks}>
  <MainNav />
  <div class="content">
    {#if router.path === '/'}
      <SongList />
    {:else if router.path === '/beats'}
      <BeatLibrary />
    {:else if router.path === '/chords'}
      <ChordFinderPage />
    {:else if router.path === '/about'}
      <About />
    {:else if router.path === '/songs/import'}
      <ImportSong />
    {:else if songMatch}
      {#key songMatch[1]}
        <SongPage id={Number(songMatch[1])} />
      {/key}
    {:else}
      <NotFound />
    {/if}
  </div>
</div>
