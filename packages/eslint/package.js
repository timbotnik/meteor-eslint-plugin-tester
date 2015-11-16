Package.describe({
  name: 'eslint',
  version: '0.0.1',
  summary: 'Lint all .js & .jsx files with eslint',
  documentation: 'README.md'
});

Package.registerBuildPlugin({
  name: 'lintEslint',
  use: [
    'ecmascript',
    'underscore'
  ],
  sources: [
    'plugin/lint-eslint.js'
  ],
  npmDependencies: {
    'eslint': 'https://github.com/jmm/eslint/tarball/06eefb897f791fce176dc0163425f648be8338d1',
    'babel-eslint': '4.1.3',
    'eslint-plugin-react': '3.6.3',
    'js-yaml': '3.4.3',
    'strip-json-comments': '1.0.4',
    'chalk': '1.1.1',
    'eslint-config-timbotnik01': '1.0.0'
  }
});

Package.onUse(function(api) {
  api.versionsFrom('1.2.0.1');
  api.use(['isobuild:linter-plugin@1.0.0']);
});
