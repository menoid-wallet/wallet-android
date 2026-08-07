/**
 * SendModal.tsx — open-mode send.
 *
 * Ported from the extension's shared/SendModal.tsx, phase for phase:
 *
 *   form       — the mark DOZES until you type an address, then wakes up;
 *                live-validated recipient + amount, a cloud confirm button
 *   submitting — the mark WATCHES the voyage cloud drift; no way out
 *   success    — the mark WINKS; the hash, a Done button, an explorer link
 *   error      — back to the form with the reason and a "Try Again"
 *
 * The one deliberate departure is the sheet: the extension's went fullscreen
 * for the form because a browser popup is 360×600 and had nowhere else to put
 * a keyboard. A phone sheet just sizes to its content and lets the keyboard
 * push it up.
 *
 * VALIDATION IS PER-CHAIN, not "does it look like an address" — an EVM checksum
 * test would reject every Solana address the user could legitimately paste.
 */

import React, { memo, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { ethers, isAddress } from "ethers";
import Svg, { Path } from "react-native-svg";
import { explorerTxUrl, sendNative } from "../../lib/rpc";
import { NETWORKS, type NetworkId } from "../../lib/networks";
import { saveOpenTx, updateOpenTx } from "../../lib/txStore";
import AnimatedLogo from "../brand/AnimatedLogo";
import CloudChip from "../brand/CloudChip";
import CloudVoyage from "./CloudVoyage";
import LiquidSheet from "./LiquidSheet";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba } from "../../theme/useThemeTokens";

const INK = COLORS.violetDeep;
const INK_RGB = "78,47,142";
const OK = "#1F7A55";
const BAD = "#B2382A";

type Phase = "form" | "submitting" | "success" | "error";
type AmountStatus = "" | "ok" | "over" | "bad";
type AddrStatus = "" | "ok" | "bad";

