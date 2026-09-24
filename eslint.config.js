'use strict'
// Correctness checks only (undefined names, unused variables, unreachable code, duplicate keys …);
// the code keeps its own formatting. Run: npx eslint .
const fs = require('fs')
const path = require('path')
const js = require('@eslint/js')
const globals = require('globals')

// The page scripts (app-*.js) share one global scope: each file may use what the others declare at
// top level. Their top-level names are collected here and given to every other page script.
const appFiles = fs.readdirSync(__dirname).filter(name => /^app-.*\.js$/.test(name))
function topLevelNames (file) {
  const names = new Set()
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8')
  for (const [, name] of text.matchAll(/^(?:async\s+)?function\*?\s+([\w$]+)/gm)) names.add(name)
  for (const [, list] of text.matchAll(/^(?:const|let|var|class)\s+([^=(]+?)\s*(?:=|$|\{)/gm)) {
    for (const part of list.replace(/[{}]/g, '').split(',')) {
      const name = part.split(':').pop().trim().split(/\s/)[0]
      if (/^[\w$]+$/.test(name)) names.add(name)
    }
  }
  return names
}
const declared = Object.fromEntries(appFiles.map(file => [file, topLevelNames(file)]))
const pageGlobals = file => Object.fromEntries(appFiles.filter(other => other !== file)
  .flatMap(other => [...declared[other]]).filter(name => !declared[file].has(name)).map(name => [name, 'writable']))

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
  // Page scripts: names from the other app-*.js files; top-level names may be used by another file.
  ...appFiles.map(file => ({
    files: [file],
    languageOptions: { globals: pageGlobals(file) },
    rules: { 'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] }
  })),
  {
    files: ['tests/**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    // Tests match text with literal runs of spaces on purpose.
    rules: { ...rules, 'no-regex-spaces': 'off' }
  }
]
