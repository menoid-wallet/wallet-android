/**
 * ImportWallet.tsx — onboarding for the FIRST wallet, via import.
 *   method   → seed phrase OR private key
 *   input    → paste it (+ pick the network for a private key)
 *   name     → local account label
 *   password → encrypt + store
 * On success it calls onImported(), and App hands over to the lock screen.
 */
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import bs58 from "bs58";
import { importFromMnemonic, importFromPrivateKey } from "../../crypto/keyDerivation";
import { passwordStrength } from "../../crypto/walletCrypto";
import { createInitialState } from "../../lib/wallets";
import { useBackHandler } from "../../lib/useBackHandler";
import { COLORS, FONT } from "../../theme/tokens";
import {
  CloudButton,
  ErrorText,
  Field,
  Kicker,
  Label,
  Lede,
  Note,
  Panel,
  SetupShell,
  StrengthMeter,
  TextArea,
  Title,
} from "./SetupUI";

type Method = "seed" | "privatekey";
type Net = "ethereum" | "solana" | "sui" | "aptos";
type Step = "method" | "input" | "name" | "password";
const ORDER: Step[] = ["method", "input", "name", "password"];

export default function ImportWallet({
  onBack,
  onImported,
}: {
  onBack: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>("seed");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [net, setNet] = useState<Net>("ethereum");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [saving, setSaving] = useState(false);

  const strength = passwordStrength(password);

  /* Android Back steps backwards through the flow; swallowed while saving. */
  const goBack = useCallback(() => {
    if (saving) return true;
    const i = ORDER.indexOf(step);
    if (i <= 0) onBack();
    else setStep(ORDER[i - 1]);
    return true;
  }, [step, saving, onBack]);
  useBackHandler(goBack);

  function validateInput(): boolean {
    setInputError("");
    const val = input.trim();
    if (!val) {
      setInputError("Please enter your " + (method === "seed" ? "seed phrase" : "private key"));
      return false;
    }
    if (method === "seed") {
      const n = val.split(/\s+/).length;
      if (n !== 12 && n !== 24) {
        setInputError("Seed phrase must be 12 or 24 words.");
        return false;
      }
      return true;
    }
    if (net === "ethereum" || net === "aptos") {
      if (!/^[0-9a-fA-F]{64}$/.test(val.replace(/^0x/, ""))) {
        setInputError(
          `Invalid ${net === "ethereum" ? "Ethereum" : "Aptos"} private key. Must be 64 hex characters.`
        );
        return false;
      }
    } else if (net === "solana") {
      try {
        const d = bs58.decode(val);
        if (d.length !== 64 && d.length !== 32) {
          setInputError("Invalid Solana private key length (must decode to 32 or 64 bytes).");
          return false;
        }
      } catch {
        setInputError("Invalid Solana private key (must be base58).");
        return false;
      }
    } else if (net === "sui") {
      if (!/^[0-9a-fA-F]{64}$/.test(val.replace(/^0x/, ""))) {
        setInputError("Invalid Sui private key. Must be 64 hex characters.");
        return false;
      }
    }
    return true;
  }

  async function handleSave() {
    if (password.length < 8) return setPwError("Password must be at least 8 characters.");
    if (password !== confirmPw) return setPwError("Passwords don't match.");
    setPwError("");
    setSaving(true);
    try {
      // let the spinner paint before the blocking crypto (see CreateWallet)
      await new Promise((r) => setTimeout(r, 50));
      const fullWallet =
        method === "seed"
          ? await importFromMnemonic(input.trim())
          : await importFromPrivateKey(input.trim(), net);
      await createInitialState({ name: name.trim() || "Account", password, fullWallet });
      onImported();
    } catch (e: any) {
      setPwError(e?.message ?? "Import failed. Check your credentials.");
      setSaving(false);
    }
  }

  return (
    <SetupShell
      steps={ORDER}
      step={step}
      onBack={goBack}>
      {step === "method" && (
        <Panel>
          <Kicker>Import wallet</Kicker>
          <Title>How would you like to import?</Title>
          <Lede>Choose the method you have to hand.</Lede>

          <View style={{ marginTop: 26, gap: 14 }}>
            {(
              [
                ["seed", "📜", "Seed phrase", "Restore using your 12 or 24 word recovery phrase."],
                ["privatekey", "🔑", "Private key", "Import directly with your wallet's private key."],
              ] as const
            ).map(([m, icon, title, desc]) => {
              const active = method === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMethod(m as Method)}
                  style={[styles.methodCard, active && styles.methodCardOn]}>
                  <Text style={{ fontSize: 26 }}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodTitle}>{title}</Text>
                    <Text style={styles.methodDesc}>{desc}</Text>
                  </View>
                  {active && (
                    <View style={styles.tick}>
                      <Svg width={12} height={9} viewBox="0 0 10 8" fill="none">
                        <Path
                          d="M1 4L3.5 6.5L9 1"
                          stroke={COLORS.violetDeep}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          <View style={{ marginTop: 26 }}>
            <CloudButton onPress={() => setStep("input")}>Continue</CloudButton>
          </View>
        </Panel>
      )}

      {step === "input" && (
        <Panel>
          <Kicker>{method === "seed" ? "Seed phrase" : "Private key"}</Kicker>
          <Title>Enter your {method === "seed" ? "recovery phrase" : "private key"}</Title>
          <Lede>
            {method === "seed"
              ? "Type or paste your 12 or 24 word seed phrase, separated by spaces."
              : "Paste your private key for the selected network."}
          </Lede>

          {method === "privatekey" && (
            <View style={{ marginTop: 24 }}>
              <Label>Select network</Label>
              <View style={{ flexDirection: "row", gap: 9 }}>
                {(
                  [
                    ["ethereum", "Ethereum"],
                    ["solana", "Solana"],
                    ["sui", "Sui"],
                    ["aptos", "Aptos"],
                  ] as const
                ).map(([n, l]) => {
                  const active = net === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => {
                        setNet(n);
                        setInputError("");
                      }}
                      style={[styles.netBtn, active && styles.netBtnOn]}>
                      <Text style={[styles.netText, active && styles.netTextOn]}>{l}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ marginTop: 24 }}>
            {method === "seed" ? (
              <TextArea
                value={input}
                onChangeText={setInput}
                placeholder="word1 word2 word3 … word12"
                autoCapitalize="none"
                autoCorrect={false}
                invalid={!!inputError}
              />
            ) : (
              <Field
                secureTextEntry
                value={input}
                onChangeText={setInput}
                placeholder="Paste private key…"
                autoCapitalize="none"
                autoCorrect={false}
                invalid={!!inputError}
                style={{ fontFamily: FONT.mono, fontSize: 15 }}
              />
            )}
            <ErrorText>{inputError}</ErrorText>
          </View>

          <View style={{ marginTop: 18 }}>
            <Note>This wallet stores data only on your device. Never enter credentials on websites.</Note>
          </View>

          <View style={{ marginTop: 26 }}>
            <CloudButton onPress={() => validateInput() && setStep("name")}>Continue</CloudButton>
          </View>
        </Panel>
      )}

      {step === "name" && (
        <Panel>
          <Kicker>Step 03</Kicker>
          <Title>Name your account</Title>
          <Lede>
            This is your private in-wallet label — only visible to you. You can change it anytime.
          </Lede>

          <View style={{ marginTop: 26 }}>
            <Label>Account label</Label>
            <Field
              value={name}
              onChangeText={setName}
              placeholder="My Main Account"
              returnKeyType="next"
              onSubmitEditing={() => name.trim() && setStep("password")}
            />
          </View>

          <View style={{ marginTop: 26 }}>
            <CloudButton disabled={!name.trim()} onPress={() => setStep("password")}>
              Continue
            </CloudButton>
          </View>
        </Panel>
      )}

      {step === "password" && (
        <Panel>
          <Kicker>Step 04</Kicker>
          <Title>Secure your wallet</Title>
          <Lede>Set a password to encrypt your keys on this device.</Lede>

          <View style={{ marginTop: 26 }}>
            <Label>Password</Label>
            <Field
              secureTextEntry
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
            <Field
              secureTextEntry
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
              {saving ? "Saving…" : "Import wallet"}
            </CloudButton>
          </View>
        </Panel>
      )}
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderRadius: 20,
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  methodCardOn: {
    backgroundColor: "rgba(255,255,255,0.26)",
    borderColor: "rgba(255,255,255,0.58)",
  },
  methodTitle: { fontFamily: FONT.roundBold, fontSize: 18, color: "#fff" },
  methodDesc: {
    fontFamily: FONT.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: "rgba(255,255,255,0.7)",
    marginTop: 3,
  },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  netBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  netBtnOn: { backgroundColor: "#fff", borderColor: "#fff" },
  netText: { fontFamily: FONT.roundSemi, fontSize: 12.5, color: "rgba(255,255,255,0.78)" },
  netTextOn: { color: COLORS.violetDeep },
});
