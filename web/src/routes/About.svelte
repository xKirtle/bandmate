<script lang="ts">
  // Which Bandmate is running, with a link to exactly that version's source,
  // as AGPL-3.0 §13 asks of anyone running a modified Bandmate over a network,
  // and the system facts a bug report needs, ready to copy.
  import { api, type AboutInfo, type ServerConfig } from '../lib/api';
  import { bugReportDetails, uptime } from '../lib/about';
  import BrandMark from '../lib/BrandMark.svelte';

  // The version and its source link come from /api/config, which doesn't
  // need the database, so they show even if the system facts can't be read.
  let config = $state<ServerConfig | null>(null);
  let error = $state<string | null>(null);
  let about = $state<AboutInfo | null>(null);
  let aboutError = $state<string | null>(null);

  api.getConfig().then(
    (c) => (config = c),
    (e: Error) => (error = e.message),
  );
  api.getAbout().then(
    (a) => (about = a),
    (e: Error) => (aboutError = e.message),
  );

  // The uptime counts on while the page is open.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  /** "2026-09-29", from an RFC 3339 time. */
  const day = (iso: string) => iso.slice(0, 10);

  let copyStatus = $state<'copied' | 'failed' | null>(null);
  let copyStatusTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyDetails(details: string) {
    const text = bugReportDetails(details, navigator.userAgent);
    clearTimeout(copyStatusTimer);
    copyStatus = (await copy(text)) ? 'copied' : 'failed';
    if (copyStatus === 'copied') copyStatusTimer = setTimeout(() => (copyStatus = null), 2000);
  }

  /** Puts text on the clipboard, falling back to the old way where the
      Clipboard API isn't offered, e.g. over plain HTTP on a local network. */
  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      } finally {
        area.remove();
      }
    }
  }

  const tabs = [
    { id: 'release-notes', label: 'Release notes' },
    { id: 'dependencies', label: 'Dependencies' },
  ] as const;
  let tab = $state<(typeof tabs)[number]['id']>('release-notes');
  let tabButtons: HTMLButtonElement[] = $state([]);

  // Arrow keys, Home and End move between the tabs, as a tab list's do.
  function tabKey(e: KeyboardEvent, i: number) {
    const moves: Record<string, number> = {
      ArrowRight: (i + 1) % tabs.length,
      ArrowLeft: (i - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tab = tabs[to].id;
    tabButtons[to]?.focus();
  }
</script>

<header class="bar">
  <h1>About</h1>
</header>

<main class="page">
  <div class="about">
    <section class="card intro">
      <BrandMark size="4rem" />
      <h2>Bandmate</h2>
      {#if config}
        <p>Version <code>{config.version}</code></p>
        <ul class="links">
          <li><a href={config.sourceUrl}>Source code</a></li>
          <li><a href={config.bugReportUrl}>Report a bug</a></li>
        </ul>
      {:else if error}
        <p class="error" role="alert">Couldn't load the version: {error}</p>
      {/if}

      <p class="muted">
        Bandmate is free software under the
        <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3</a>.
      </p>
    </section>

    <section class="card system" aria-labelledby="system-heading">
      <h2 id="system-heading">System information</h2>
      {#if aboutError}
        <p class="error" role="alert">Couldn't load the system information: {aboutError}</p>
      {:else if about}
        <dl>
          <dt>Commit</dt>
          <dd>
            {#if about.revision}
              <code title={about.revision}>{about.revision.slice(0, 7)}</code>
              {#if about.commitTime}<span class="muted date">({day(about.commitTime)})</span>{/if}
            {:else}
              <span class="muted">Unknown</span>
            {/if}
          </dd>
          <dt>Go</dt>
          <dd>{about.goVersion}</dd>
          <dt>Platform</dt>
          <dd>{about.os}/{about.arch}</dd>
          <dt>SQLite</dt>
          <dd>{about.sqliteVersion}</dd>
          <dt>Schema</dt>
          <dd>
            <code>{about.schema.migration}</code>
            <span class="muted date">({day(about.schema.appliedAt)})</span>
          </dd>
          <dt>Uptime</dt>
          <dd>{uptime(about.startedAt, now)}</dd>
        </dl>
        <div class="copy">
          <button class="button" type="button" onclick={() => about && copyDetails(about.details)}>
            Copy details
          </button>
          <span class="copy-status" role="status">
            {#if copyStatus === 'copied'}Copied{:else if copyStatus === 'failed'}Couldn't copy: your browser didn't
              allow it{/if}
          </span>
        </div>
        <p class="muted hint">Paste them into your bug report.</p>
      {/if}
    </section>

    <section class="card tabbed">
      <div class="tabs" role="tablist" aria-label="More about Bandmate">
        {#each tabs as t, i (t.id)}
          <button
            bind:this={tabButtons[i]}
            id="tab-{t.id}"
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="panel-{t.id}"
            tabindex={tab === t.id ? 0 : -1}
            onclick={() => (tab = t.id)}
            onkeydown={(e) => tabKey(e, i)}
          >
            {t.label}
          </button>
        {/each}
      </div>
      {#each tabs as t (t.id)}
        <div
          class="panel"
          id="panel-{t.id}"
          role="tabpanel"
          aria-labelledby="tab-{t.id}"
          tabindex="0"
          hidden={tab !== t.id}
        >
          {#if t.id === 'release-notes'}
            {#if about}
              <p>See what's new in each release on <a href={about.releasesUrl}>Bandmate's releases page</a>.</p>
            {/if}
          {:else}
            <p class="muted">The libraries that ship with Bandmate, and their licenses, will be listed here.</p>
          {/if}
        </div>
      {/each}
    </section>
  </div>
</main>

<style>
  /* Kept narrow enough not to stretch across a wide window, at the page's
     left edge like the other pages' content. On desktop, the identity and
     System information cards sit side by side, above the tabbed card. */
  .about {
    display: grid;
    gap: 1rem;
    max-width: 64rem;
  }
  @media (min-width: 65.5rem) {
    .about {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .tabbed {
      grid-column: 1 / -1;
    }
    /* The tab body scrolls on its own, rather than the page growing long. */
    .panel {
      max-height: 60vh;
      overflow-y: auto;
    }
  }

  /* The app's usual panel style. */
  .card {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
  }
  .card p {
    margin: 0;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem 1rem 1.5rem;
    text-align: center;
  }
  .intro h2 {
    margin-top: 0.5rem;
    font-size: 1.5rem;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 1.5rem;
    margin: 0.5rem 0;
    padding: 0;
    list-style: none;
  }

  .system {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem 1rem;
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.375rem 1rem;
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .date {
    white-space: nowrap;
  }
  .copy {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-top: auto;
  }
  .copy-status:empty {
    display: none;
  }
  .hint {
    font-size: 0.875rem;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  [role='tab'] {
    min-height: var(--control);
    padding: 0 0.75rem;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  [role='tab'][aria-selected='true'] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }
  .panel {
    padding: 1rem;
  }
</style>
