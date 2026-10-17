<script lang="ts">
  import { interceptLinks, navigate, router } from './lib/router.svelte';
  import { keyboardAndMouse } from './lib/keyHints';
  import { hiddenTabOpens, movedTo, settingsTabAt } from './lib/nav';
  import SongList from './routes/SongList.svelte';
  import SongPage from './routes/SongPage.svelte';
  import DemoSong from './routes/DemoSong.svelte';
  import BeatLibrary from './routes/BeatLibrary.svelte';
  import ChordFinderPage from './routes/ChordFinderPage.svelte';
  import Backups from './routes/Backups.svelte';
  import ThisDevice from './routes/ThisDevice.svelte';
  import Shortcuts from './routes/Shortcuts.svelte';
  import About from './routes/About.svelte';
  import NotFound from './routes/NotFound.svelte';
  import MainNav from './lib/MainNav.svelte';
  import TourSpotlight from './lib/TourSpotlight.svelte';
  import { demoPath } from './lib/tour.svelte';

  const songMatch = $derived(router.path.match(/^\/songs\/(\d+)$/));
  const folderMatch = $derived(router.path.match(/^\/folders\/(\d+)$/));
  const settingsTab = $derived(settingsTabAt(router.path));
  const moved = $derived(movedTo(router.path));
  // A Settings tab not shown here, Shortcuts on a phone or a narrow window,
  // opens This device at its address.
  const hidden = $derived(hiddenTabOpens(router.path, keyboardAndMouse()));

  // An address that moved, such as /about to its Settings tab, opens where
  // it went, in place of itself in the history, as does a hidden tab's.
  $effect.pre(() => {
    if (moved) navigate(moved + router.search + location.hash, { replace: true });
    else if (hidden) navigate(hidden, { replace: true });
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="app" onclick={interceptLinks}>
  <MainNav />
  <div class="content">
    {#if router.path === '/'}
      <SongList />
    {:else if folderMatch}
      {#key folderMatch[1]}
        <SongList folderId={Number(folderMatch[1])} />
      {/key}
    {:else if router.path === '/beats'}
      <BeatLibrary />
    {:else if router.path === '/chords'}
      <ChordFinderPage />
    {:else if settingsTab === 'device'}
      <ThisDevice />
    {:else if hidden}
      <!-- On its way to This device. -->
    {:else if settingsTab === 'shortcuts'}
      <Shortcuts />
    {:else if settingsTab === 'backups'}
      <Backups />
    {:else if settingsTab === 'about'}
      <About />
    {:else if moved}
      <!-- On its way to where it moved. -->
    {:else if router.path === demoPath}
      <DemoSong />
    {:else if songMatch}
      {#key songMatch[1]}
        <SongPage id={Number(songMatch[1])} />
      {/key}
    {:else}
      <NotFound />
    {/if}
  </div>
  <TourSpotlight />
</div>
