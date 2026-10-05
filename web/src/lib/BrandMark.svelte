<script lang="ts">
  // Bandmate's mark, in the Palette's accent: at the top of the nav rail, and
  // larger in About.
  import { markPath } from './brandMark';

  let { large = false }: { large?: boolean } = $props();
</script>

<svg class="brand-mark" class:large viewBox="0 0 32 32" aria-hidden="true">
  <path fill-rule="evenodd" d={markPath} />
</svg>

<style>
  .brand-mark {
    display: block;
    width: var(--mark-rail);
    height: var(--mark-rail);
    fill: var(--accent);
  }
  .large {
    width: var(--mark-large);
    height: var(--mark-large);
  }
</style>
