/**
 * CreateWallet.tsx — onboarding for the FIRST wallet.
 *   seed     → show the generated 12-word phrase, confirm "I've saved it"
 *   name     → a local account label
 *   password → set the encryption password (derive → encrypt → store)
 * On success it calls onCreated(), and App hands over to the lock screen.
 */
import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Path } from "react-native-svg";
import { importFromMnemonic } from "../../crypto/keyDerivation";
import { passwordStrength } from "../../crypto/walletCrypto";
import { createInitialState } from "../../lib/wallets";
import { useBackHandler } from "../../lib/useBackHandler";
import { COLORS, FONT } from "../../theme/tokens";
import {
  CloudButton,
  ErrorText,
  Field,
  GhostButton,
  Kicker,
  Label,
  Lede,
  Note,
  Panel,
  PasswordInput,
  SetupShell,
  StrengthMeter,
  Title,
} from "./SetupUI";

type Step = "seed" | "name" | "password";
const ORDER: Step[] = ["seed", "name", "password"];

export default function CreateWallet({
  mnemonic,
  genError,
  onBack,
  onCreated,
}: {
  /** Prepared by Welcome BEFORE this screen mounts, and cached there for the
   *  session — so arriving here costs nothing and the stage transition is
   *  never competing with entropy + BIP-39 work. */
  mnemonic: string;
  genError?: string;
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<Step>("seed");
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingLabel, setSavingLabel] = useState("Saving…");

  const strength = passwordStrength(password);

  /* Android Back steps backwards through the flow instead of leaving the app.
     While the keys are being derived/encrypted it is swallowed entirely — the
     wallet is mid-write and unmounting here would lose it. */
  /* Which way the next step should slide. Forward pushes the new step in from
     the right; Back reverses it, so the flow reads as one strip you move along. */
  const dir = useRef<"forward" | "back">("forward");
  const goTo = useCallback((next: Step) => {
    dir.current = "forward";
    setStep(next);
  }, []);
  const goBack = useCallback(() => {
    if (saving) return true;
    const i = ORDER.indexOf(step);
    if (i <= 0) {
      onBack();
    } else {
      dir.current = "back";
      setStep(ORDER[i - 1]);
    }
    return true;
  }, [step, saving, onBack]);
  useBackHandler(goBack);

  async function copyPhrase() {
    if (!mnemonic) return;
    await Clipboard.setStringAsync(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave() {
    if (password.length < 8) return setPwError("Password must be at least 8 characters.");
    if (password !== confirmPw) return setPwError("Passwords don't match.");
    setPwError("");
    setSaving(true);
    try {
      setSavingLabel("Deriving keys…");
      // Let React paint the spinner FIRST. Key derivation and PBKDF2 are
      // synchronous and block the JS thread for seconds — without this yield
      // the button never visibly changes and the app looks frozen/dead.
      await new Promise((r) => setTimeout(r, 50));
      const fullWallet = await importFromMnemonic(mnemonic);
      setSavingLabel("Encrypting…");
      await new Promise((r) => setTimeout(r, 50));
      await createInitialState({ name: label.trim() || "Account", password, fullWallet });
      onCreated();
    } catch (e: any) {
      setPwError(e?.message ?? "Unknown error");
      setSaving(false);
    }
  }

  const words = mnemonic ? mnemonic.split(" ") : [];

  return (
    <SetupShell
      steps={ORDER}
      step={step}
      direction={dir.current}
      onBack={goBack}>
      {step === "seed" && (
        <Panel>
          <Kicker>Step 01</Kicker>
          <Title>Your secret recovery phrase</Title>
          <Lede>
            Write these 12 words down in order and keep them safe. This is the only way to recover
            your wallet.
          </Lede>

          {genError ? (
            <ErrorText>{genError}</ErrorText>
          ) : (
            <View style={styles.grid}>
              {(words.length ? words : Array.from({ length: 12 }).map(() => "")).map((w, i) => (
                <View key={i} style={styles.word}>
                  <Text style={styles.wordNum}>{i + 1}</Text>
                  <Text style={styles.wordText} numberOfLines={1}>
                    {w}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ marginTop: 18 }}>
            <GhostButton onPress={copyPhrase} disabled={!mnemonic}>
              {copied ? "Copied to clipboard" : "Copy phrase"}
            </GhostButton>
          </View>

          <View style={{ marginTop: 16 }}>
            <Note>
              Never share your recovery phrase. Anyone who has it has full access to your wallet.
            </Note>
          </View>

          <Pressable onPress={() => setConfirmed((v) => !v)} style={styles.check} hitSlop={8}>
            <View style={[styles.box, confirmed && styles.boxOn]}>
              {confirmed && (
                <Svg width={13} height={10} viewBox="0 0 10 8" fill="none">
                  <Path
                    d="M1 4L3.5 6.5L9 1"
                    stroke={COLORS.violetDeep}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </View>
            <Text style={styles.checkText}>I've saved my recovery phrase somewhere safe.</Text>
          </Pressable>

          <View style={{ marginTop: 24 }}>
            <CloudButton disabled={!confirmed || !mnemonic} onPress={() => goTo("name")}>
              Continue
            </CloudButton>
          </View>
        </Panel>
      )}

      {step === "name" && (
        <Panel>
          <Kicker>Step 02</Kicker>
          <Title>Name your account</Title>
          <Lede>
            This is your private in-wallet label — only visible to you. You can change it anytime.
          </Lede>

          <View style={{ marginTop: 26 }}>
            <Label>Account label</Label>
            <Field
              value={label}
              onChangeText={setLabel}
              placeholder="My Main Account"
              returnKeyType="next"
              onSubmitEditing={() => label.trim() && goTo("password")}
            />
          </View>

          <View style={{ marginTop: 26 }}>
            <CloudButton disabled={!label.trim()} onPress={() => goTo("password")}>
              Continue
            </CloudButton>
          </View>
        </Panel>
      )}

      {step === "password" && (
        <Panel>
          <Kicker>Step 03</Kicker>
          <Title>Secure your wallet</Title>
          <Lede>This password encrypts your keys on this device. It cannot be recovered.</Lede>

          <View style={{ marginTop: 26 }}>
            <Label>Password</Label>
            <PasswordInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setPwError("");
              }}
              placeholder="Enter password"
            />
            {password.length > 0 && (
              <StrengthMeter score={strength.score} label={strength.label} color={strength.color} />
            )}
          </View>

          <View style={{ marginTop: 22 }}>
            <Label>Confirm password</Label>
            <PasswordInput
              value={confirmPw}
              invalid={confirmPw.length > 0 && password !== confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Re-enter password"
            />
            {confirmPw.length > 0 && password !== confirmPw && (
              <ErrorText>Passwords don't match</ErrorText>
            )}
          </View>

          <ErrorText>{pwError}</ErrorText>

          <View style={{ marginTop: 26 }}>
            <CloudButton
              loading={saving}
              disabled={saving || strength.score < 2 || password !== confirmPw || !password}
              onPress={handleSave}>
              {saving ? savingLabel : "Create wallet"}
            </CloudButton>
          </View>
        </Panel>
      )}
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 20, gap: 8 },
  /* Three to a row. The padding/gap/number column are kept tight so the
     longest BIP-39 words ("acoustic", "advance") still fit unclipped. */
  word: {
    flexBasis: "30%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  wordNum: { fontFamily: FONT.mono, fontSize: 10.5, color: "rgba(255,255,255,0.5)", width: 13 },
  wordText: { fontFamily: FONT.roundSemi, fontSize: 14, color: "#fff", flexShrink: 1 },

  check: { flexDirection: "row", alignItems: "flex-start", gap: 13, marginTop: 20 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: "#fff", borderColor: "#fff" },
  checkText: {
    flex: 1,
    fontFamily: FONT.body,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.82)",
  },
});