function isValidAddressForChain(address: string, network: NetworkId): boolean {
  const clean = address.trim();
  if (!clean) return false;
  if (network === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  if (network === "sui" || network === "aptos") return /^0x[0-9a-fA-F]{1,64}$/.test(clean);
  return isAddress(clean);
}

/** Smallest-unit decimals per chain — what the log entry's hex value is in. */
function decimalsFor(network: NetworkId): number {
  if (network === "solana" || network === "sui") return 9;
  if (network === "aptos") return 8;
  return 18;
}

export default memo(function SendModal({
  open,
  onClose,
  network,
  fromAddress,
  privateKey,
  balance,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  network: NetworkId;
  fromAddress: string;
  privateKey: string;
  balance: string;
  onSent?: (hash: string) => void;
}) {
  const { width: winW } = useWindowDimensions();
  const symbol = NETWORKS[network].nativeCurrency;

  const [phase, setPhase] = useState<Phase>("form");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [submitErr, setSubmitErr] = useState("");
  const [txHash, setTxHash] = useState("");

  // Reset only AFTER the sheet has finished sliding away — resetting on close
  // rewrites the form under the user while they can still see it.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setPhase("form");
      setTo("");
      setAmount("");
      setSubmitErr("");
      setTxHash("");
    }, 320);
    return () => clearTimeout(t);
  }, [open]);

  const addrStatus: AddrStatus = useMemo(() => {
    const v = to.trim();
    if (!v) return "";
    return isValidAddressForChain(v, network) ? "ok" : "bad";
  }, [to, network]);

  const amountStatus: AmountStatus = useMemo(() => {
    const v = amount.trim();
    if (!v) return "";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "bad";
    const bal = Number(balance);
    if (Number.isFinite(bal) && n > bal) return "over";
    return "ok";
  }, [amount, balance]);

  const canSubmit = addrStatus === "ok" && amountStatus === "ok";

  async function handleSend() {
    if (!canSubmit) return;
    setSubmitErr("");
    setPhase("submitting");
    try {
      const r = await sendNative(privateKey, to.trim(), amount.trim(), network);
      setTxHash(r.hash);
      setPhase("success");
      onSent?.(r.hash);

      const parsed = ethers.parseUnits(amount.trim(), decimalsFor(network));
      // Saved immediately so the log shows it right away, then patched with the
      // gas once the receipt lands (EVM only — the others report none).
      saveOpenTx(fromAddress, {
        type: "open",
        txHash: r.hash,
        gasUsed: null,
        to: to.trim(),
        value: "0x" + parsed.toString(16),
        functionName: "Transfer",
        timestamp: Date.now(),
      });
      r.wait()
        .then((receipt) => {
          if (receipt?.gasUsed) updateOpenTx(fromAddress, r.hash, { gasUsed: receipt.gasUsed });
        })
        .catch(() => {});
    } catch (e: any) {
      console.error("[SendModal] send failed:", e);
      setSubmitErr(e?.shortMessage ?? e?.message ?? "Transaction failed. Try again.");
      setPhase("error");
    }
  }

  const isSuccess = phase === "success";
  const isSubmitting = phase === "submitting";

  const fieldBorder = (s: AddrStatus | AmountStatus) =>
    s === "bad" || s === "over" ? "rgba(178,56,42,0.45)" : s === "ok" ? "rgba(31,122,85,0.4)" : rgba(INK_RGB, 0.12);

  return (
    <LiquidSheet open={open} onClose={onClose} tone="cream" disableDrag={isSubmitting}>
      {isSuccess ? (
        /* ── SUCCESS ── */
        <View style={styles.pad}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>SEND TREASURE</Text>
            <Text style={styles.title}>Delivered! ✦</Text>
            <Text style={styles.sub}>Your treasure reached the port.</Text>
          </View>

          <View style={styles.centre}>
            <AnimatedLogo size={118} expression="wink" style={{ marginBottom: 16 }} />

            <View style={styles.receipt}>
              <View style={styles.receiptTick}>
                <Svg width={14} height={14} viewBox="0 0 14 14">
                  <Path
                    d="M2 7L5.5 10.5L12 4"
                    stroke="#059669"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </Svg>
              </View>
              <View style={styles.receiptText}>
                <Text style={styles.receiptTitle}>Transaction broadcast</Text>
                <Text style={styles.receiptHash}>{txHash}</Text>
              </View>
            </View>

            <Pressable onPress={onClose} style={styles.done}>
              <Text style={styles.doneLabel}>DONE</Text>
            </Pressable>

            <Pressable onPress={() => void Linking.openURL(explorerTxUrl(txHash, network))}>
              <Text style={styles.explorer}>VIEW ON EXPLORER</Text>
            </Pressable>
          </View>
        </View>
      ) : isSubmitting ? (
        /* ── SUBMITTING ── */
        <View style={styles.pad}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>SEND TREASURE</Text>
            <Text style={styles.title}>Sending…</Text>
            <Text style={styles.sub}>Your treasure is on its way.</Text>
          </View>
          <View style={styles.centre}>
            <AnimatedLogo size={116} expression="waiting" />
            <View style={{ width: Math.min(300, winW - 80), marginTop: 18 }}>
              <CloudVoyage tone="light" label="VOYAGE IN PROGRESS…" width={Math.min(300, winW - 80)} />
            </View>
          </View>
        </View>
      ) : (
        /* ── FORM ── */
        <View style={styles.pad}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>SEND TREASURE</Text>
            <Text style={styles.title}>{phase === "error" ? "Storm rolled in." : `Send ${symbol}`}</Text>
            <Text style={styles.sub}>
              Balance: {Number(balance).toFixed(4)} {symbol}
            </Text>
          </View>

          {/* the mark dozes until an address is typed, then wakes up */}
          <View style={styles.markBay}>
            <AnimatedLogo size={104} expression={to.trim() ? "awake" : "sleeping"} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>RECIPIENT ADDRESS</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder={network === "solana" ? "Base58 address…" : "0x…"}
              placeholderTextColor={rgba(INK_RGB, 0.3)}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.mono, { borderColor: fieldBorder(addrStatus) }]}
            />
            {addrStatus === "bad" && <Text style={styles.err}>Not a valid address.</Text>}
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>AMOUNT ({symbol})</Text>
              <Pressable
                onPress={() => {
                  const n = Number(balance);
                  if (!Number.isFinite(n) || n <= 0) return setAmount("0");
                  setAmount(Math.max(0, n - 0.001).toFixed(6).replace(/\.?0+$/, ""));
                }}
                hitSlop={8}>
                <Text style={styles.max}>MAX</Text>
              </Pressable>
            </View>
            <TextInput
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
              placeholder="0.00"
              placeholderTextColor={rgba(INK_RGB, 0.3)}
              keyboardType="decimal-pad"
              style={[styles.input, styles.mono, { fontSize: 14, borderColor: fieldBorder(amountStatus) }]}
            />
            {amountStatus === "bad" && <Text style={styles.err}>Enter a positive number.</Text>}
            {amountStatus === "over" && (
              <Text style={styles.err}>
                Exceeds balance ({Number(balance).toFixed(4)} {symbol} available).
              </Text>
            )}
          </View>

          <View style={styles.fromRow}>
            <Text style={styles.fromLabel}>FROM</Text>
            <Text style={styles.fromValue}>
              {fromAddress.slice(0, 6)}…{fromAddress.slice(-4)}
            </Text>
          </View>

          {!!submitErr && (
            <View style={styles.errBox}>
              <Text style={styles.errBoxText}>{submitErr}</Text>
            </View>
          )}

          <View style={styles.footer}>
            <CloudChip
              tone="violet"
              onPress={handleSend}
              disabled={!canSubmit}
              fullWidth
              lobeBase={26}
              contentStyle={styles.sendContent}>
              <Text style={styles.sendLabel}>{phase === "error" ? "TRY AGAIN" : "SEND"}</Text>
            </CloudChip>
          </View>
        </View>
      )}
    </LiquidSheet>
  );
});

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 24, paddingTop: 2 },
  head: { alignItems: "center", paddingBottom: 6 },
  eyebrow: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 4, color: rgba(INK_RGB, 0.7), marginBottom: 4 },
  title: { fontFamily: FONT.roundBold, fontSize: 20, color: "#3B2570", letterSpacing: -0.3 },
  sub: { fontFamily: FONT.body, fontSize: 11, color: rgba(INK_RGB, 0.6), marginTop: 4 },

  markBay: { alignItems: "center", paddingVertical: 4 },
  centre: { alignItems: "center", paddingTop: 8, paddingBottom: 18 },

  field: { marginTop: 12 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 2.6, color: rgba(INK_RGB, 0.55), marginBottom: 6 },
  max: { fontFamily: FONT.roundBold, fontSize: 9, letterSpacing: 1.6, color: rgba(INK_RGB, 0.75), marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: INK,
    backgroundColor: rgba(INK_RGB, 0.06),
  },
  mono: { fontFamily: FONT.mono },
  err: { fontFamily: FONT.body, fontSize: 10, color: BAD, marginTop: 4 },

  fromRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
  },
  fromLabel: { fontFamily: FONT.body, fontSize: 10, letterSpacing: 2.6, color: rgba(INK_RGB, 0.55) },
  fromValue: { fontFamily: FONT.mono, fontSize: 11, color: rgba(INK_RGB, 0.75) },

  errBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(178,56,42,0.1)",
    borderWidth: 1,
    borderColor: "rgba(178,56,42,0.2)",
  },
  errBoxText: { fontFamily: FONT.body, fontSize: 11, color: BAD },

  footer: { marginTop: 22, paddingTop: 4, paddingBottom: 8 },
  sendContent: { paddingVertical: 13 },
  sendLabel: { fontFamily: FONT.roundBold, fontSize: 12, letterSpacing: 2.4, color: "#F4EEFF" },

  receipt: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(5,150,105,0.1)",
    borderWidth: 1,
    borderColor: "rgba(5,150,105,0.25)",
    marginBottom: 18,
  },
  receiptTick: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: "rgba(5,150,105,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptText: { flex: 1, minWidth: 0 },
  receiptTitle: { fontFamily: FONT.bodySemi, fontSize: 12, color: "#047857" },
  receiptHash: { fontFamily: FONT.mono, fontSize: 10, color: rgba(INK_RGB, 0.6), marginTop: 4 },

  done: {
    width: "100%",
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: INK,
    alignItems: "center",
  },
  doneLabel: { fontFamily: FONT.roundSemi, fontSize: 11, letterSpacing: 3, color: "#F4EEFF" },
  explorer: {
    fontFamily: FONT.body,
    fontSize: 10,
    letterSpacing: 2.2,
    color: rgba(INK_RGB, 0.5),
    marginTop: 14,
  },
});
