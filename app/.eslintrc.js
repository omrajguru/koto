module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promise` marks deliberate fire-and-forget calls (event handlers, background refresh).
    'no-void': 'off',
  },
};
