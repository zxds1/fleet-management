const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');
const config = getDefaultConfig(projectRoot);
// Monorepo: let Metro see @fleet/shared's source and resolve its dependencies (zod) from the app's node_modules.
config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(projectRoot, '../../node_modules')];
config.resolver.extraNodeModules = { '@fleet/shared': sharedRoot };
module.exports = config;
