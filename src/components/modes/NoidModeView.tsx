/**
 * NoidModeView.tsx — the private treasury. Placeholder for this milestone.
 *
 * The extension's noid mode is the whole shielded side of the wallet: the
 * Menoid-derived keys, the masked balances, the pool. None of that is ported
 * yet, so this stands in — but it stands in ON THE NOID SKY, because the mode
 * toggle's promise is the weather changing, and a toggle that flips to a
 * placeholder painted in open-mode colours would read as a bug rather than as
 * an unfinished section.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import UnderDevPanel from "../shared/UnderDevPanel";

export default function NoidModeView() {
  return (
    <View style={styles.wrap}>
      <UnderDevPanel
        isNoid
        label="Noid mode"
        caption="Your shielded balances, private sends and the Menoid pool are being built. Open mode is live."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 12 },
});
