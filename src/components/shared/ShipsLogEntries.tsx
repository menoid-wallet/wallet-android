/**
 * ShipsLogEntries.tsx — transaction history rows, and the sheet one opens.
 *
 * Ported from the extension's shared/ShipsLogEntries.tsx, trimmed to the open
 * entry type (the noid ones arrive with noid mode). The detail view was a
 * portalled bottom sheet there and is a LiquidSheet here — the same shape,
 * built out of the primitive the rest of the wallet's sheets already use.
 */

import React, { memo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { TxEntry } from "../../lib/txStore";
import { explorerTxUrl } from "../../lib/rpc";
import { NETWORKS, type NetworkId } from "../../lib/networks";
import LiquidSheet from "./LiquidSheet";
import { FONT } from "../../theme/tokens";
import { rgba } from "../../theme/useThemeTokens";

const DECIMALS: Record<NetworkId, number> = {
  monad: 18,
  sepolia: 18,
  base_sepolia: 18,
  solana: 9,
  sui: 9,
  aptos: 8,
};

function trunc(s: string, a = 6, b = 4): string {
  if (!s) return "—";
  return s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s;
}

/** Format a smallest-unit hex amount. BigInt string maths, never floats. */
function formatHexAmount(hex: string | null, decs: number, symbol: string): string {
  if (!hex || hex === "0x0" || hex === "0x") return `0 ${symbol}`;
  try {
    const s = BigInt(hex).toString().padStart(decs + 1, "0");
    const main = s.slice(0, s.length - decs);
    const frac = s.slice(s.length - decs).replace(/0+$/, "");
    const n = Number(frac ? `${main}.${frac}` : main);
    if (n === 0) return `0 ${symbol}`;
    return `${n.toFixed(n < 0.001 ? 8 : 6)} ${symbol}`;
  } catch {
    return "—";
  }
}

function relTime(ts: number): string {
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function entryMeta(e: TxEntry) {
  const hasValue = e.value && e.value !== "0x0" && e.value !== "0x";
  return {
    label: e.functionName ?? (hasValue ? "Transfer" : "Contract Call"),
    icon: "⛵",
    eyebrow: "Open Transaction",
  };
}

/* ───────────────────────── Detail sheet ───────────────────────── */
function TxDetailSheet({
  entry,
  isNoid,
  network,
  onClose,
}: {
  entry: TxEntry;
  isNoid: boolean;
  network: NetworkId;
  onClose: () => void;
}) {
  const cfg = NETWORKS[network];
  const decs = DECIMALS[network];
  const { label, icon, eyebrow } = entryMeta(entry);

  const ink = isNoid ? "244,238,255" : "78,47,142";
  const rows: { label: string; value: string; mono?: boolean; accent?: boolean }[] = [
    { label: "Tx Hash", value: trunc(entry.txHash, 10, 8), mono: true },
    ...(entry.to ? [{ label: "To", value: trunc(entry.to, 8, 6), mono: true }] : []),
    ...(entry.value && entry.value !== "0x0" && entry.value !== "0x"
      ? [{ label: "Value", value: formatHexAmount(entry.value, decs, cfg.nativeCurrency), accent: true }]
      : []),
    ...(entry.gasUsed ? [{ label: "Gas Used", value: Number(entry.gasUsed).toLocaleString(), mono: true }] : []),
    { label: "Network", value: cfg.label },
  ];

  return (
    <LiquidSheet open onClose={onClose} tone={isNoid ? "ink" : "cream"}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.sheetBadge}>
            <Text style={styles.sheetIcon}>{icon}</Text>
          </View>
          <View style={styles.sheetHeadText}>
            <Text style={[styles.sheetEyebrow, { color: isNoid ? "rgba(201,176,255,0.85)" : "rgba(123,85,201,0.75)" }]}>
              {eyebrow.toUpperCase()}
            </Text>
            <Text style={[styles.sheetTitle, { color: rgba(ink, 0.95) }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={[styles.sheetTime, { color: rgba(ink, 0.55) }]}>{relTime(entry.timestamp)}</Text>
          </View>
        </View>

        <View
          style={[
            styles.details,
            {
              backgroundColor: isNoid ? "rgba(255,255,255,0.06)" : "rgba(78,47,142,0.05)",
              borderColor: rgba(ink, 0.1),
            },
          ]}>
          {rows.map((r, i) => (
            <View
              key={r.label}
              style={[
                styles.detailRow,
                i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: rgba(ink, 0.12) },
              ]}>
              <Text style={[styles.detailLabel, { color: rgba(ink, 0.62) }]}>{r.label.toUpperCase()}</Text>
              <Text
                style={[
                  styles.detailValue,
                  {
                    color: r.accent ? (isNoid ? "#C9B0FF" : "#5E40A8") : rgba(ink, 0.95),
                    fontFamily: r.mono ? FONT.mono : FONT.body,
                    fontSize: r.mono ? 10 : 11,
                  },
                ]}>
                {r.value}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onClose}
          style={[styles.done, { backgroundColor: isNoid ? "#E4D6FF" : "rgba(78,47,142,0.9)" }]}>
          <Text style={[styles.doneLabel, { color: isNoid ? "#3B2570" : "#F4EEFF" }]}>DONE</Text>
        </Pressable>

        <Pressable onPress={() => void Linking.openURL(explorerTxUrl(entry.txHash, network))}>
          <Text style={[styles.explorer, { color: isNoid ? "rgba(201,176,255,0.7)" : "rgba(78,47,142,0.55)" }]}>
            VIEW ON EXPLORER ↗
          </Text>
        </Pressable>
      </View>
    </LiquidSheet>
  );
}

/* ───────────────────────── Log row ───────────────────────── */
const LogRow = memo(function LogRow({
  entry,
  isNoid,
  network,
  onPress,
}: {
  entry: TxEntry;
  isNoid: boolean;
  network: NetworkId;
  onPress: () => void;
}) {
  const { label, icon } = entryMeta(entry);
  const decs = DECIMALS[network];
  const symbol = NETWORKS[network].nativeCurrency;
  const hasValue = entry.value && entry.value !== "0x0" && entry.value !== "0x";
  const second = hasValue ? formatHexAmount(entry.value, decs, symbol) : trunc(entry.txHash, 8, 6);

  const ink = isNoid ? "244,238,255" : "78,47,142";

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: isNoid ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.50)",
              borderColor: isNoid ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.62)",
              transform: [{ scale: pressed ? 0.975 : 1 }],
            },
          ]}>
          <View style={[styles.rowIcon, { backgroundColor: rgba(ink, 0.05), borderColor: rgba(ink, 0.1) }]}>
            <Text style={styles.rowIconText}>{icon}</Text>
          </View>

          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, { color: rgba(ink, isNoid ? 0.9 : 0.85) }]} numberOfLines={1}>
              {label}
            </Text>
            <Text
              style={[
                styles.rowSecond,
                {
                  color: isNoid ? "rgba(201,176,255,0.85)" : "rgba(123,85,201,0.75)",
                  fontFamily: hasValue ? FONT.body : FONT.mono,
                },
              ]}
              numberOfLines={1}>
              {second}
            </Text>
          </View>

          <View style={styles.rowTail}>
            <Text style={[styles.rowTime, { color: rgba(ink, 0.5) }]}>{relTime(entry.timestamp)}</Text>
            <Svg width={8} height={8} viewBox="0 0 10 10">
              <Path
                d="M3.5 2L6.5 5L3.5 8"
                stroke={rgba(ink, 0.5)}
                strokeWidth={1.3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </View>
        </View>
      )}
    </Pressable>
  );
});

