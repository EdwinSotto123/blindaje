// Metro por defecto de Expo. apps/mobile es un proyecto npm independiente (fuera del workspace
// de pnpm), así que Metro solo resuelve desde apps/mobile/node_modules.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
