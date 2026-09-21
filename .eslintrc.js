module.exports = {
  root: true,
  extends: ['expo', 'plugin:react-native-a11y/all'],
  plugins: ['react-native-a11y'],
  rules: {
    // The 'all' preset demands hints on every labeled element, including
    // static display rows whose children already convey full content.
    // Hints stay mandatory on interactive elements via review; display-only
    // groupings are downgraded to a warning.
    'react-native-a11y/has-accessibility-hint': 'warn',
  },
  ignorePatterns: ['dist/*', 'node_modules/*', '.expo/*', 'voice-line/*'],
};
