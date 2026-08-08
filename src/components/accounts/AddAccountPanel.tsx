/**
 * AddAccountPanel.tsx — creating or importing an account, full screen.
 *
 * Ported from the extension's AddWalletInline. The one thing that matters most
 * about it is what it does NOT do: it never asks for the password. The session
 * already holds it (see WalletContext), so a new account is sealed with the
 * same one, and the flow is two or three steps instead of onboarding's five.
 *
 * The panel takes the WHOLE screen rather than growing the accounts sheet. A
 * seed phrase is twelve words plus a confirmation and a keyboard after it —
 * that never fits in a sheet sized to a list, and animating the sheet's height
 * between the two would fight the keyboard the entire way.
 *
 * It is theme-aware (open ↔ noid) rather than reusing SetupUI, whose type is
 * white because onboarding always sits on the deep violet setup shell. Here the
 * background is the mode's own sky.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import {
  generateMnemonicOnly,
  importFromMnemonic,
  importFromPrivateKey,
  type FullWallet,
} from "../../crypto/keyDerivation";
import { useWallet } from "../../context/WalletContext";
import { useBackHandler } from "../../lib/useBackHandler";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";

type Route = "menu" | "create" | "import";
type CreateStep = "generating" | "seed" | "name" | "saving" | "done";
type ImportStep = "method" | "input" | "name" | "saving" | "done";
type ImportMethod = "seed" | "privatekey";
type PkNetwork = "ethereum" | "solana" | "sui" | "aptos";

const PK_NETWORKS: [PkNetwork, string][] = [
  ["ethereum", "Ethereum"],
  ["solana", "Solana"],
  ["sui", "Sui"],
  ["aptos", "Aptos"],
];

export default function AddAccountPanel({
  isNoid,
  onCancel,
  onAdded,
}: {
  isNoid: boolean;
  /** Back out to the accounts list. */
  onCancel: () => void;
  /** The account is saved and active — close the whole thing. */
  onAdded: () => void;
}) {
  const insets = useSafeAreaInsets();
  const t = panelTokens(isNoid);
  const [route, setRoute] = useState<Route>("menu");

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, {
      toValue: 1,
      duration: 340,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [rise]);

  const back = useCallback(() => {
    if (route === "menu") onCancel();
    else setRoute("menu");
  }, [route, onCancel]);

  /* Registered here rather than routed from WalletHome, and that placement is
     the whole point: BackHandler runs the most recently mounted listener first,
     so while this panel is up Back steps back through IT instead of closing the
     accounts sheet out from under a half-finished account. */
  useBackHandler(
    useCallback(() => {
      back();
      return true;
    }, [back])
  );

  return (
    <Animated.View
      style={[
        styles.fill,
        {
          backgroundColor: isNoid ? "#241448" : "#EFE7FB",
          opacity: rise,
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
          ],
        },
      ]}>
      <View style={[styles.head, { paddingTop: insets.top + 14, borderColor: t.glassLine }]}>
        <Pressable onPress={back} hitSlop={10} style={styles.backBtn}>
          <Svg width={15} height={9} viewBox="0 0 14 8" fill="none">
            <Path
              d="M14 4H2M2 4L5 1M2 4L5 7"
              stroke={rgba(t.inkRgb, 0.7)}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          </Svg>
          <Text style={[styles.backText, { color: rgba(t.inkRgb, 0.6) }]}>
            {route === "menu" ? "CANCEL" : "BACK"}
          </Text>
        </Pressable>
        <Text style={[styles.headTitle, { color: rgba(t.inkRgb, 0.62) }]}>ADD ACCOUNT</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {route === "menu" && (
            <Menu t={t} onCreate={() => setRoute("create")} onImport={() => setRoute("import")} />
          )}
          {route === "create" && <CreateFlow t={t} onDone={onAdded} />}
          {route === "import" && <ImportFlow t={t} onDone={onAdded} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

/* themeTokens has no "what colour is type ON the ink" — nothing else in the
   app fills a surface with `ink` — so it is derived here: the other mode's ink,
   which is exactly the contrast the two palettes are built around. */
type Tokens = ReturnType<typeof themeTokens> & { onInk: string };

function panelTokens(isNoid: boolean): Tokens {
  return { ...themeTokens(isNoid), onInk: isNoid ? "#3B2570" : "#F4EEFF" };
}

/* ───────────────────────────── menu ───────────────────────────── */

function Menu({ t, onCreate, onImport }: { t: Tokens; onCreate: () => void; onImport: () => void }) {
  const options = [
    {
      id: "create",
      emoji: "✨",
      title: "Create new account",
      sub: "A fresh seed phrase and a new set of keys.",
      onPress: onCreate,
    },
    {
      id: "import",
      emoji: "📜",
      title: "Import existing account",
      sub: "Restore from a seed phrase or a private key.",
      onPress: onImport,
    },
  ];
  return (
    <View>
      <Kicker t={t}>NEW ON MENOID</Kicker>
      <Title t={t}>Add an account</Title>
      <Lede t={t}>
        It is sealed with the password this wallet is already unlocked with — you will not be asked
        for it again.
      </Lede>
      <View style={{ gap: 12, marginTop: 22 }}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            onPress={o.onPress}
            style={({ pressed }) => [
              styles.optionCard,
              {
                backgroundColor: t.glass,
                borderColor: pressed ? rgba(t.inkRgb, 0.4) : t.glassLine,
              },
            ]}>
            <Text style={styles.optionEmoji}>{o.emoji}</Text>
            <View style={styles.fill}>
              <Text style={[styles.optionTitle, { color: t.ink }]}>{o.title}</Text>
              <Text style={[styles.optionSub, { color: rgba(t.inkRgb, 0.6) }]}>{o.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ───────────────────────────── create ───────────────────────────── */

function CreateFlow({ t, onDone }: { t: Tokens; onDone: () => void }) {
  const { addWallet } = useWallet();
  const [step, setStep] = useState<CreateStep>("generating");
  const [mnemonic, setMnemonic] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");

  /* Entropy + BIP-39 is synchronous and holds the JS thread for a beat, so the
     tap on "Create new account" used to sit there doing nothing and then land
     on a grid of twelve EMPTY tiles that filled in a moment later. Now the step
     starts as `generating`: the spinner paints first (the setTimeout is the
     yield that lets it), and the words only appear once they exist. */
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      try {
        const m = generateMnemonicOnly().mnemonic;
        if (!alive) return;
        setMnemonic(m);
        setStep("seed");
      } catch {
        if (!alive) return;
        setErr("Couldn't generate a seed phrase.");
        setStep("seed");
      }
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  async function save() {
    setStep("saving");
    setErr("");
    try {
      /* Derivation and PBKDF2 are synchronous and hold the JS thread for
         seconds. Yield first so the spinner is actually on screen before it
         locks up, or the button looks dead. Same trick as CreateWallet. */
      await new Promise((r) => setTimeout(r, 50));
      const fullWallet = await importFromMnemonic(mnemonic);
      await addWallet({ name: label.trim() || "Account", fullWallet });
      setStep("done");
      setTimeout(onDone, 800);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save the account.");
      setStep("name");
    }
  }

  if (step === "generating")
    return <Saving t={t} label="Conjuring a fresh seed phrase…" />;
  if (step === "saving") return <Saving t={t} />;
  if (step === "done") return <Done t={t} label={label.trim() || "Account"} />;
  if (step === "name")
    return (
      <NameStep
        t={t}
        label={label}
        setLabel={setLabel}
        err={err}
        onContinue={save}
        cta="Create account"
      />
    );

  const words = mnemonic ? mnemonic.split(" ") : Array.from({ length: 12 }, () => "");
  return (
    <View>
      <Kicker t={t}>STEP 01 · SEED</Kicker>
      <Title t={t}>Save these 12 words</Title>
      <Lede t={t}>They are the only way to recover this account. Write them down in order.</Lede>

      <View style={styles.grid}>
        {words.map((w, i) => (
          <View
            key={i}
            style={[styles.word, { backgroundColor: t.glass, borderColor: t.glassLine }]}>
            <Text style={[styles.wordNum, { color: rgba(t.inkRgb, 0.45) }]}>{i + 1}</Text>
            <Text style={[styles.wordText, { color: t.ink }]} numberOfLines={1}>
              {w}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={async () => {
          if (!mnemonic) return;
          await Clipboard.setStringAsync(mnemonic);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        style={({ pressed }) => [
          styles.ghost,
          { borderColor: pressed ? rgba(t.inkRgb, 0.5) : rgba(t.inkRgb, 0.28) },
        ]}>
        <Text style={[styles.ghostText, { color: rgba(t.inkRgb, 0.75) }]}>
          {copied ? "COPIED" : "COPY PHRASE"}
        </Text>
      </Pressable>

      <Pressable onPress={() => setConfirmed((v) => !v)} style={styles.check} hitSlop={8}>
        <View
          style={[
            styles.checkBox,
            {
              backgroundColor: confirmed ? t.ink : t.glass,
              borderColor: confirmed ? t.ink : rgba(t.inkRgb, 0.3),
            },
          ]}>
          {confirmed && (
            <Svg width={12} height={9} viewBox="0 0 10 8" fill="none">
              <Path
                d="M1 4L3.5 6.5L9 1"
                stroke={t.onInk}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          )}
        </View>
        <Text style={[styles.checkText, { color: rgba(t.inkRgb, 0.75) }]}>
          I've saved this phrase somewhere safe.
        </Text>
      </Pressable>

      <ErrText t={t}>{err}</ErrText>
      <Primary t={t} disabled={!confirmed || !mnemonic} onPress={() => setStep("name")}>
        Continue
      </Primary>
    </View>
  );
}

/* ───────────────────────────── import ───────────────────────────── */

function ImportFlow({ t, onDone }: { t: Tokens; onDone: () => void }) {
  const { addWallet } = useWallet();
  const [step, setStep] = useState<ImportStep>("method");
  const [method, setMethod] = useState<ImportMethod>("seed");
  const [net, setNet] = useState<PkNetwork>("ethereum");
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [derived, setDerived] = useState<FullWallet | null>(null);
  const [err, setErr] = useState("");

  async function derive() {
    const val = input.trim();
    if (!val) {
      setErr(`Enter your ${method === "seed" ? "seed phrase" : "private key"}.`);
      return;
    }
    setErr("");
    try {
      let w: FullWallet;
      if (method === "seed") {
        const n = val.split(/\s+/).length;
        if (n !== 12 && n !== 24) {
          setErr("A seed phrase is 12 or 24 words.");
          return;
        }
        w = await importFromMnemonic(val);
      } else {
        w = await importFromPrivateKey(val, net);
      }
      setDerived(w);
      setStep("name");
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't read those keys.");
    }
  }

  async function save() {
    if (!derived) return;
    setStep("saving");
    setErr("");
    try {
      await new Promise((r) => setTimeout(r, 50));
      await addWallet({ name: label.trim() || "Account", fullWallet: derived });
      setStep("done");
      setTimeout(onDone, 800);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't save the account.");
      setStep("name");
    }
  }

  if (step === "saving") return <Saving t={t} />;
  if (step === "done") return <Done t={t} label={label.trim() || "Account"} />;
  if (step === "name")
    return (
      <NameStep
        t={t}
        label={label}
        setLabel={setLabel}
        err={err}
        onContinue={save}
        cta="Import account"
      />
    );

  if (step === "method")
    return (
      <View>
        <Kicker t={t}>STEP 01 · METHOD</Kicker>
        <Title t={t}>How would you like to import?</Title>
        <View style={{ gap: 10, marginTop: 20 }}>
          {(
            [
              ["seed", "📜", "Seed phrase", "12 or 24 words"],
              ["privatekey", "🔑", "Private key", "one chain's key"],
            ] as const
          ).map(([m, icon, title, sub]) => {
            const on = method === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                style={[
                  styles.optionCard,
                  {
                    backgroundColor: on ? rgba(t.inkRgb, 0.1) : t.glass,
                    borderColor: on ? rgba(t.inkRgb, 0.42) : t.glassLine,
                  },
                ]}>
                <Text style={styles.optionEmoji}>{icon}</Text>
                <View style={styles.fill}>
                  <Text style={[styles.optionTitle, { color: t.ink }]}>{title}</Text>
                  <Text style={[styles.optionSub, { color: rgba(t.inkRgb, 0.6) }]}>{sub}</Text>
                </View>
                {on && <View style={[styles.dot, { backgroundColor: t.ink }]} />}
              </Pressable>
            );
          })}
        </View>
        <Primary t={t} onPress={() => setStep("input")}>
          Continue
        </Primary>
      </View>
    );

  return (
    <View>
      <Kicker t={t}>STEP 02 · {method === "seed" ? "SEED" : "KEY"}</Kicker>
      <Title t={t}>Enter your {method === "seed" ? "recovery phrase" : "private key"}</Title>

      {method === "privatekey" && (
        <View style={{ marginTop: 18 }}>
          <Label t={t}>SELECT NETWORK</Label>
          <View style={styles.netRow}>
            {PK_NETWORKS.map(([id, name]) => {
              const on = net === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => {
                    setNet(id);
                    setErr("");
                  }}
                  style={[
                    styles.netBtn,
                    {
                      backgroundColor: on ? t.ink : t.glass,
                      borderColor: on ? t.ink : t.glassLine,
                    },
                  ]}>
                  <Text
                    style={[styles.netText, { color: on ? t.onInk : rgba(t.inkRgb, 0.7) }]}
                    numberOfLines={1}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={{ marginTop: 18 }}>
        <TextInput
          value={input}
          onChangeText={(v) => {
            setInput(v);
            setErr("");
          }}
          placeholder={method === "seed" ? "word1 word2 word3 …" : "Paste private key…"}
          placeholderTextColor={rgba(t.inkRgb, 0.38)}
          multiline={method === "seed"}
          numberOfLines={method === "seed" ? 4 : 1}
          textAlignVertical={method === "seed" ? "top" : "center"}
          secureTextEntry={method === "privatekey"}
          autoCapitalize="none"
          autoCorrect={false}
          underlineColorAndroid="transparent"
          importantForAutofill="no"
          style={[
            styles.input,
            method === "seed" && styles.inputTall,
            { backgroundColor: t.glass, borderColor: t.glassLine, color: t.ink },
          ]}
        />
      </View>

      <ErrText t={t}>{err}</ErrText>
      <Primary t={t} onPress={derive}>
        Continue
      </Primary>
    </View>
  );
}

/* ───────────────────────── shared steps ───────────────────────── */

function NameStep({
  t,
  label,
  setLabel,
  err,
  onContinue,
  cta,
}: {
  t: Tokens;
  label: string;
  setLabel: (v: string) => void;
  err: string;
  onContinue: () => void;
  cta: string;
}) {
  return (
    <View>
      <Kicker t={t}>NAME YOUR ACCOUNT</Kicker>
      <Title t={t}>Pick a label</Title>
      <Lede t={t}>A private in-wallet label. Only you ever see it.</Lede>
      <View style={{ marginTop: 22 }}>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="My Second Account"
          placeholderTextColor={rgba(t.inkRgb, 0.38)}
          returnKeyType="done"
          onSubmitEditing={() => label.trim() && onContinue()}
          underlineColorAndroid="transparent"
          importantForAutofill="no"
          style={[styles.input, { backgroundColor: t.glass, borderColor: t.glassLine, color: t.ink }]}
        />
      </View>
      <ErrText t={t}>{err}</ErrText>
      <Primary t={t} disabled={!label.trim()} onPress={onContinue}>
        {cta}
      </Primary>
    </View>
  );
}

function Saving({ t, label }: { t: Tokens; label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={t.ink} />
      <Text style={[styles.centeredText, { color: rgba(t.inkRgb, 0.7) }]}>
        {label ?? "Deriving keys and sealing the account…"}
      </Text>
    </View>
  );
}

function Done({ t, label }: { t: Tokens; label: string }) {
  return (
    <View style={styles.centered}>
      <View style={styles.tick}>
        <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
          <Path
            d="M5 12L10 17L19 7"
            stroke="#059669"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Kicker t={t}>ALL SET</Kicker>
      <Text style={[styles.doneTitle, { color: t.ink }]}>{label} added</Text>
      <Text style={[styles.centeredText, { color: rgba(t.inkRgb, 0.6) }]}>
        Switching to the new account…
      </Text>
    </View>
  );
}

/* ───────────────────────── little pieces ───────────────────────── */

function Kicker({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <Text style={[styles.kicker, { color: rgba(t.inkRgb, 0.5) }]}>{children}</Text>;
}
function Title({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <Text style={[styles.title, { color: t.ink }]}>{children}</Text>;
}
function Lede({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <Text style={[styles.lede, { color: rgba(t.inkRgb, 0.62) }]}>{children}</Text>;
}
function Label({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <Text style={[styles.label, { color: rgba(t.inkRgb, 0.5) }]}>{children}</Text>;
}
function ErrText({ t, children }: { t: Tokens; children?: React.ReactNode }) {
  if (!children) return null;
  return <Text style={[styles.err, { color: COLORS.errorInk }]}>{children}</Text>;
}

function Primary({
  t,
  children,
  onPress,
  disabled,
}: {
  t: Tokens;
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: t.ink,
          opacity: disabled ? 0.38 : pressed ? 0.85 : 1,
        },
      ]}>
      <Text style={[styles.primaryText, { color: t.onInk }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 8, width: 86 },
  backText: { fontFamily: FONT.roundSemi, fontSize: 10, letterSpacing: 2.4 },
  headTitle: { fontFamily: FONT.roundBold, fontSize: 11, letterSpacing: 3 },

  kicker: { fontFamily: FONT.roundBold, fontSize: 9, letterSpacing: 3.4 },
  title: { fontFamily: FONT.roundBold, fontSize: 24, letterSpacing: -0.5, marginTop: 8 },
  lede: { fontFamily: FONT.body, fontSize: 14, lineHeight: 21, marginTop: 8 },
  label: { fontFamily: FONT.roundSemi, fontSize: 9, letterSpacing: 2.6, marginBottom: 8 },
  err: { fontFamily: FONT.roundSemi, fontSize: 13, marginTop: 14 },

  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  optionEmoji: { fontSize: 22 },
  optionTitle: { fontFamily: FONT.roundBold, fontSize: 15 },
  optionSub: { fontFamily: FONT.body, fontSize: 12, lineHeight: 17, marginTop: 3 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 20 },
  word: {
    flexBasis: "30%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  /* Wide enough for TWO digits. At 12 the mono "10" and "12" wrapped onto a
     second line and the tile grew a row taller than its neighbours. */
  wordNum: { fontFamily: FONT.mono, fontSize: 10, width: 17 },
  wordText: { fontFamily: FONT.roundSemi, fontSize: 13, flexShrink: 1 },

  ghost: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  ghostText: { fontFamily: FONT.roundSemi, fontSize: 10, letterSpacing: 2.6 },

  check: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: { flex: 1, fontFamily: FONT.body, fontSize: 13.5, lineHeight: 19 },

  netRow: { flexDirection: "row", gap: 7 },
  netBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 3,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
  },
  netText: { fontFamily: FONT.roundSemi, fontSize: 10.5 },

  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: FONT.body,
    fontSize: 14,
  },
  inputTall: { minHeight: 104, fontFamily: FONT.mono, fontSize: 13, lineHeight: 20 },

  primary: {
    marginTop: 26,
    paddingVertical: 16,
    borderRadius: 20,
    alignItems: "center",
  },
  primaryText: { fontFamily: FONT.roundBold, fontSize: 13, letterSpacing: 1.6 },

  centered: { alignItems: "center", paddingVertical: 54, gap: 10 },
  centeredText: { fontFamily: FONT.body, fontSize: 13.5, textAlign: "center" },
  doneTitle: { fontFamily: FONT.roundBold, fontSize: 20, marginTop: 2 },
  tick: {
    height: 60,
    width: 60,
    borderRadius: 30,
    backgroundColor: "rgba(5,150,105,0.14)",
    borderWidth: 1,
    borderColor: "rgba(5,150,105,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
});
