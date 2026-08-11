// packages/mobile/metro.config.js
// Monorepo-aware Metro config (A3.8 Turborepo). Metro must be able to resolve `@fleet/shared`
// from packages/shared and hoisted deps from the workspace root node_modules.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so edits in packages/shared hot-reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve from the package first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Do not walk up past the workspace root looking for node_modules.
config.resolver.disableHierarchicalLookup = true;

// 4. `@fleet/shared/mobile` is the RN-safe subpath barrel (it omits @sentry/node).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
