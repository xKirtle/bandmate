// Prettier's defaults, except single quotes and the width the code already
// follows. Go is formatted by gofmt; the repo's Markdown, YAML and JSON are
// out of scope (see .prettierignore).
export default {
  singleQuote: true,
  printWidth: 120,
  plugins: ['prettier-plugin-svelte'],
};
