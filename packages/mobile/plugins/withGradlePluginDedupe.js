const { withSettingsGradle } = require('@expo/config-plugins');

// Make both `@react-native/gradle-plugin` includeBuild calls resolve through
// react-native's own node_modules. This (a) works under pnpm's isolated layout
// where the plugin is only reachable from react-native, and (b) makes both
// includeBuild lines resolve to the SAME directory so Gradle dedupes them
// instead of failing with a duplicate build-path collision.
const BARE_RESOLVE = /require\.resolve\('@react-native\/gradle-plugin\/package\.json'\)/g;

const PATHS_RESOLVE =
  "require.resolve('@react-native/gradle-plugin/package.json', { paths: [require.resolve('react-native/package.json')] })";

module.exports = function withGradlePluginDedupe(config) {
  return withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      BARE_RESOLVE,
      PATHS_RESOLVE
    );
    return cfg;
  });
};
