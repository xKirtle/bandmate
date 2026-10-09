<script lang="ts">
  import { channelName, channelNumber, deviceName } from './inputSettings';

  // An Input's name on one line: a device's channel leads, then the device,
  // cut short with "…" where it doesn't fit, so the part that tells a
  // device's Inputs apart always shows. The whole of it is in the title.

  let {
    name,
    channel,
  }: {
    /** The name to show where it isn't a device's channel, e.g. "Default input". */
    name: string;
    /** The device's channel, by the device's label; null to show the name as it is. */
    channel: { label: string; channel: number } | null;
  } = $props();

  const full = $derived(channel ? channelName(channel.label, channel.channel) : name);
</script>

<span class="input-name" title={full}
  >{#if channel}<span class="lead">{`${channelNumber(channel.channel)} · `}</span><span class="cut"
      >{deviceName(channel.label)}</span
    >{:else}<span class="cut">{name}</span>{/if}</span
>

<style>
  .input-name {
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
</style>
