<script lang="ts">
  import { interceptLinks, navigate, router } from './lib/router.svelte';
  import { movedTo, settingsTabAt } from './lib/nav';
  import SongList from './routes/SongList.svelte';
  import ImportSong from './routes/ImportSong.svelte';
  import SongPage from './routes/SongPage.svelte';
  import BeatLibrary from './routes/BeatLibrary.svelte';
  import ChordFinderPage from './routes/ChordFinderPage.svelte';
  import Backups from './routes/Backups.svelte';
  import Appearance from './routes/Appearance.svelte';
  import About from './routes/About.svelte';
  import NotFound from './routes/NotFound.svelte';
  import MainNav from './lib/MainNav.svelte';

  const songMatch = $derived(router.path.match(/^\/songs\/(\d+)$/));
  const settingsTab = $derived(settingsTabAt(router.path));
  const moved = $derived(movedTo(router.path));

  // An address that moved, such as /about to its Settings tab, opens where
  // it went, in place of itself in the history.
  $effect.pre(() => {
    if (moved) navigate(moved + router.search + location.hash, { replace: true });
  });
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
    {:else if settingsTab === 'appearance'}
      <Appearance />
    {:else if settingsTab === 'backups'}
      <Backups />
    {:else if settingsTab === 'about'}
      <About />
    {:else if moved}
      <!-- On its way to where it moved. -->
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
