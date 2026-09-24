'use strict'
// Correctness checks only (undefined names, unused variables, unreachable code, duplicate keys …);
// the code keeps its own formatting. Run: npx eslint .
const js = require('@eslint/js')
const globals = require('globals')

// Browser modules share these globals through <script> tags (see index.html).
const monet = Object.fromEntries(['MonetViewer', 'MonetTheme', 'MonetXYZ', 'MonetUnits', 'MonetQMResolve', 'MonetQM', 'MonetQMPanel',
  'MonetASEModel', 'MonetFit', 'MonetPBC', 'MonetLineChart', 'MonetHeatmapChart', 'MonetPlot', 'MonetProvenance', 'MonetConsole',
  'MonetReport', 'MonetReplay', 'MonetAnalysisForms'].map(name => [name, 'readonly']))

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  // An empty catch is how the code says "optional, ignore failures" (storage, history logging).
  'no-empty': ['error', { allowEmptyCatch: true }]
}
// Node-only files (Electron main process, desktop bridge pool).
const node = ['main.js', 'preload.js', 'bridge-worker.js', 'eslint.config.js']

module.exports = [
  { ignores: ['node_modules/**', '.claude/**', 'docs/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    ignores: node,
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.node, ...monet } },
    rules
  },
  { files: node, languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node }, rules },
  {
    files: ['tests/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    // Tests match text with literal runs of spaces on purpose.
    rules: { ...rules, 'no-regex-spaces': 'off' }
  }
]
