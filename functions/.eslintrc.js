module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'google',
  ],
  rules: {
    'no-restricted-globals': ['error', 'name', 'length'],
    'prefer-arrow-callback': 'error',
    quotes: ['error', 'single', {allowTemplateLiterals: true}],
    'max-len': ['error', {code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true}],
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
    'comma-dangle': ['error', 'always-multiline'],
    'quote-props': ['error', 'as-needed'],
    'object-curly-spacing': ['error', 'never'],
  },
  overrides: [
    {
      files: ['**/*.spec.*'],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
