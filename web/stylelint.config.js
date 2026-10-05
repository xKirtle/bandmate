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
};
const shadows = {
  '/^(box|text)-shadow$/': ['none', '/^var\\(--(shadow-float|selected-outline|selected-edge|invalid-outline)\\)$/'],
};

// Type: a font size is one of the size or lyric tokens, or on the Timeline a
// step of the same scale in its own unit, `--timeline-rem`. The `font`
// shorthand only ever inherits, so it can't set a size of its own.
// The steps are the --text-* sizes in app.css, in rem: keep them in step.
const scaleSteps = '(0\\.75|0\\.8125|0\\.875|1|1\\.25|1\\.5)';
const type = {
  'font-size': [
    'inherit',
    '/^var\\(--text-(xs|sm|md|lg|xl|2xl|field)\\)$/',
    '/^var\\(--lyric-(write|read-line|read-chord|read-label)\\)$/',
    '/^var\\(--timeline-rem\\)$/',
    `/^calc\\(${scaleSteps} \\* var\\(--timeline-rem\\)\\)$/`,
  ],
  font: ['inherit'],
};

// Spacing: a gap, padding or margin is built from the --space-* steps
// (negated as `calc(-1 * var(--space-2))`), the layout tokens and the
// safe-area insets, or on the Timeline a step of the same scale in its own
// unit. calc() may relate them to a size, e.g. centring text in a control.
// No literal length, but for a hairline (1px or less) that squares something
// with a border, and `1lh`, a line of text's own height. Positioning (inset,
// top…), scroll margins and focus-ring offsets aren't spacing.
// The steps are the --space-* sizes in app.css, in rem: keep them in step.
const spaceSteps = '(0\\.25|0\\.5|0\\.75|1|1\\.5|2)';
const spacing = {
  '/^(gap|row-gap|column-gap|padding|margin)(-.+)?$/': [
    '/(?<![\\w.-])-?(?!(0\\.5|1)px\\b|1lh\\b)(\\d*\\.)?\\d+[a-z%]+/i',
    `/(?<![\\w.])(?!-?${spaceSteps} )-?(\\d*\\.)?\\d+ \\* var\\(--timeline-rem\\)|var\\(--timeline-rem\\) *[*/]/`,
    // A step is never scaled, only negated.
    '/(?<!\\(-1 )\\* var\\(--space-|var\\(--space-\\d+\\) *[*/]/',
  ],
};

// Radius: each corner is 0, one of the --radius-* tokens, or on the Timeline
// a step of the same scale in its own unit (`full` needs no unit), plus any
// corners a file is allowed besides.
// The steps are the --radius-* sizes in app.css, in rem: keep them in step.
const radiusSteps = '(0\\.375|0\\.5|0\\.75)';
const radiusWith = (...extra) => {
  const corner = [
    '0',
    'var\\(--radius-(sm|md|lg|full)\\)',
    `calc\\(${radiusSteps} \\* var\\(--timeline-rem\\)\\)`,
    ...extra,
  ].join('|');
  return { '/^border(-.+)?-radius$/': ['inherit', `/^(${corner})( (${corner})){0,3}$/`] };
};
const radius = radiusWith();

// Motion: a duration or delay is one of the --duration-* tokens, never
// scaled, and the easing is always --ease, the one curve, written out in each
// transition and animation of a list so none falls back on the browser's
// own. Each is `<what> <duration> var(--ease) [<delay>]`, and an animation
// may add its count, direction, fill and play state. Under reduced motion
// the duration tokens are 0s, so nothing animates.
const token = 'var\\(--duration-(fast|base)\\)';
const timing = `${token} var\\(--ease\\)( ${token})?`;
const animationKeyword =
  '(infinite|\\d+|normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused)';
const list = (item) => `/^\\s*${item}\\s*(,\\s*${item}\\s*)*$/`;
const motion = {
  transition: ['none', 'inherit', list(`[a-z-]+ ${timing}`)],
  animation: ['none', 'inherit', list(`[\\w-]+ ${timing}( ${animationKeyword})*`)],
  '/^(transition|animation)-(duration|delay)$/': [`/^${token}$/`],
  '/^(transition|animation)-timing-function$/': ['/^var\\(--ease\\)$/'],
};
// No literal time in a transition or animation, only the tokens.
const literalTime = {
  '/^(transition|animation)(-.+)?$/': ['/(?<![\\w.-])(\\d*\\.)?\\d+m?s\\b/i'],
};

// What every file's allowed values start from.
const allowed = { ...shadows, ...type, ...radius, ...motion };

export default {
  rules: {
    'color-no-invalid-hex': true,
    'function-calc-no-unspaced-operator': true,
    'property-no-unknown': true,
    'unit-no-unknown': true,
    ...colour,
    'declaration-property-value-allowed-list': allowed,
    'declaration-property-value-disallowed-list': { ...spacing, ...literalTime },
  },
  overrides: [
    { files: ['**/*.svelte'], customSyntax: 'postcss-html' },
    // Where the colour tokens are defined.
    {
      files: ['src/palettes.css'],
      rules: {
        ...Object.fromEntries(Object.keys(colour).map((rule) => [rule, null])),
        'declaration-property-value-allowed-list': { ...type, ...radius, ...motion },
      },
    },
    // A Cover's corners grow with it, a fixed share of its size like an app
    // icon's, and so does a Cover placeholder's initial.
    {
      files: ['src/lib/SongCover.svelte', 'src/lib/CoverPlaceholder.svelte'],
      rules: {
        'declaration-property-value-allowed-list': {
          ...allowed,
          ...radiusWith('calc\\(var\\(--size\\) \\* 0\\.18\\)'),
          'font-size': [...type['font-size'], '/^calc\\(var\\(--size\\) \\* [0-9.]+\\)$/'],
        },
      },
    },
    // The actions menu's trigger takes the shape of what it wraps, through
    // --trigger-radius: only the Song page header's Cover sets it, to its own.
    {
      files: ['src/lib/ActionsMenu.svelte', 'src/lib/EditCover.svelte'],
      rules: {
        'declaration-property-value-allowed-list': {
          ...allowed,
          ...radiusWith('var\\(--trigger-radius(, var\\(--radius-md\\))?\\)'),
        },
      },
    },
  ],
};
