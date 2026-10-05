// Every icon is a Lucide one (see docs/design.md, Icons). Each is imported
// on its own, from '@lucide/svelte/icons/<name>', never from the package's
// index, so only the icons used are bundled, and in dev only those load.

/** An icon, as a component: `<Icon />`, sized by the text it's in. */
export type { LucideIcon as Icon } from '@lucide/svelte';
