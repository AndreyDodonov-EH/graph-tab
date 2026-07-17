// Shared web-ext configuration.
// Keeps linting and building focused on the files the extension actually ships,
// excluding build artifacts, tests, store listing assets and docs.
module.exports = {
  ignoreFiles: [
    '*.zip',
    'web-ext-artifacts',
    'web-ext-config.cjs',
    'package.sh',
    'README.md',
    'icon.svg',
    'img',
    'listing',
    'tests',
  ],
};
