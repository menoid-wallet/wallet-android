// Metro config with a Buffer polyfill so the crypto/encoding libs (bs58,
// tweetnacl) bundle for both web and native. ethers v6 and @noble/* are
// self-contained and use globalThis.crypto, so no node-crypto shim is needed.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/* The circuit and its proving key ride along as ASSETS, not as code — Metro
   only copies extensions it knows about, and it knows about neither. */
config.resolver.assetExts = [...config.resolver.assetExts, "wasm", "zkey"];

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve("buffer"),
};

/* snarkjs and ffjavascript both ship a Node build (terminal + node:crypto) and
   a browser build. Metro picks the Node one by default and then cannot resolve
   `readline`/`crypto`, so the phone gets the BROWSER condition explicitly —
   which is the same prover without the parts a phone does not have. */
config.resolver.unstable_conditionNames = ["browser", "require", "import"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "ffjavascript") {
    return {
      filePath: path.join(__dirname, "node_modules/ffjavascript/build/browser.esm.js"),
      type: "sourceFile",
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