/* ───────────────────────── Main ───────────────────────── */
export default function ShipsLogEntries({
  entries,
  isNoid,
  network,
}: {
  entries: TxEntry[];
  isNoid: boolean;
  network: NetworkId;
}) {
  const [selected, setSelected] = useState<TxEntry | null>(null);

  if (entries.length === 0) {
    return (
      <Text
        style={[
          styles.empty,
          { color: isNoid ? "rgba(244,238,255,0.35)" : "rgba(78,47,142,0.38)" },
        ]}>
        The log is empty.
      </Text>
    );
  }

  return (
    <>
      <View style={styles.list}>
        {entries.map((e, i) => (
          <LogRow
            key={`${e.txHash}-${i}`}
            entry={e}
            isNoid={isNoid}
            network={network}
            onPress={() => setSelected(e)}
          />
        ))}
      </View>

      {selected && (
        <TxDetailSheet
          entry={selected}
          isNoid={isNoid}
          network={network}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: FONT.body, fontSize: 11, fontStyle: "italic" },
  list: { gap: 6 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1 },
  rowIcon: { height: 28, width: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowIconText: { fontSize: 13 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: FONT.bodySemi, fontSize: 11, marginBottom: 2 },
  rowSecond: { fontSize: 9 },
  rowTail: { alignItems: "flex-end", gap: 3 },
  rowTime: { fontFamily: FONT.body, fontSize: 9 },

  sheet: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 16 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 40 },
  sheetBadge: {
    height: 42,
    width: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: "rgba(5,150,105,0.28)",
    backgroundColor: "rgba(244,238,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetIcon: { fontSize: 18 },
  sheetHeadText: { flex: 1, minWidth: 0 },
  sheetEyebrow: { fontFamily: FONT.roundSemi, fontSize: 8, letterSpacing: 3.4, marginBottom: 3 },
  sheetTitle: { fontFamily: FONT.roundBold, fontSize: 17 },
  sheetTime: { fontFamily: FONT.body, fontSize: 10, marginTop: 1 },

  details: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 9, gap: 12 },
  detailLabel: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 2.5, paddingTop: 1 },
  detailValue: { textAlign: "right", flexShrink: 1 },

  done: { paddingVertical: 13, borderRadius: 14, alignItems: "center" },
  doneLabel: { fontFamily: FONT.roundSemi, fontSize: 10, letterSpacing: 2.8 },
  explorer: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 2.2, textAlign: "center" },
});
