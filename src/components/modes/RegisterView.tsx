/**
 * RegisterView.tsx — the door into privacy mode.
 *
 * Ported from the extension's components/modes/RegisterView.tsx.
 *
 *   pick the chains to bind → Register → each one signs register(commitment)
 *   locally and the backend relays it.
 *
 * A CHAIN IS ONLY SELECTABLE IF IT HAS AN OPEN-MODE BALANCE. Registration is a
 * real transaction and the user pays its gas from that chain's own account, so
 * an unfunded chain would fail at broadcast with a confusing error. Better to
 * say "No balance" up front than to let them tap it.
 *
 * The "?" reveals the repair path: the same seed registered on another device
 * is already registered on-chain, and Verify finds that instead of charging for
 * it twice.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWallet } from "../../context/WalletContext";
import { getBalance } from "../../lib/rpc";
import { CHAINS, type ChainMeta } from "../../lib/chains";
import { type NetworkId } from "../../lib/networks";
import { registerOnChain, verifyAndRepair } from "../../services/register";
import { setChainRegistered } from "../../lib/registration";
import { FONT } from "../../theme/tokens";

type ChainState = "idle" | "registering" | "done" | "error";

const INK = "244,238,255";

function realAddressFor(wallet: any, id: NetworkId): string | undefined {
  if (id === "solana") return wallet?.solanaAccount?.address;
  if (id === "sui") return wallet?.suiAccount?.address;
  if (id === "aptos") return wallet?.aptosAccount?.address;
  return wallet?.normalAccount?.address;
}

export default function RegisterView({
  onDone,
  onSkip,
  chainsToShow,
}: {
  /** At least one chain registered. */
  onDone: () => void;
  /** "Not now" — show me the dashboard anyway, with Register on every bar. */
  onSkip: () => void;
  /** Restrict to a subset — the dashboard passes the still-unregistered ones. */
  chainsToShow?: NetworkId[];
}) {
  const { wallet } = useWallet();
  const insets = useSafeAreaInsets();

  const chains = useMemo<ChainMeta[]>(
    () => (chainsToShow ? CHAINS.filter((c) => chainsToShow.includes(c.id)) : CHAINS),
    [chainsToShow]
  );

  const [openBalances, setOpenBalances] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<NetworkId>>(new Set());
  const [states, setStates] = useState<Record<string, ChainState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showAlready, setShowAlready] = useState(false);
  const [verifying, setVerifying] = useState<NetworkId | null>(null);
  const [hidden, setHidden] = useState<Set<NetworkId>>(new Set());

  useEffect(() => {
    if (!wallet) return;
    let alive = true;
    void (async () => {
      const out: Record<string, number> = {};
      await Promise.all(
        chains.map(async (c) => {
          const addr = realAddressFor(wallet, c.id);
          if (!addr) {
            out[c.id] = 0;
            return;
          }
          try {
            out[c.id] = Number(await getBalance(addr, c.id)) || 0;
          } catch {
            out[c.id] = 0;
          }
        })
      );
      if (alive) setOpenBalances(out);
    })();
    return () => {
      alive = false;
    };
  }, [wallet, chains]);

  const visible = useMemo(() => chains.filter((c) => !hidden.has(c.id)), [chains, hidden]);
  const anyFunded = visible.some((c) => (openBalances[c.id] ?? 0) > 0);

  const toggle = useCallback((id: NetworkId, funded: boolean) => {
    if (!funded) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const register = useCallback(async () => {
    if (!wallet || selected.size === 0 || busy) return;
    setBusy(true);
    let anyDone = false;
    for (const id of selected) {
      setStates((s) => ({ ...s, [id]: "registering" }));
      setErrors((e) => ({ ...e, [id]: "" }));
      try {
        await registerOnChain(wallet, id);
        setStates((s) => ({ ...s, [id]: "done" }));
        anyDone = true;
      } catch (err: any) {
        const msg = err?.message || "Registration failed";
        // Already on-chain is a success, not a failure — cache it and move on.
        if (/already registered/i.test(msg)) {
          const addr = realAddressFor(wallet, id);
          if (addr) await setChainRegistered(addr, id, true);
          setStates((s) => ({ ...s, [id]: "done" }));
          anyDone = true;
        } else {
          setStates((s) => ({ ...s, [id]: "error" }));
          setErrors((e) => ({ ...e, [id]: msg }));
        }
      }
    }
    setBusy(false);
    if (anyDone) setTimeout(onDone, 900);
  }, [wallet, selected, busy, onDone]);

  const checkAlready = useCallback(
    async (id: NetworkId) => {
      if (!wallet) return;
      setVerifying(id);
      try {
        if (await verifyAndRepair(wallet, id)) {
          setHidden((h) => new Set(h).add(id));
          setSelected((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        } else {
          setErrors((e) => ({ ...e, [id]: "Not registered on-chain yet." }));
        }
      } catch (err: any) {
        setErrors((e) => ({ ...e, [id]: err?.message || "Check failed" }));
      } finally {
        setVerifying(null);
      }
    },
    [wallet]
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.kicker}>PRIVATE MODE</Text>
          <Text style={styles.title}>Register to unlock{"\n"}privacy mode</Text>
          <Text style={styles.lede}>
            Bind your wallet to a private identity on the chains you choose. Only funded chains can
            register.
          </Text>
        </View>
        <Pressable onPress={() => setShowAlready((v) => !v)} hitSlop={10} style={styles.help}>
          <Svg width={13} height={13} viewBox="0 0 16 16" fill="none">
            <Circle cx={8} cy={8} r={6.4} stroke={`rgba(${INK},0.92)`} strokeWidth={1.3} />
            <Path
              d="M6.4 6.2a1.6 1.6 0 1 1 2.2 1.5c-.5.25-.9.5-.9 1.1v.3"
              stroke={`rgba(${INK},0.92)`}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
            <Circle cx={8} cy={11.4} r={0.75} fill={`rgba(${INK},0.92)`} />
          </Svg>
        </Pressable>
      </View>

      {showAlready && (
        <View style={styles.note}>
          <Text style={styles.noteText}>
            Already registered on another device? Tap a chain's{" "}
            <Text style={styles.noteAccent}>Verify</Text> to confirm on-chain and unlock it here.
          </Text>
        </View>
      )}

      <View style={styles.grid}>
        {visible.map((c) => {
          const funded = (openBalances[c.id] ?? 0) > 0;
          const on = selected.has(c.id);
          const st = states[c.id];
          const disabled = !showAlready && !funded;
          return (
            <View key={c.id} style={styles.cell}>
              <Pressable
                onPress={() => (showAlready ? void checkAlready(c.id) : toggle(c.id, funded))}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: on ? "transparent" : `rgba(255,255,255,0.13)`,
                    borderColor: on ? "rgba(201,176,255,0.7)" : "rgba(255,255,255,0.24)",
                    transform: [{ scale: pressed && !disabled ? 0.95 : 1 }],
                  },
                ]}>
                {on && (
                  <LinearGradient
                    colors={["rgba(201,176,255,0.45)", "rgba(123,85,201,0.34)"]}
                    start={{ x: 0.15, y: 0 }}
                    end={{ x: 0.85, y: 1 }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 17 }]}
                  />
                )}
                {/* No opacity dim — a disabled chain stays a solid box and only
                    its glyph mutes, so it never reads as see-through. */}
                <View style={styles.glyph}>
                  <c.Icon
                    size={26}
                    color={disabled ? `rgba(${INK},0.5)` : on ? "#F4EEFF" : `rgba(${INK},0.92)`}
                  />
                </View>
                {st === "done" && (
                  <View style={styles.badgeOk}>
                    <Svg width={9} height={9} viewBox="0 0 12 12" fill="none">
                      <Path
                        d="M2.5 6l2.2 2.2L9.5 3.5"
                        stroke="#1D1140"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                )}
                {/* Over the glyph, filling the tile. A small ring pinned to the
                    corner was easy to miss on the one screen where the wait is
                    long enough to make you wonder whether the tap registered. */}
                {st === "registering" && (
                  <View style={styles.tileBusy}>
                    <ActivityIndicator size="large" color="#F4EEFF" />
                  </View>
                )}
              </Pressable>

              <View style={styles.cellLabel}>
                <Text style={styles.cellName} numberOfLines={1}>
                  {c.name}
                </Text>
                {showAlready && (
                  <Pressable onPress={() => void checkAlready(c.id)} hitSlop={8}>
                    <Text style={styles.verify}>{verifying === c.id ? "…" : "VERIFY"}</Text>
                  </Pressable>
                )}
              </View>
              {!funded && !showAlready && <Text style={styles.noBalance}>No balance</Text>}
              {!!errors[c.id] && <Text style={styles.cellError}>{errors[c.id]}</Text>}
            </View>
          );
        })}
      </View>

      {!anyFunded && (
        <Text style={styles.fundHint}>
          Fund a chain in open mode first, then come back to register it.
        </Text>
      )}

      <Pressable
        onPress={() => void register()}
        disabled={selected.size === 0 || busy}
        style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1 }]}>
        {selected.size === 0 || busy ? (
          <View style={[StyleSheet.absoluteFill, styles.ctaDim]} />
        ) : (
          <LinearGradient
            colors={["#FBF7FF", "#C9B0FF"]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
          />
        )}
        <Text
          style={[
            styles.ctaText,
            { color: selected.size === 0 || busy ? `rgba(${INK},0.7)` : "#3B2570" },
          ]}>
          {busy
            ? "REGISTERING…"
            : selected.size === 0
              ? "SELECT CHAINS TO REGISTER"
              : `REGISTER ${selected.size} CHAIN${selected.size > 1 ? "S" : ""}`}
        </Text>
      </Pressable>

      <Pressable onPress={onSkip} hitSlop={8}>
        <Text style={styles.skip}>SKIP FOR NOW</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingTop: 26 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headText: { flex: 1, paddingRight: 12 },
  kicker: {
    fontFamily: FONT.roundBold,
    fontSize: 8.5,
    letterSpacing: 4.5,
    color: "#C9B0FF",
    marginBottom: 8,
  },
  title: {
    fontFamily: FONT.roundBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: "#FFFFFF",
  },
  lede: {
    fontFamily: FONT.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: `rgba(${INK},0.8)`,
    marginTop: 9,
  },
  help: {
    height: 30,
    width: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  note: {
    marginTop: 14,
    padding: 13,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
  },
  noteText: { fontFamily: FONT.body, fontSize: 12, lineHeight: 18, color: `rgba(${INK},0.9)` },
  noteAccent: { fontFamily: FONT.bodySemi, color: "#C9B0FF" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 24 },
  cell: { width: "31%", alignItems: "center", gap: 6 },
  tile: {
    height: 68,
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  glyph: { zIndex: 1 },
  badgeOk: {
    position: "absolute",
    top: -6,
    right: -6,
    height: 18,
    width: 18,
    borderRadius: 9,
    backgroundColor: "#6EE7A8",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  tileBusy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 17,
    backgroundColor: "rgba(24,12,56,0.62)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  cellLabel: { flexDirection: "row", alignItems: "center", gap: 5 },
  cellName: { fontFamily: FONT.roundSemi, fontSize: 10, color: `rgba(${INK},0.92)` },
  verify: { fontFamily: FONT.roundBold, fontSize: 8, letterSpacing: 1.2, color: "#C9B0FF" },
  noBalance: { fontFamily: FONT.body, fontSize: 8.5, color: `rgba(${INK},0.65)` },
  cellError: {
    fontFamily: FONT.body,
    fontSize: 8.5,
    lineHeight: 11,
    color: "#FF8E86",
    textAlign: "center",
  },

  fundHint: {
    marginTop: 20,
    textAlign: "center",
    fontFamily: FONT.body,
    fontSize: 12,
    color: `rgba(${INK},0.72)`,
  },
  cta: {
    marginTop: 28,
    height: 52,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  ctaDim: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 20 },
  ctaText: { fontFamily: FONT.roundBold, fontSize: 12, letterSpacing: 1.8 },
  skip: {
    marginTop: 16,
    textAlign: "center",
    fontFamily: FONT.roundSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: `rgba(${INK},0.72)`,
  },
});
