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
  theme/                  palette, sky gradients, fonts
  crypto/                 walletCrypto (PBKDF2 + AES-GCM), keyDerivation (EVM/SOL/SUI/APT)
  lib/                    storage (AsyncStorage), wallets (encrypted store)
  context/WalletContext   the unlocked session (decrypt / lock)
  components/brand/       Sky, Clouds, CloudChip, MenoidWordmark, AnimatedLogo (blink)
  components/setup/       SetupUI kit, Welcome, CreateWallet, ImportWallet, LockScreen
  components/UnderDevelopment.tsx
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

## Not yet wired (next steps)

- Sui/Aptos noid spend keys use a Poseidon approximation, not the real
  BabyJubJub point — fine for identity/display, swap in real curve math before
  any on-chain / ZK use.
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
