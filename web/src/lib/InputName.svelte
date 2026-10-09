<script lang="ts">
  import { channelName, channelNumber, deviceName, type DeviceChannel } from './inputSettings';

  // An Input's name on one line: a device's channel leads, then the device,
  // cut short with "…" where it doesn't fit, so the part that tells a
  // device's Inputs apart always shows. The whole of it is in the title.
  // The default input's names the Input it looks to be on a line under it.

  let {
    name = '',
    channel = null,
    is = null,
  }: {
    /** The name to show where it isn't a device's channel, e.g. "Default input". */
    name?: string;
    /** The device's channel to name; null to show the name as it is. */
    channel?: DeviceChannel | null;
    /** The Input the default input looks to be, to name under it; null for none. */
    is?: DeviceChannel | null;
  } = $props();
</script>

{#snippet line(channel: DeviceChannel | null, name: string)}
  <span class="line" title={channel ? channelName(channel.label, channel.channel) : name}
    >{#if channel}<span class="lead">{`${channelNumber(channel.channel)} · `}</span><span class="cut"
        >{deviceName(channel.label)}</span
      >{:else}<span class="cut">{name}</span>{/if}</span
  >
{/snippet}

<span class="input-name"
  >{@render line(channel, name)}{#if is}<span class="is">{@render line(is, '')}</span>{/if}</span
>

<style>
  .input-name {
    display: block;
    min-width: 0;
  }
  .line {
    display: flex;
    min-width: 0;
    white-space: nowrap;
  }
  .lead {
    flex: none;
    /* Keeps the space before the device's name, which a flex item would drop. */
    white-space: pre;
  }
  .cut {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .is {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
