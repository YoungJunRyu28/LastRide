// Sentry's wrapper adds the debug IDs that tie crash stack traces to source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
