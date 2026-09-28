/**
 * ESLint 9 flat config
 *
 * 目标：抓语法/引用类真实问题（no-undef / no-unused-vars / no-dupe-*）。
 * 不引入 Prettier，避免一次性全量重排代码。
 */

const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  TextEncoder: 'readonly'
};

const RENDERER_GLOBALS = {
  document: 'readonly',
  window: 'readonly',
  navigator: 'readonly',
  HTMLElement: 'readonly',
  Event: 'readonly',
  Node: 'readonly'
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'bin/**',
      'assets/**'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...RENDERER_GLOBALS }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-shadow-restricted-names': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error'
    }
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly'
      }
    }
  }
];
