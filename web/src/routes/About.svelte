<script lang="ts">
  // Settings' About tab: which Bandmate is running, with a link to exactly
  // that version's source, as AGPL-3.0 §13 asks of anyone running a modified
  // Bandmate over a network, the system facts a bug report needs, ready to
  // copy, and what's new.
  import {
    api,
    type AboutInfo,
    type ReleasesReport,
    type ServerConfig,
    type YtDlpCheck,
    type YtDlpInUse,
    type YtDlpUpdate,
  } from '../lib/api';
  import { bugReportDetails, updateStatus, uptime, ytDlpOffer, ytDlpUpdated } from '../lib/about';
  import BrandMark from '../lib/BrandMark.svelte';
  import FoldChevron from '../lib/FoldChevron.svelte';
  import SettingsPage from '../lib/SettingsPage.svelte';

  // The version and its source link come from /api/config, which doesn't
  // need the database, so they show even if the system facts can't be read.
  let config = $state<ServerConfig | null>(null);
  let error = $state<string | null>(null);
  let about = $state<AboutInfo | null>(null);
  let aboutError = $state<string | null>(null);

  api.getConfig().then(
    (c) => {
      config = c;
      if (c.addFromLink) loadYtDlp();
    },
    (e: Error) => (error = e.message),
  );

  // The yt-dlp that fetches links, a row of System information unless
  // adding from a link is off. Asking it runs yt-dlp, so it loads on its own,
  // as does the check for a newer release, which asks GitHub.
  let ytDlp = $state<YtDlpInUse | null>(null);
  let ytDlpError = $state<string | null>(null);
  let ytDlpCheck = $state<YtDlpCheck | null>(null);
  function loadYtDlp() {
    api.getYtDlp().then(
      (y) => (ytDlp = y),
      (e: Error) => (ytDlpError = e.message),
    );
    checkYtDlp();
  }
  function checkYtDlp() {
    api.getYtDlpCheck().then(
      (c) => (ytDlpCheck = c),
      () => (ytDlpCheck = { check: 'failed' }),
    );
  }
  /** What the yt-dlp row offers: nothing until the check answers, so an
      update isn't offered and then taken back. */
  const ytDlpRowOffer = $derived(ytDlpCheck && ytDlpOffer(ytDlpCheck));

  let updatingYtDlp = $state(false);
  let ytDlpUpdate = $state<YtDlpUpdate | null>(null);
  let ytDlpUpdateError = $state<string | null>(null);
  async function updateYtDlp() {
    updatingYtDlp = true;
    ytDlpUpdate = null;
    ytDlpUpdateError = null;
    try {
      ytDlpUpdate = await api.updateYtDlp();
      ytDlp = ytDlpUpdate;
      // Against the yt-dlp now in use, offering nothing until it answers.
      ytDlpCheck = null;
      checkYtDlp();
    } catch (e) {
      ytDlpUpdateError = (e as Error).message;
    } finally {
      updatingYtDlp = false;
    }
  }
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

  /** The Dependencies tab's lists, Go's first, each with what it says when
      it lists none. Programs ship only in Bandmate's image. */
  const dependencyLists = $derived(
    about
      ? [
          { id: 'go', label: 'Go', items: about.dependencies.go, none: 'None recorded in this build.' },
          { id: 'web', label: 'Web', items: about.dependencies.web, none: 'None recorded in this build.' },
          {
            id: 'programs',
            label: 'Programs',
            items: about.dependencies.programs,
            none: "None bundled: this Bandmate isn't running from its image.",
          },
        ]
      : [],
  );
  /** How many dependencies the Dependencies tab lists, once loaded. */
  const dependencyCount = $derived(
    about ? ` (${dependencyLists.reduce((count, list) => count + list.items.length, 0)})` : '',
  );
  const counts = $derived({ 'release-notes': releaseCount, dependencies: dependencyCount });

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
    const text = bugReportDetails(details, navigator.userAgent, ytDlp?.version);
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

