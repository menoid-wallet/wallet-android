/**
 * polyfills.ts — imported first from index.ts, before any crypto/encoding lib.
 *
 *  - Buffer:  bs58 / tweetnacl expect a global Buffer on native.
 *  - crypto.getRandomValues:  provided by react-native-get-random-values.
 *  - process:  a couple of libs read process.env.
 */
import { Buffer } from "buffer";
import "react-native-get-random-values";

// @ts-ignore — install a global Buffer if the runtime has none (native).
if (typeof global.Buffer === "undefined") global.Buffer = Buffer;

// @ts-ignore — minimal process shim.
if (typeof global.process === "undefined") global.process = { env: {} };
// @ts-ignore
else if (!global.process.env) global.process.env = {};
