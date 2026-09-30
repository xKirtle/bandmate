<script lang="ts">
  // Bandmate's mark, a placeholder "B" until there's a logo: at the top of
  // the nav rail, and larger on the About page. A logo replaces it here.
  let { size = '1.25rem' }: { size?: string } = $props();
</script>

<span class="brand-mark" style:font-size={size} aria-hidden="true">B</span>

<style>
  .brand-mark {
    color: var(--accent);
    font-weight: 800;
    line-height: 1;
  }
</style>