<SettingsPage tab="about">
  <div class="about">
    <section class="card intro">
      <BrandMark large />
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
          {#if config?.addFromLink}
            <dt>yt-dlp</dt>
            <dd>
              <div class="yt-dlp">
                {#if ytDlp}
                  <span>{ytDlp.version} <span class="muted">({ytDlp.source})</span></span>
                  {#if ytDlpRowOffer?.status}<span class="muted">{ytDlpRowOffer.status}</span>{/if}
                  {#if ytDlpRowOffer?.button}
                    <button class="button quiet" type="button" disabled={updatingYtDlp} onclick={updateYtDlp}>
                      {updatingYtDlp ? 'Updating…' : ytDlpRowOffer.button}
                    </button>
                  {/if}
                {:else if ytDlpError}
                  <span class="error">{ytDlpError}</span>
                {:else}
                  <span class="muted">Checking…</span>
                {/if}
              </div>
              <p class="yt-dlp-status" class:error={ytDlpUpdateError} role="status">
                {#if ytDlpUpdate}
                  {ytDlpUpdated(ytDlpUpdate)}{#if ytDlpUpdate.outcome === 'cantRun'}:
                    <a href="https://xkirtle.github.io/bandmate/self-hosting#mounting-your-own-yt-dlp"
                      >see how in the self-hosting guide</a
                    >{/if}
                {:else if ytDlpUpdateError}{ytDlpUpdateError}{/if}
              </p>
            </dd>
          {/if}
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
            {t.label}{counts[t.id]}
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
                        <FoldChevron />
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
          {:else if aboutError}
            <p class="error" role="alert">Couldn't load the dependencies: {aboutError}</p>
          {:else if about}
            <p class="muted">The third-party packages and programs that ship in Bandmate, with their licenses.</p>
            <!-- Like the release notes, each list folds away; all start open. -->
            {#each dependencyLists as list (list.id)}
              <details class="dependencies" open>
                <summary>
                  <FoldChevron />
                  <span class="group-name">{list.label}</span>
                  <span class="muted">({list.items.length})</span>
                </summary>
                {#if list.items.length > 0}
                  <ul class="dependency-list">
                    {#each list.items as d (d.name + '@' + d.version)}
                      <li>
                        <span class="dependency-name">{d.name}</span>
                        <span class="muted dependency-version">{d.version}</span>
                        <span class="dependency-license">
                          {#if d.url}<a href={d.url}>{d.license}</a>{:else}{d.license}{/if}
                        </span>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="muted dependency-none">{list.none}</p>
                {/if}
              </details>
            {/each}
          {/if}
        </div>
      {/each}
    </section>
  </div>
</SettingsPage>

<style>
  /* On desktop, the identity and System information cards sit side by
     side, above the tabbed card. */
  .about {
    display: grid;
    gap: var(--space-4);
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
  }
  .card p {
    margin: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-xl);
  }

  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-6);
    text-align: center;
  }
  .intro h2 {
    margin-top: var(--space-2);
    font-size: var(--text-2xl);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2) var(--space-6);
    margin: var(--space-2) 0;
    padding: 0;
    list-style: none;
  }

  .system {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-4);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-4);
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
    gap: var(--space-2) var(--space-4);
    margin-top: auto;
  }
  .copy-status:empty {
    display: none;
  }
  .hint {
    font-size: var(--text-md);
  }

  .tabs {
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .panel {
    padding: var(--space-4);
  }
  /* A phone's tabs are tighter, so their labels, with counts, fit on a line. */
  @media (max-width: 24rem) {
    .tabs {
      padding: 0;
      gap: 0;
    }
    .tabs > button {
      padding: 0 var(--space-2);
      font-size: var(--text-lg);
    }
  }

  .update {
    color: var(--text-muted);
  }
  .update.available a {
    font-weight: 600;
  }

  /* The yt-dlp row: its version, then what the check says or its Update
     button, wrapping on a phone; what updating did goes under it. */
  .yt-dlp {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-3);
  }
  /* The version and its source stay on one line; what follows wraps. */
  .yt-dlp > span:first-child {
    white-space: nowrap;
  }
  .yt-dlp-status {
    margin-top: var(--space-1);
    font-size: var(--text-md);
  }
  .yt-dlp-status:empty {
    display: none;
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
    gap: var(--space-1) var(--space-2);
    min-height: var(--control);
    padding: var(--space-2) 0;
    cursor: pointer;
  }
  .release-tag {
    font-weight: 600;
    font-size: var(--text-lg);
  }
  /* Under the header's text, past the chevron. */
  .release-body {
    padding: 0 0 var(--space-4) var(--space-6);
  }
  /* A phone can't spare the width. */
  @media (max-width: 24rem) {
    .release-body {
      padding-left: 0;
    }
  }
  .card .release-link {
    margin-top: var(--space-3);
    font-size: var(--text-md);
  }
  .release-name {
    font-weight: 400;
    color: var(--text-muted);
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .change {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
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
    margin-top: var(--space-6);
  }

  .dependencies + .dependencies {
    border-top: 1px solid var(--border);
  }
  .panel > p + .dependencies {
    margin-top: var(--space-2);
  }
  .group-name {
    font-weight: 600;
    font-size: var(--text-lg);
  }
  /* The name and version on the left, the license on the right; on a phone,
     a long name pushes the rest onto the next line. */
  .dependency-list {
    margin: 0;
    padding: 0 0 var(--space-4) var(--space-6);
    list-style: none;
  }
  .dependency-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-2);
    padding: var(--space-1) 0;
  }
  .dependency-name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dependency-version {
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
  .dependency-license {
    margin-left: auto;
    white-space: nowrap;
  }
  .card .dependency-none {
    padding: 0 0 var(--space-4) var(--space-6);
  }
  /* A phone can't spare the width. */
  @media (max-width: 24rem) {
    .dependency-list,
    .card .dependency-none {
      padding-left: 0;
    }
  }

  /* Like the Status badges: New, Fix and Docs mark a change's kind, and
     Running the release that's running. */
  .badge {
    flex: none;
    min-width: 3rem;
    text-align: center;
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
