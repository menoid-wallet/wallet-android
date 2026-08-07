/**
 * ReceiveModal.tsx — the QR sheet.
 *
 * Ported from the extension's shared/ReceiveModal.tsx. Both modes encode the
 * SAME real wallet address: under the register / user-commitment architecture a
 * sender pays a real address and Menoid resolves the private identity on-chain,
 * so there is no separate "noid key" to share.
 *
 * The QR is generated at error-correction level H specifically so the mark can
 * sit on top of the middle without making it unscannable.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Path } from "react-native-svg";
import * as Clipboard from "expo-clipboard";
import LiquidSheet from "./LiquidSheet";
import { COLORS, FONT } from "../../theme/tokens";
import { rgba, themeTokens } from "../../theme/useThemeTokens";

const HAT = require("../../../assets/brand/meno_hat_icon.png");
const QR_SIZE = 210;

export default memo(function ReceiveModal({
  open,
  onClose,
  mode,
  address,
}: {
  open: boolean;
  onClose: () => void;
  mode: "open" | "noid";
  address: string;
}) {
  const isNoid = mode === "noid";
  const t = themeTokens(isNoid);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function handleCopy() {
    if (!address) return;
    void Clipboard.setStringAsync(address);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  const ink = isNoid ? "#F4EEFF" : "#3B2570";

  return (
    <LiquidSheet open={open} onClose={onClose} tone={isNoid ? "ink" : "cream"}>
      <View style={styles.pad}>
        <View style={styles.head}>
          <Text style={[styles.eyebrow, { color: isNoid ? "#C9B0FF" : rgba(t.inkRgb, 0.7) }]}>
            {isNoid ? "NOID MODE" : "OPEN MODE"}
          </Text>
          <Text style={[styles.title, { color: ink }]}>
            {isNoid ? "Receive on Noid" : "Receive on Open"}
          </Text>
          <Text style={[styles.sub, { color: rgba(t.inkRgb, isNoid ? 0.65 : 0.6) }]}>
            {isNoid ? "Share this address — funds arrive privately" : "Share this address to receive"}
          </Text>
        </View>

        {/* QR + the mark's hat over the middle */}
        <View style={styles.qrBay}>
          <View
            style={[
              styles.qrDashes,
              { borderColor: isNoid ? "rgba(255,255,255,0.25)" : "rgba(78,47,142,0.25)" },
            ]}
          />
          <View style={styles.qrTile}>
            {address ? (
              <QRCode
                value={address}
                size={QR_SIZE}
                color="#2B1A55"
                backgroundColor="#F0E9FE"
                ecl="H"
              />
            ) : (
              <View style={styles.qrEmpty}>
                <Text style={{ color: rgba(t.inkRgb, 0.4), fontSize: 11 }}>No data</Text>
              </View>
            )}
            <View style={styles.hatBay} pointerEvents="none">
              <View style={styles.hatDisc} />
              <Image source={HAT} style={styles.hat} resizeMode="contain" fadeDuration={0} />
            </View>
          </View>
        </View>

        <View
          style={[
            styles.addrCard,
            {
              backgroundColor: isNoid ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.45)",
              borderColor: isNoid ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.62)",
            },
          ]}>
          <Text style={[styles.addrLabel, { color: rgba(t.inkRgb, 0.45) }]}>WALLET ADDRESS</Text>
          <Text style={[styles.addr, { color: rgba(t.inkRgb, isNoid ? 0.85 : 0.8) }]}>{address}</Text>
        </View>

        <Pressable
          onPress={handleCopy}
          style={[styles.copy, { backgroundColor: isNoid ? "#DCCEFA" : COLORS.violetDeep }]}>
          {copied && (
            <Svg width={14} height={14} viewBox="0 0 14 14">
              <Path
                d="M2 7L5.5 10.5L12 4"
                stroke={isNoid ? "#3B2570" : "#F6EFFF"}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          )}
          <Text style={[styles.copyLabel, { color: isNoid ? "#3B2570" : "#F6EFFF" }]}>
            {copied ? "COPIED!" : "COPY ADDRESS"}
          </Text>
        </Pressable>

        <Text style={[styles.motto, { color: rgba(t.inkRgb, isNoid ? 0.7 : 0.45) }]}>
          {isNoid ? "Two keys, one secret port." : "Yer keys, yer kingdom."}
        </Text>
      </View>
    </LiquidSheet>
  );
});

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 24, paddingTop: 2, paddingBottom: 16 },
  head: { alignItems: "center", paddingBottom: 6 },
  eyebrow: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 4, marginBottom: 4 },
  title: { fontFamily: FONT.roundBold, fontSize: 20, letterSpacing: -0.3 },
  sub: { fontFamily: FONT.body, fontSize: 11, marginTop: 4, textAlign: "center" },

  qrBay: { alignItems: "center", paddingTop: 22, paddingBottom: 6 },
  qrDashes: {
    position: "absolute",
    top: 6,
    left: "50%",
    marginLeft: -(QR_SIZE / 2 + 28),
    width: QR_SIZE + 56,
    height: QR_SIZE + 56,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  qrTile: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F4EEFF",
    borderWidth: 1,
    borderColor: "rgba(78,47,142,0.12)",
    elevation: 8,
    shadowColor: "#301A60",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  qrEmpty: { width: QR_SIZE, height: QR_SIZE, alignItems: "center", justifyContent: "center" },
  hatBay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hatDisc: {
    position: "absolute",
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: "#F0E9FE",
    borderWidth: 1,
    borderColor: "rgba(78,47,142,0.12)",
  },
  hat: { height: 40, width: 40 },

  addrCard: { marginTop: 18, padding: 12, borderRadius: 14, borderWidth: 1 },
  addrLabel: { fontFamily: FONT.body, fontSize: 9, letterSpacing: 2.6, marginBottom: 5 },
  addr: { fontFamily: FONT.mono, fontSize: 12, lineHeight: 17 },

  copy: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 18,
  },
  copyLabel: { fontFamily: FONT.roundSemi, fontSize: 12, letterSpacing: 1.4 },
  motto: { fontFamily: FONT.body, fontSize: 11, fontStyle: "italic", textAlign: "center", marginTop: 12 },
});
