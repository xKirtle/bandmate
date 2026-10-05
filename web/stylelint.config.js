// Every style value comes from a token (docs/design.md). Each foundation
// turns on its own ban here as its tokens land; until then this checks only
// that the styles are valid.
export default {
  rules: {
    'color-no-invalid-hex': true,
    'function-calc-no-unspaced-operator': true,
    'property-no-unknown': true,
    'unit-no-unknown': true,
  },
  overrides: [{ files: ['**/*.svelte'], customSyntax: 'postcss-html' }],
};
