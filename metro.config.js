// Metro config with a Buffer polyfill so the crypto/encoding libs (bs58,
// tweetnacl) bundle for both web and native. ethers v6 and @noble/* are
// self-contained and use globalThis.crypto, so no node-crypto shim is needed.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve("buffer"),
};

module.exports = config;
