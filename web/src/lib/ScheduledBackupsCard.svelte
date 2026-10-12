<script lang="ts">
  // Settings > Backups' Scheduled Backups card: whether Bandmate makes a
  // Backup of Everything on its own, how often, and how many it keeps. It's
  // kept in Bandmate, so it's the same from every device, and each change
  // is saved at once. Neither turning it off nor keeping fewer deletes a
  // Backup, so keeping fewer than there are says the extras go with the
  // next one.
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { api, type Backup, type BackupSchedule } from './api';
  import { extrasNote, fewestKept, mostKept, periods, stepKeep } from './backups';

  let {
    backups,
    onTurnedOn,
  }: {
    /** The Backups listed, to tell how many Scheduled Backups there are; null while they load. */
    backups: readonly Backup[] | null;
    /** Called once the schedule is turned on, as a Scheduled Backup is then made in the background. */
    onTurnedOn: () => void;
  } = $props();

  let schedule = $state<BackupSchedule | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** How many changes have been sent, so only the latest one's answer is shown. */
  let sent = 0;

  api.backupSchedule().then(
    (s) => (schedule = s),
    (e: Error) => (loadError = e.message),
  );

  /** Saves a change to the schedule, showing it at once, and as it was if it couldn't be saved. */
  async function change(to: Partial<BackupSchedule>) {
    if (!schedule) return;
    const was = schedule;
    const next = { ...was, ...to };
    schedule = next;
    error = null;
    const mine = ++sent;
    try {
      const saved = await api.setBackupSchedule(next);
      if (mine === sent) schedule = saved;
      if (saved.on && !was.on) onTurnedOn();
    } catch (e) {
      if (mine !== sent) return;
      schedule = was;
      error = `Couldn't change the schedule (${(e as Error).message})`;
    }
  }

  const note = $derived(schedule && backups ? extrasNote(schedule, backups) : null);
</script>

<section class="card" aria-labelledby="schedule-heading">
  <h2 id="schedule-heading">Scheduled Backups</h2>
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if schedule === null}
    <p class="muted">Loading…</p>
  {:else}
    <fieldset class="choice-group">
      <label class="choice-row">
        <input
          type="checkbox"
          role="switch"
          checked={schedule.on}
          onchange={(e) => change({ on: e.currentTarget.checked })}
          aria-describedby="schedule-note"
        />
        <span>Make Backups on a schedule</span>
      </label>
      <p id="schedule-note" class="choice-under hint">
        Bandmate backs up Everything on its own when one is due, and deletes the oldest Scheduled Backups beyond those
        kept. Backups you make or upload are never deleted.
      </p>
    </fieldset>
    <fieldset class="choice-group">
      <legend>How often</legend>
      {#each periods as period (period.id)}
        <label class="choice-row">
          <input
            type="radio"
            name="schedule-period"
            checked={schedule.period === period.id}
            onchange={() => change({ period: period.id })}
          />
          <span>{period.label}</span>
        </label>
      {/each}
    </fieldset>
    <div class="keep">
      <span id="schedule-keep" class="name">How many to keep</span>
      <div class="stepper" role="group" aria-labelledby="schedule-keep">
        <button
          type="button"
          class="button step"
          disabled={schedule.keep <= fewestKept}
          onclick={() => schedule && change({ keep: stepKeep(schedule.keep, -1) })}
          aria-label="Keep one fewer"
          title="Keep one fewer"><Minus /></button
        >
        <span class="amount tabular" aria-live="polite">{schedule.keep}</span>
        <button
          type="button"
          class="button step"
          disabled={schedule.keep >= mostKept}
          onclick={() => schedule && change({ keep: stepKeep(schedule.keep, 1) })}
          aria-label="Keep one more"
          title="Keep one more"><Plus /></button
        >
      </div>
    </div>
    {#if note}
      <p class="hint" role="status">{note}</p>
    {/if}
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .keep {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }
  .name {
    font-weight: 600;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .step {
    min-width: var(--control);
    padding: 0;
  }
  /* Wide enough for "30", so the steps don't move as it changes. */
  .amount {
    min-width: var(--control);
    text-align: center;
  }
</style>
