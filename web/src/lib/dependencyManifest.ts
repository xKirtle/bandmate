// What the Vite config's dependency manifest plugin works out about a module
// in the bundle: which node_modules package it's from, and that package's
// license. Kept here, apart from the config, so it can be unit-tested.

/** The folder under a path's last node_modules: the package itself, e.g.
    node_modules/@scope/name for …/node_modules/@scope/name/lib/x.js. */
const inPackage = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;

/** The folder of the node_modules package a bundled module is from, or null
    for the app's own code. A plugin may mark an id virtual with a leading
    NUL. */
export function packageDir(moduleId: string): string | null {
  return inPackage.exec(moduleId.replace(/^\0/, ''))?.[1] ?? null;
}

/** A package.json's license: its SPDX expression, or the old object and
    array forms, else "Unknown". */
export function licenseOf(pkg: { license?: unknown; licenses?: unknown }): string {
  const named = (l: unknown) => (typeof l === 'string' ? l : (l as { type?: string } | null)?.type);
  const licenses = pkg.license ? [named(pkg.license)] : Array.isArray(pkg.licenses) ? pkg.licenses.map(named) : [];
  return licenses.filter(Boolean).join(' OR ') || 'Unknown';
}
