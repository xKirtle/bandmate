// Every style value comes from a token (docs/design.md). Each foundation
// turns on its own ban here as its tokens land; the rest only checks that the
// styles are valid.

// Colour: literal colours are written only in the Palettes, and a shadow is
// always one of the shared shadow tokens. `transparent` and `currentColor`
// aren't colours of their own, so they stay allowed.
const colour = {
  'color-no-hex': true,
  'color-named': 'never',
  'function-disallowed-list': [
    'rgb',
    'rgba',
    'hsl',
    'hsla',
    'hwb',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'color',
    'drop-shadow',
  ],
  'declaration-property-value-allowed-list': {
    '/^(box|text)-shadow$/': ['none', '/^var\\(--(shadow-float|selected-outline|selected-edge|invalid-outline)\\)$/'],
  },
};

export default {
  rules: {
    'color-no-invalid-hex': true,
    'function-calc-no-unspaced-operator': true,
    'property-no-unknown': true,
    'unit-no-unknown': true,
    ...colour,
  },
  overrides: [
    { files: ['**/*.svelte'], customSyntax: 'postcss-html' },
    // Where the colour tokens are defined.
    { files: ['src/palettes.css'], rules: Object.fromEntries(Object.keys(colour).map((rule) => [rule, null])) },
  ],
};
