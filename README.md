# Menoid — mobile wallet (Android, React Native / Expo)

A fresh rebuild of the Menoid wallet as a native Android app, ported from the
browser extension (`../wallet/wallet-extension`).

## What's in this milestone

The first-run journey only, end to end:

1. **Welcome** — the blinking mark, "Welcome to Menoid", a tagline, a next arrow.
2. **Choose** — Create wallet / Import wallet.
3. **Create** — recovery phrase → name → password → (encrypted + stored) → lock screen.
4. **Import** — seed phrase or private key → name → password → (encrypted + stored) → lock screen.
5. **Lock** — enter the password to decrypt the keys into the session.
6. **Under development** — the unlocked home for now (blinking mark + label).

Closing the app forgets the decrypted keys (they live in memory only), so
re-opening always lands back on the lock screen. Only the AES-GCM–encrypted
blob is persisted (AsyncStorage), same trust model as the extension.

## Architecture

```
src/
  polyfills.ts            Buffer + getRandomValues, imported first
  theme/                  palette, sky gradients, fonts, open/noid tokens
  crypto/                 walletCrypto (PBKDF2 + AES-GCM), keyDerivation (EVM/SOL/SUI/APT)
  lib/                    storage (AsyncStorage), wallets (encrypted store)
  lib/networks|chains|rpc the six chains: config, crests, native balances
  services/prices         live USD prices (CoinGecko)
  context/WalletContext   the unlocked session (decrypt / lock) + view mode
  components/brand/       Backdrop, Sky, Clouds, CloudChip, MenoidWordmark, AnimatedLogo
  components/setup/       SetupUI kit, Welcome, CreateWallet, ImportWallet, LockScreen
  components/WalletHome   navbar (accounts / mode / settings) + body
  components/modes/       OpenModeView (live), NoidModeView (placeholder)
  components/shared/      AnimatedNumber, copy chips, treasure card, under-dev panel
App.tsx                   loading → onboarding → locked → unlocked
```

## Run it

```bash
npm run android      # build + install on a booted emulator / connected device
```

Or open `android/` in Android Studio and press Run. See the setup notes for the
JDK requirement (use Android Studio's bundled JDK, not a Homebrew JDK 26).

## Android notes (hard-won — read before touching the UI)

- **Never put `elevation`/`shadow*` on a translucent view.** Android paints the
  shadow behind it, so it shows *through* the glass as a hard dark rectangle.
- **Keep `textShadowRadius` small (≤6)** or it rasterises as a grey plate.
- **Don't `scaleY` an SVG `<G>`** to blink — it ignores transform-origin and the
  eyes fly off the face. Animate the eye rect's `height` + `y` instead.
- **Don't stretch cloud shapes with `preserveAspectRatio="none"`** — it squashes
  the lobes. `CloudSurface` computes true ellipses from the measured box.
- **Yield a frame before blocking crypto** (`await setTimeout(…, 50)`) or React
  never paints the spinner and the app looks frozen.
- PBKDF2 runs **native** via `react-native-quick-crypto`; adding/removing it
  needs a Gradle rebuild, not just a Metro reload.

## Keys

Real, extension-identical keys on all four chains — EVM, Solana, Sui, Aptos.
The noid spend key is a genuine BabyJubJub point (pk = sk·Base8), implemented
in `src/crypto/babyjub.ts` rather than pulled from circomlibjs.

Two verification scripts guard this; run them after ANY change to derivation:

```bash
node --experimental-strip-types scripts/verify-babyjub.ts      # vs circomlibjs
node --experimental-strip-types scripts/verify-derivation.ts   # vs the extension
```

The second imports the extension's own modules, so a mismatch means the app
would give a different on-chain identity than the extension for the same seed.
(It needs a temporary copy with a resolvable import — see the sed line in the
project history, Node ESM requires the `.ts` extension that Metro does not.)

## Performance rules (this app was once badly janky)

- **Never animate SVG geometry props.** They cannot use the native driver, so
  every frame crosses into JS. The blink animates a `<View>` `scaleY` instead —
  RN scales about the view's own centre, which is exactly the right pivot.
- **Memoise every brand component.** Sky/Clouds/CloudChip/Wordmark are large
  vector trees; without `memo` a single keystroke re-renders all of them.
- **`renderToHardwareTextureAndroid`** on the sky and the cloud banks — static
  or purely-translated art becomes one GPU texture instead of re-rasterising.
- **No SVG filters.** `<FeDropShadow>` forces an offscreen pass + blur on every
  draw of every chip. Two offset silhouettes look the same and cost two fills.
- **Load only the font weights actually used** — each one blocks first paint.

Measured on the Pixel_7 emulator (software GPU, so treat absolutes with care;
the ratios are what matter): median frame time went 450ms → 48ms, and the same
scroll test that scored 2.25× worse than the native Settings app now matches it.

## Not yet wired (next steps)

- The wallet home (balances, modes, send/receive, pool) is a separate milestone.

## Building an installable APK

```bash
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew :app:assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk` — standalone (the
JS bundle is embedded, so no Metro needed), signed with the debug keystore, and
universal (arm64-v8a, armeabi-v7a, x86, x86_64). Minification and resource
shrinking are off, so it matches the debug build's behaviour.

Generate a real signing key before any Play Store release.

### Launcher icon

The icon layers are generated from `../wallet/wallet-extension/assets/icon.png`
composited onto the purple grid sky, written to `assets/*` and to
`android/app/src/main/res/mipmap-*/`. Regenerate them if the mark changes.
