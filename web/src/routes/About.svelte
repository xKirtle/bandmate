<script lang="ts">
  // Which Bandmate is running, with a link to exactly that version's source,
  // as AGPL-3.0 §13 asks of anyone running a modified Bandmate over a network,
  // the system facts a bug report needs, ready to copy, and what's new.
  import { api, type AboutInfo, type ReleasesReport, type ServerConfig } from '../lib/api';
  import { bugReportDetails, updateStatus, uptime } from '../lib/about';
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

  // Releases come from GitHub, through the server, so they load on their
  // own: a slow or failing GitHub never holds up the rest of the page.
  let releases = $state<ReleasesReport | null>(null);
  api.getAboutReleases().then(
    (r) => (releases = r),
    () => (releases = { check: 'failed', releasesUrl: '', releases: [] }),
  );
  const status = $derived(releases && updateStatus(releases));
  /** The releases page, to look at when there's nothing to list here. */
  const releasesUrl = $derived(releases?.releasesUrl || about?.releasesUrl);
  const badges = { new: 'New', fix: 'Fix', docs: 'Docs' } as const;
  /** How many releases the Release notes tab lists, once checked. */
  const releaseCount = $derived(releases?.check === 'ok' ? ` (${releases.releases.length})` : '');

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
        {#if status}
          <p class="update" class:available={releases?.verdict === 'updateAvailable'}>
            {#if status.url}<a href={status.url}>{status.text}</a>{:else}{status.text}{/if}
            {#if status.seeReleases && releasesUrl}
              · <a href={releasesUrl}>See releases</a>
            {/if}
          </p>
        {/if}
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
            {t.label}{t.id === 'release-notes' ? releaseCount : ''}
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
            {#if !releases}
              <p class="muted">Checking GitHub for releases…</p>
            {:else if releases.check === 'ok' && releases.releases.length > 0}
              <ol class="releases">
                <!-- An accordion, so a long list stays tidy: the newest release
                     starts open, and any can be opened. -->
                {#each releases.releases as r, i (r.tag)}
                  <li>
                    <details open={i === 0}>
                      <summary>
                        <span class="chevron" aria-hidden="true">▸</span>
                        <span class="release-tag">{r.tag}</span>
                        {#if r.name && r.name !== r.tag}<span class="release-name">{r.name}</span>{/if}
                        <span class="muted date">{day(r.publishedAt)}</span>
                        {#if r.running}<span class="badge badge-running">Running</span>{/if}
                      </summary>
                      <div class="release-body">
                        {#if r.notes.length > 0}
                          <ul class="notes">
                            {#each r.notes as n, i (i)}
                              {#if 'text' in n}
                                <li class="note-text">{n.text}</li>
                              {:else}
                                <li class="change">
                                  <!-- Other has no badge, but keeps its space, so the titles line up. -->
                                  <span class="badge badge-{n.badge ?? 'none'}" aria-hidden={!n.badge}
                                    >{n.badge ? badges[n.badge] : ''}</span
                                  >
                                  <span>{n.title} <a href={n.url}>#{n.number}</a></span>
                                </li>
                              {/if}
                            {/each}
                          </ul>
                        {:else}
                          <p class="muted">No notes for this release.</p>
                        {/if}
                        <!-- The summary toggles, so the link to the release lives here. -->
                        <p class="release-link"><a href={r.url}>{r.tag} on GitHub</a></p>
                      </div>
                    </details>
                  </li>
                {/each}
              </ol>
              {#if releasesUrl}<p class="more"><a href={releasesUrl}>More on GitHub</a></p>{/if}
            {:else if releasesUrl}
              <p>
                {#if releases.check === 'failed'}Couldn't check for updates.
                {:else if releases.check === 'ok'}No releases yet.
                {/if}
                See what's new in each release on <a href={releasesUrl}>Bandmate's releases page</a>.
              </p>
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
    /* Rather than run off a narrow phone, the tabs wrap. */
    flex-wrap: wrap;
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
  /* A phone's tabs are tighter, so their labels, with counts, fit on a line. */
  @media (max-width: 24rem) {
    .tabs {
      gap: 0;
    }
    [role='tab'] {
      padding: 0 0.5rem;
      font-size: 0.9375rem;
    }
  }

  /* Where the cards stack, the tabbed card runs edge to edge, out through
     the page's gutters, to give the notes the whole width. Its tabs and body
     keep their own padding, clear of any notch. */
  @media (width < 65.5rem) {
    .tabbed {
      margin-inline: calc(-1 * max(var(--gutter), env(safe-area-inset-left)))
        calc(-1 * max(var(--gutter), env(safe-area-inset-right)));
      border-inline: 0;
      border-radius: 0;
    }
    .tabs {
      padding-inline: max(0.5rem, env(safe-area-inset-left)) max(0.5rem, env(safe-area-inset-right));
    }
    .panel {
      padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
    }
  }

  .update {
    color: var(--text-muted);
  }
  .update.available a {
    font-weight: 600;
  }

  .releases {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .releases > li + li {
    border-top: 1px solid var(--border);
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    min-height: var(--control);
    padding: 0.5rem 0;
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chevron {
    display: inline-block;
    width: 1rem;
    color: var(--text-muted);
    transition: transform 0.15s;
  }
  details[open] > summary .chevron {
    transform: rotate(90deg);
  }
  .release-tag {
    font-weight: 600;
    font-size: 1.0625rem;
  }
  /* Under the header's text, past the chevron. */
  .release-body {
    padding: 0 0 1rem 1.5rem;
  }
  /* A phone can't spare the width. */
  @media (max-width: 24rem) {
    .release-body {
      padding-left: 0;
    }
  }
  .card .release-link {
    margin-top: 0.75rem;
    font-size: 0.875rem;
  }
  .release-name {
    font-weight: 400;
    color: var(--text-muted);
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .change {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .change > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .note-text {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .card .more {
    margin-top: 1.5rem;
  }

  /* Like the Status badges: New, Fix and Docs mark a change's kind, and
     Running the release that's running. */
  .badge {
    flex: none;
    display: inline-block;
    min-width: 3rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
    white-space: nowrap;
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .badge-new {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
  .badge-fix {
    background: var(--drafting-bg);
    color: var(--drafting-fg);
  }
  .badge-none {
    background: none;
  }
  .badge-running {
    min-width: 0;
    background: var(--accent);
    color: var(--accent-text);
  }
</style>
