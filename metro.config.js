// Metro config with a Buffer polyfill so the crypto/encoding libs (bs58,
// tweetnacl) bundle for both web and native. ethers v6 and @noble/* are
// self-contained and use globalThis.crypto, so no node-crypto shim is needed.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/* The circuit and its proving key ride along as ASSETS, not as code — Metro
   only copies extensions it knows about, and it knows about neither. */
config.resolver.assetExts = [...config.resolver.assetExts, "wasm", "zkey"];
/* snarkjs.min.js rides along as an ASSET too — the WebView loads it, the RN
   bundle must never try to evaluate it. */
config.resolver.assetExts = [...config.resolver.assetExts, "min.js"];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve("buffer"),
};


module.exports = config;
