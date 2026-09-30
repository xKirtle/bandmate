// Prettier's defaults, except single quotes and the width the code already
// follows. Only web/ is formatted: the repo's Markdown and YAML are left as
// written, and Go is formatted by gofmt.
export default {
  singleQuote: true,
  printWidth: 120,
  plugins: ['prettier-plugin-svelte'],
};
